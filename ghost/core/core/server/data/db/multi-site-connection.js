const _ = require('lodash');
const knex = require('knex');
const path = require('path');
const fs = require('fs');
const { createClient } = require('@libsql/client');

const logging = require('@tryghost/logging');
const config = require('../../../shared/config');
const errors = require('@tryghost/errors');

/**
 * Multi-Site Database Connection Manager
 * Supports both SQLite (development) and libSQL (production) for multi-tenant architecture
 */
class MultiSiteConnectionManager {
    constructor() {
        this.connections = new Map();
        this.libsqlClients = new Map();
        this.currentSite = null;
    }

    /**
     * Configure database for a specific site
     * @param {string} siteId - The site identifier
     * @param {Object} baseDbConfig - Base database configuration
     * @returns {Object} Site-specific database configuration
     */
    configureSiteDatabase(siteId, baseDbConfig) {
        const dbConfig = _.cloneDeep(baseDbConfig);
        const client = dbConfig.client;

        if (client === 'sqlite3' || client === 'better-sqlite3') {
            // Modify connection for site-specific database
            const originalFilename = dbConfig.connection.filename;
            const ext = path.extname(originalFilename);
            const baseName = path.basename(originalFilename, ext);
            const dirName = path.dirname(originalFilename);
            
            // Create site-specific database file: ghost-dev.db -> ghost-site1-dev.db
            dbConfig.connection.filename = path.join(dirName, `${baseName}-${siteId}${ext}`);
            
            logging.info(`[MultiSite] Site ${siteId} database: ${dbConfig.connection.filename}`);

            // Same SQLite optimizations as original
            dbConfig.useNullAsDefault = Object.prototype.hasOwnProperty.call(dbConfig, 'useNullAsDefault') ? dbConfig.useNullAsDefault : true;

            // Different pool config for better-sqlite3 vs sqlite3
            if (client === 'better-sqlite3') {
                dbConfig.pool = {
                    afterCreate(conn, cb) {
                        conn.pragma('foreign_keys = ON');
                        if (config.get('env').startsWith('testing')) {
                            conn.pragma('synchronous = OFF');
                            conn.pragma('journal_mode = TRUNCATE');
                        }
                        cb();
                    }
                };
            } else {
                // sqlite3 uses .run()
                dbConfig.pool = {
                    afterCreate(conn, cb) {
                        conn.run('PRAGMA foreign_keys = ON', cb);
                        if (config.get('env').startsWith('testing')) {
                            conn.run('PRAGMA synchronous = OFF;');
                            conn.run('PRAGMA journal_mode = TRUNCATE;');
                        }
                    }
                };
            }

        } else if (client === 'libsql') {
            // LibSQL configuration for production multi-tenancy
            dbConfig.connection.database = `ghost_site_${siteId}`;
            dbConfig.connection.filename = `content/data/ghost-${siteId}.db`;
            
            logging.info(`[MultiSite] LibSQL Site ${siteId} database: ${dbConfig.connection.filename}`);
        }

        return dbConfig;
    }

    /**
     * Get or create a database connection for a specific site
     * @param {string} siteId - The site identifier
     * @returns {knex.Knex} Knex instance for the site
     */
    getSiteConnection(siteId) {
        if (!siteId) {
            throw new errors.IncorrectUsageError({
                message: 'Site ID is required for multi-site database connection'
            });
        }

        if (this.connections.has(siteId)) {
            return this.connections.get(siteId);
        }

        const baseDbConfig = config.get('database');
        const siteDbConfig = this.configureSiteDatabase(siteId, baseDbConfig);
        
        const connection = knex(siteDbConfig);
        this.connections.set(siteId, connection);

        logging.info(`[MultiSite] Created new database connection for site: ${siteId}`);
        return connection;
    }

    /**
     * Get libSQL client for cross-database operations
     * @param {string} siteId - The primary site identifier
     * @returns {Object} LibSQL client for multi-database queries
     */
    getLibSQLClient(siteId) {
        if (!siteId) {
            throw new errors.IncorrectUsageError({
                message: 'Site ID is required for libSQL client'
            });
        }

        if (this.libsqlClients.has(siteId)) {
            return this.libsqlClients.get(siteId);
        }

        const baseDbConfig = config.get('database');
        const siteDbConfig = this.configureSiteDatabase(siteId, baseDbConfig);
        
        const client = createClient({
            url: `file:${path.resolve(siteDbConfig.connection.filename)}`
        });

        this.libsqlClients.set(siteId, client);
        
        logging.info(`[MultiSite] Created libSQL client for site: ${siteId}`);
        return client;
    }

    /**
     * Execute cross-site analytics query
     * @param {string} primarySiteId - The primary site to execute from
     * @param {Array<string>} additionalSiteIds - Additional sites to query
     * @param {string} query - SQL query template with site placeholders
     * @returns {Promise<Array>} Query results
     */
    async executeCrossSiteQuery(primarySiteId, additionalSiteIds, query) {
        const libsqlClient = this.getLibSQLClient(primarySiteId);

        try {
            // Attach additional databases
            for (const [index, siteId] of additionalSiteIds.entries()) {
                const siteConfig = this.configureSiteDatabase(siteId, config.get('database'));
                const attachQuery = `ATTACH DATABASE '${path.resolve(siteConfig.connection.filename)}' AS site${index + 2}`;
                await libsqlClient.execute(attachQuery);
            }

            // Execute the cross-site query
            const result = await libsqlClient.execute(query);
            return result.rows;

        } catch (error) {
            logging.error(`[MultiSite] Cross-site query failed: ${error.message}`);
            throw error;
        }
    }

    /**
     * Set the current active site for this request/context
     * @param {string} siteId - The site identifier
     */
    setCurrentSite(siteId) {
        this.currentSite = siteId;
    }

    /**
     * Get the current active site
     * @returns {string} Current site identifier
     */
    getCurrentSite() {
        return this.currentSite;
    }

    /**
     * Create a new site database
     * @param {string} siteId - The new site identifier
     * @returns {Promise<knex.Knex>} Database connection for new site
     */
    async createSite(siteId) {
        if (this.connections.has(siteId)) {
            throw new errors.ValidationError({
                message: `Site ${siteId} already exists`
            });
        }

        // Create the database connection
        const connection = this.getSiteConnection(siteId);
        
        // Initialize the database with Ghost schema
        // Note: In production, you'd run the actual Ghost migrations here
        logging.info(`[MultiSite] Site ${siteId} database created and ready`);
        
        return connection;
    }

    /**
     * Clean up all connections
     */
    async destroy() {
        for (const [siteId, connection] of this.connections) {
            await connection.destroy();
            logging.info(`[MultiSite] Destroyed connection for site: ${siteId}`);
        }
        
        for (const [siteId, client] of this.libsqlClients) {
            client.close();
            logging.info(`[MultiSite] Closed libSQL client for site: ${siteId}`);
        }

        this.connections.clear();
        this.libsqlClients.clear();
    }
}

// Export singleton instance
const multiSiteManager = new MultiSiteConnectionManager();

module.exports = multiSiteManager;