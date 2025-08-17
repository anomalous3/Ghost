# Multi-Site Database Architecture for Ghost Fork

## Executive Summary

You're absolutely right about SQLite's limitations for multi-site production. While SQLite is perfect for **development setup**, your monetized multi-site platform will need a different database strategy for **production scaling**.

## The SQLite vs Multi-Site Reality

### ✅ **SQLite Strengths**
- **Perfect for development**: Fast setup, no dependencies
- **Single-site production**: Excellent performance for individual Ghost sites
- **Simplicity**: No connection pools, no network latency

### ❌ **SQLite Multi-Site Limitations**
- **No concurrent writes**: Multiple sites = write contention
- **File locking**: Cross-site database operations would block
- **No connection pooling**: Each site needs separate file access
- **Backup complexity**: Coordinating backups across hundreds of sites
- **Analytics aggregation**: No cross-site queries possible

## Recommended Multi-Site Database Architecture

### **Phase 1: Hybrid Development Setup** ✅
```
Development Environment:
├── SQLite per site (fast local development)
├── Shared PostgreSQL for platform services
└── Easy switching via config
```

### **Phase 2: Production Multi-Tenancy Strategy**

#### **Option A: Database-per-Tenant (Recommended)**
```sql
Platform Infrastructure:
├── Central PostgreSQL: Platform management, billing, analytics
├── Per-Site PostgreSQL: creator1.db, creator2.db, etc.
└── Shared Redis: Caching, sessions, real-time features

Advantages:
✅ Complete data isolation (GDPR/compliance)
✅ Site-specific backups and migrations  
✅ Independent scaling per creator
✅ Fault isolation (one site down ≠ all down)
✅ Easy to migrate creators between servers
```

#### **Option B: Shared Database with Row-Level Security**
```sql
Shared PostgreSQL with:
├── tenant_id column on all tables
├── Row-level security policies
├── Connection pooling per tenant
└── Horizontal sharding by tenant_id

Challenges:
❌ Shared failure point
❌ Complex backup strategies
❌ Cross-tenant data leakage risks
❌ Harder compliance (data residency)
```

### **Phase 3: Recommended Production Architecture**

```yaml
Infrastructure:
  Central Platform:
    - Database: PostgreSQL (user accounts, billing, analytics aggregation)
    - Cache: Redis Cluster (sessions, rate limiting)
    - Queue: Redis/BullMQ (background jobs)
    
  Per-Creator Sites:
    - Database: PostgreSQL (content, members, site-specific data)
    - Storage: S3/CDN (media files)
    - Search: Elasticsearch/Meilisearch (content search)
    
  Orchestration:
    - Kubernetes: Auto-scaling based on traffic
    - Load Balancer: Route by subdomain to correct Ghost instance
    - Monitoring: Site-specific and platform-wide metrics
```

## Implementation Strategy for Your Fork

### **1. Database Abstraction Layer**
```javascript
// core/server/data/db/connection.js
class MultiSiteDatabase {
    constructor(siteId) {
        this.siteId = siteId;
        this.connection = this.getConnection(siteId);
    }
    
    getConnection(siteId) {
        if (process.env.NODE_ENV === 'development') {
            // Use SQLite for development
            return this.getSQLiteConnection(siteId);
        } else {
            // Use PostgreSQL for production
            return this.getPostgreSQLConnection(siteId);
        }
    }
    
    getSQLiteConnection(siteId) {
        return knex({
            client: 'better-sqlite3',
            connection: {
                filename: `content/data/${siteId}-ghost.db`
            }
        });
    }
    
    getPostgreSQLConnection(siteId) {
        return knex({
            client: 'pg',
            connection: {
                host: process.env.DB_HOST,
                database: `ghost_site_${siteId}`,
                user: process.env.DB_USER,
                password: process.env.DB_PASSWORD
            }
        });
    }
}
```

### **2. Site Provisioning Service**
```javascript
// Platform service for creating new creator sites
class SiteProvisioningService {
    async createSite(creatorId, siteName) {
        // 1. Create database for new site
        await this.createSiteDatabase(siteName);
        
        // 2. Run Ghost migrations on new database
        await this.initializeGhostSchema(siteName);
        
        // 3. Create Kubernetes deployment
        await this.deployGhostInstance(siteName);
        
        // 4. Configure subdomain routing
        await this.updateLoadBalancer(siteName);
        
        // 5. Update platform registry
        await this.registerSite(creatorId, siteName);
    }
}
```

### **3. Cross-Site Analytics Service**
```javascript
// Aggregate data from all creator sites
class PlatformAnalyticsService {
    async getDashboardData(creatorId) {
        const sites = await this.getCreatorSites(creatorId);
        
        const analytics = await Promise.all(sites.map(async (site) => {
            return {
                siteId: site.id,
                members: await this.getSiteMembers(site.id),
                revenue: await this.getSiteRevenue(site.id),
                posts: await this.getSitePostCount(site.id)
            };
        }));
        
        return this.aggregateAnalytics(analytics);
    }
}
```

## Database Strategy by Environment

### **Development (Current Working Solution)**
```yaml
Setup:
  - SQLite per developer
  - Fast setup with better-sqlite3
  - No external dependencies
  - Easy database resets

Config:
  database:
    client: 'better-sqlite3'
    connection:
      filename: 'content/data/ghost-dev.db'
```

### **Staging/Testing**
```yaml
Setup:
  - Single PostgreSQL with schemas per site
  - Easier testing of multi-site features
  - Production-like but manageable

Config:
  database:
    client: 'postgresql'
    connection:
      host: 'staging-db'
      database: 'ghost_staging'
    searchPath: ['site_${siteId}', 'public']
```

### **Production**
```yaml
Setup:
  - PostgreSQL per creator site
  - Central PostgreSQL for platform
  - Redis for caching and sessions
  - S3 for media storage

Config:
  platform_database:
    client: 'postgresql'
    connection:
      host: 'platform-db-cluster'
      database: 'platform'
      
  site_database:
    client: 'postgresql'
    connection:
      host: 'sites-db-cluster'  
      database: 'ghost_site_${siteId}'
```

## Migration Path

### **Phase 1: Keep SQLite for Development** ✅
- Current setup works perfectly
- Fast development iterations
- No barriers for contributors

### **Phase 2: Add PostgreSQL Support**
```javascript
// Add to Ghost core configuration
if (config.get('multisite:enabled')) {
    // Use database-per-tenant strategy
    dbConnection = multiSiteDb.getConnection(siteId);
} else {
    // Use existing single-site logic
    dbConnection = ghostDb.getConnection();
}
```

### **Phase 3: Platform Services**
- Build central platform for site management
- Add Kubernetes deployment automation
- Implement cross-site analytics aggregation

## Performance Projections

### **SQLite (Single Site)**
- **Reads**: 100k+ ops/sec
- **Writes**: 10k+ ops/sec  
- **Concurrent Users**: 1000+
- **Perfect for**: Individual creators with < 50k members

### **PostgreSQL (Multi-Site)**
- **Reads**: 50k+ ops/sec per site
- **Writes**: 5k+ ops/sec per site
- **Concurrent Users**: 10k+ per site
- **Scales to**: Unlimited sites with proper sharding

### **Platform Database Load**
```
For 1000 creator sites:
- Central DB: ~100 ops/sec (billing, auth, analytics)
- Per-Site DB: Independent load based on creator popularity
- Redis Cache: 10k+ ops/sec shared across platform
```

## Conclusion

**For Your Multi-Site Monetized Platform:**

1. **Keep SQLite for development** - It's perfect for local development
2. **Plan PostgreSQL for production** - Database-per-tenant model
3. **Build database abstraction now** - Easy switching between environments
4. **Central platform database** - For billing, analytics, user management
5. **Kubernetes orchestration** - For auto-scaling per creator

This architecture gives you:
- ✅ Fast development with SQLite
- ✅ Production scaling with PostgreSQL  
- ✅ Complete data isolation per creator
- ✅ Platform-wide analytics and billing
- ✅ Independent scaling per creator's popularity

The key insight: **SQLite for development speed, PostgreSQL for production scale.**