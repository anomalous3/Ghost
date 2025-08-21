const { createClient } = require('@libsql/client');

/**
 * Test script to demonstrate multi-site libSQL capabilities in Docker container
 * Run this inside the container to test cross-database operations
 */
async function testMultiSiteContainer() {
    console.log('🧪 Testing Multi-Site libSQL in Docker Container\n');

    try {
        // Connect to demo1 database via HTTP API
        console.log('1. Connecting to site databases...');
        
        const demo1 = createClient({
            url: 'http://localhost:8081'
        });

        const demo2 = createClient({
            url: 'http://localhost:8082'
        });

        // Test individual site queries
        console.log('\n2. Testing individual site data...');
        
        const demo1Posts = await demo1.execute('SELECT COUNT(*) as post_count FROM posts');
        const demo2Posts = await demo2.execute('SELECT COUNT(*) as post_count FROM posts');
        
        console.log(`Demo1 posts: ${demo1Posts.rows[0].post_count}`);
        console.log(`Demo2 posts: ${demo2Posts.rows[0].post_count}`);

        // Add some test data
        console.log('\n3. Adding test data...');
        
        await demo1.execute(`
            INSERT INTO posts (title, slug, content, status) 
            VALUES ('Multi-Site Post 1', 'multisite-1', 'Content from demo1 site', 'published')
        `);

        await demo2.execute(`
            INSERT INTO posts (title, slug, content, status) 
            VALUES ('Multi-Site Post 2', 'multisite-2', 'Content from demo2 site', 'published')
        `);

        // Test member data
        await demo1.execute(`
            INSERT INTO members (email, name, status) 
            VALUES ('user1@demo1.com', 'Demo1 User', 'paid')
        `);

        await demo2.execute(`
            INSERT INTO members (email, name, status) 
            VALUES ('user1@demo2.com', 'Demo2 User', 'free')
        `);

        console.log('✅ Test data added');

        // Test cross-site analytics (using demo1 as primary)
        console.log('\n4. Testing cross-site analytics...');
        
        // First, connect via file system for cross-database queries
        const analyticsClient = createClient({
            url: 'file:/var/lib/ghost/content/data/ghost-demo1.db'
        });

        // Attach other databases for cross-site queries
        await analyticsClient.execute(`
            ATTACH DATABASE '/var/lib/ghost/content/data/ghost-demo2.db' AS demo2;
            ATTACH DATABASE '/var/lib/ghost/content/data/ghost-demo3.db' AS demo3;
        `);

        // Cross-site post analytics
        const postAnalytics = await analyticsClient.execute(`
            SELECT 'demo1' as site, COUNT(*) as post_count FROM posts
            UNION ALL
            SELECT 'demo2' as site, COUNT(*) as post_count FROM demo2.posts
            UNION ALL  
            SELECT 'demo3' as site, COUNT(*) as post_count FROM demo3.posts
        `);

        console.log('📊 Cross-site post analytics:');
        postAnalytics.rows.forEach(row => {
            console.log(`   ${row.site}: ${row.post_count} posts`);
        });

        // Cross-site member analytics
        const memberAnalytics = await analyticsClient.execute(`
            SELECT 'demo1' as site, status, COUNT(*) as count FROM members GROUP BY status
            UNION ALL
            SELECT 'demo2' as site, status, COUNT(*) as count FROM demo2.members GROUP BY status
            UNION ALL
            SELECT 'demo3' as site, status, COUNT(*) as count FROM demo3.members GROUP BY status
        `);

        console.log('\n👥 Cross-site member analytics:');
        memberAnalytics.rows.forEach(row => {
            console.log(`   ${row.site} ${row.status}: ${row.count} members`);
        });

        // Platform-wide totals
        const platformTotals = await analyticsClient.execute(`
            SELECT 
                SUM(post_count) as total_posts,
                SUM(member_count) as total_members
            FROM (
                SELECT COUNT(*) as post_count, 0 as member_count FROM posts
                UNION ALL
                SELECT COUNT(*) as post_count, 0 as member_count FROM demo2.posts  
                UNION ALL
                SELECT COUNT(*) as post_count, 0 as member_count FROM demo3.posts
                UNION ALL
                SELECT 0 as post_count, COUNT(*) as member_count FROM members
                UNION ALL  
                SELECT 0 as post_count, COUNT(*) as member_count FROM demo2.members
                UNION ALL
                SELECT 0 as post_count, COUNT(*) as member_count FROM demo3.members
            )
        `);

        console.log('\n🌐 Platform totals:');
        console.log(`   Total posts: ${platformTotals.rows[0].total_posts}`);
        console.log(`   Total members: ${platformTotals.rows[0].total_members}`);

        console.log('\n✅ All multi-site tests passed!');
        console.log('\n🎉 Multi-Site Ghost with libSQL is working perfectly in Docker!');

    } catch (error) {
        console.error('❌ Error:', error);
        process.exit(1);
    }
}

// Run the test
if (require.main === module) {
    testMultiSiteContainer().catch(console.error);
}

module.exports = testMultiSiteContainer;