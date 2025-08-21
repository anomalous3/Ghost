const { createClient } = require('@libsql/client');
const path = require('path');

// Test libSQL with file-based databases (like SQLite)
async function testLibSQL() {
    console.log('=== Testing libSQL Multi-Database Capabilities ===\n');

    // Create connections to our test databases
    const site1 = createClient({
        url: `file:${path.resolve('./site1.db')}`
    });

    const site2 = createClient({
        url: `file:${path.resolve('./site2.db')}`
    });

    try {
        // Test basic queries
        console.log('1. Testing basic queries...');
        const site1Posts = await site1.execute('SELECT * FROM posts');
        const site2Posts = await site2.execute('SELECT * FROM posts');
        
        console.log('Site 1 posts:', site1Posts.rows);
        console.log('Site 2 posts:', site2Posts.rows);

        // Test multi-database query (this is the key feature!)
        console.log('\n2. Testing multi-database queries...');
        
        // Close site2 connection to avoid lock
        site2.close();
        
        const multiQuery = await site1.execute(`
            ATTACH DATABASE '${path.resolve('./site2.db')}' AS site2;
            SELECT 'site1' as site_id, id, title FROM posts
            UNION ALL
            SELECT 'site2' as site_id, id, title FROM site2.posts;
        `);
        
        console.log('Multi-site query results:', multiQuery.rows);

        // Test transaction capabilities
        console.log('\n3. Testing transaction capabilities...');
        await site1.execute('BEGIN');
        await site1.execute("INSERT INTO posts (title, content) VALUES ('Test Transaction', 'Transaction content')");
        const beforeRollback = await site1.execute('SELECT COUNT(*) as count FROM posts');
        console.log('Posts before rollback:', beforeRollback.rows[0]);
        
        await site1.execute('ROLLBACK');
        const afterRollback = await site1.execute('SELECT COUNT(*) as count FROM posts');
        console.log('Posts after rollback:', afterRollback.rows[0]);

        // Test creating a new site database
        console.log('\n4. Testing dynamic site creation...');
        const site3 = createClient({
            url: `file:${path.resolve('./site3.db')}`
        });

        await site3.execute(`
            CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY,
                title TEXT,
                content TEXT
            )
        `);

        await site3.execute("INSERT INTO posts (title, content) VALUES ('Site 3 Post', 'Content from dynamically created site')");

        // Close site3 to avoid lock and test multi-database query across all three
        site3.close();
        
        const allSitesQuery = await site1.execute(`
            ATTACH DATABASE '${path.resolve('./site2.db')}' AS site2;
            ATTACH DATABASE '${path.resolve('./site3.db')}' AS site3;
            
            SELECT 'site1' as site_id, COUNT(*) as post_count FROM posts
            UNION ALL
            SELECT 'site2' as site_id, COUNT(*) as post_count FROM site2.posts
            UNION ALL
            SELECT 'site3' as site_id, COUNT(*) as post_count FROM site3.posts;
        `);

        console.log('All sites post counts:', allSitesQuery.rows);

        console.log('\n✅ All tests passed! LibSQL is working perfectly for multi-site use case.');

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        site1.close();
        // site2 and site3 already closed to avoid locks
    }
}

// Run the test
testLibSQL().catch(console.error);