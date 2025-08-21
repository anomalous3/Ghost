const { createClient } = require('@libsql/client');
const path = require('path');

async function simpleTest() {
    console.log('=== Simple LibSQL Multi-Database Test ===\n');

    // Use a single connection to test multi-database features
    const db = createClient({
        url: `file:${path.resolve('./site1.db')}`
    });

    try {
        // Check initial data
        console.log('1. Checking site1 data...');
        const site1Data = await db.execute('SELECT * FROM posts');
        console.log('Site 1 posts:', site1Data.rows);

        // Test ATTACH command
        console.log('\n2. Testing ATTACH...');
        await db.execute(`ATTACH DATABASE '${path.resolve('./site2.db')}' AS site2`);
        
        // List attached databases
        const databases = await db.execute('PRAGMA database_list');
        console.log('Attached databases:', databases.rows);

        // Test cross-database query
        console.log('\n3. Testing cross-database query...');
        const crossQuery = await db.execute(`
            SELECT 'site1' as site_name, title FROM posts
            UNION ALL
            SELECT 'site2' as site_name, title FROM site2.posts
        `);
        console.log('Cross-database results:', crossQuery.rows);

        // Test aggregate query across sites
        console.log('\n4. Testing aggregate query...');
        const aggregateQuery = await db.execute(`
            SELECT 
                'site1' as site_name, 
                COUNT(*) as post_count 
            FROM posts
            UNION ALL
            SELECT 
                'site2' as site_name, 
                COUNT(*) as post_count 
            FROM site2.posts
        `);
        console.log('Site post counts:', aggregateQuery.rows);

        console.log('\n✅ Multi-database queries working!');

    } catch (error) {
        console.error('❌ Error:', error);
    } finally {
        db.close();
    }
}

simpleTest().catch(console.error);