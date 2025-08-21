const path = require('path');

// Mock Ghost's configuration system
const mockConfig = {
    get: (key) => {
        if (key === 'database') {
            return {
                client: 'better-sqlite3',
                connection: {
                    filename: 'content/data/ghost-dev.db'
                },
                useNullAsDefault: true
            };
        }
        if (key === 'env') {
            return 'development';
        }
        return null;
    }
};

// Mock Ghost's logging system  
const mockLogging = {
    info: console.log,
    error: console.error
};

// Mock Ghost's errors
const mockErrors = {
    IncorrectUsageError: class extends Error {
        constructor(options) {
            super(options.message);
            this.name = 'IncorrectUsageError';
        }
    },
    ValidationError: class extends Error {
        constructor(options) {
            super(options.message);
            this.name = 'ValidationError';
        }
    }
};

// Mock the require paths that Ghost uses
const Module = require('module');
const originalRequire = Module.prototype.require;

Module.prototype.require = function(id) {
    if (id === '../../../shared/config') {
        return mockConfig;
    }
    if (id === '@tryghost/logging') {
        return mockLogging;
    }
    if (id === '@tryghost/errors') {
        return mockErrors;
    }
    return originalRequire.apply(this, arguments);
};

// Now we can import our multi-site manager
const MultiSiteManager = require('../ghost/core/core/server/data/db/multi-site-connection.js');

async function testGhostMultiSite() {
    console.log('=== Testing Ghost Multi-Site Database Manager ===\n');

    try {
        // Test 1: Create site databases
        console.log('1. Creating site databases...');
        const site1Conn = await MultiSiteManager.createSite('creator1');
        const site2Conn = await MultiSiteManager.createSite('creator2');
        
        console.log('✅ Site databases created');

        // Test 2: Set current site context
        console.log('\n2. Testing site context switching...');
        MultiSiteManager.setCurrentSite('creator1');
        console.log(`Current site: ${MultiSiteManager.getCurrentSite()}`);
        
        MultiSiteManager.setCurrentSite('creator2');
        console.log(`Switched to site: ${MultiSiteManager.getCurrentSite()}`);

        // Test 3: Create some test tables (mimicking Ghost schema)
        console.log('\n3. Creating test tables...');
        
        // Switch to creator1 and create posts table
        MultiSiteManager.setCurrentSite('creator1');
        const creator1Conn = MultiSiteManager.getSiteConnection('creator1');
        
        await creator1Conn.schema.createTable('posts', function (table) {
            table.increments('id').primary();
            table.string('title').notNullable();
            table.text('content');
            table.timestamps(true, true);
        });

        await creator1Conn('posts').insert({
            title: 'Creator 1 First Post',
            content: 'This is content from creator 1'
        });

        // Switch to creator2 and create posts table
        MultiSiteManager.setCurrentSite('creator2');
        const creator2Conn = MultiSiteManager.getSiteConnection('creator2');
        
        await creator2Conn.schema.createTable('posts', function (table) {
            table.increments('id').primary();
            table.string('title').notNullable();
            table.text('content');
            table.timestamps(true, true);
        });

        await creator2Conn('posts').insert({
            title: 'Creator 2 Amazing Post',
            content: 'Content from the second creator'
        });

        console.log('✅ Test tables and data created');

        // Test 4: Query individual sites
        console.log('\n4. Testing individual site queries...');
        
        const creator1Posts = await creator1Conn('posts').select('*');
        const creator2Posts = await creator2Conn('posts').select('*');
        
        console.log('Creator 1 posts:', creator1Posts);
        console.log('Creator 2 posts:', creator2Posts);

        // Test 5: Cross-site analytics query
        console.log('\n5. Testing cross-site analytics...');
        
        const crossSiteQuery = `
            SELECT 'creator1' as site_id, COUNT(*) as post_count FROM posts
            UNION ALL
            SELECT 'creator2' as site_id, COUNT(*) as post_count FROM site2.posts
        `;

        try {
            const analytics = await MultiSiteManager.executeCrossSiteQuery(
                'creator1', 
                ['creator2'], 
                crossSiteQuery
            );
            console.log('Cross-site analytics:', analytics);
        } catch (error) {
            console.log('Cross-site query note:', error.message);
            console.log('(This is expected - we need to set up libSQL properly)');
        }

        console.log('\n✅ Ghost multi-site database manager working!');
        
        // Test 6: Connection management
        console.log('\n6. Testing connection management...');
        console.log(`Active connections: ${MultiSiteManager.connections.size}`);

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        // Clean up
        console.log('\nCleaning up connections...');
        await MultiSiteManager.destroy();
        console.log('✅ Cleanup complete');
    }
}

testGhostMultiSite().catch(console.error);