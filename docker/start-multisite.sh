#!/bin/bash

# Multi-Site Ghost Startup Script
# Co-locates Ghost with libSQL databases for optimal performance

set -e

echo "🚀 Starting Multi-Site Ghost with libSQL..."

# Environment setup
export NODE_ENV=production
export GHOST_INSTALL=/var/lib/ghost
export GHOST_CONTENT=/var/lib/ghost/content

# Create log directory
mkdir -p $GHOST_CONTENT/logs

# Function to start libSQL server for a site
start_libsql_server() {
    local site_id=$1
    local port=$2
    local db_path="$GHOST_CONTENT/data/ghost-${site_id}.db"
    
    echo "Starting libSQL server for site $site_id on port $port..."
    sqld \
        --http-listen-addr "0.0.0.0:$port" \
        --db-path "$db_path" \
        --enable-bottomless-replication=false \
        >> "$GHOST_CONTENT/logs/libsql-${site_id}.log" 2>&1 &
    
    echo "LibSQL server for $site_id started (PID: $!)"
}

# Function to create initial site database
create_initial_site() {
    local site_id=$1
    local db_path="$GHOST_CONTENT/data/ghost-${site_id}.db"
    
    if [ ! -f "$db_path" ]; then
        echo "Creating initial database for site $site_id..."
        sqlite3 "$db_path" "
            CREATE TABLE IF NOT EXISTS posts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                title TEXT NOT NULL,
                slug TEXT NOT NULL UNIQUE,
                content TEXT,
                status TEXT DEFAULT 'draft',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS members (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                email TEXT NOT NULL UNIQUE,
                name TEXT,
                status TEXT DEFAULT 'free',
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            );
            
            INSERT INTO posts (title, slug, content, status) VALUES 
            ('Welcome to $site_id', 'welcome-$site_id', 'Your multi-site Ghost installation is ready!', 'published');
        "
        echo "✅ Database for $site_id created with sample data"
    fi
}

# Function to wait for services
wait_for_service() {
    local service=$1
    local port=$2
    local max_attempts=30
    local attempt=1
    
    echo "Waiting for $service on port $port..."
    while [ $attempt -le $max_attempts ]; do
        if curl -f "http://localhost:$port" >/dev/null 2>&1; then
            echo "✅ $service is ready!"
            return 0
        fi
        echo "Attempt $attempt/$max_attempts: $service not ready yet..."
        sleep 2
        attempt=$((attempt + 1))
    done
    
    echo "❌ $service failed to start within timeout"
    return 1
}

# Cleanup function for graceful shutdown
cleanup() {
    echo "🛑 Shutting down services..."
    
    # Kill all libSQL processes
    pkill -f "sqld" || true
    
    # Kill Ghost process
    pkill -f "node ghost/core/index.js" || true
    
    echo "✅ All services stopped"
    exit 0
}

# Set up signal handlers for graceful shutdown
trap cleanup SIGTERM SIGINT

# Start libSQL servers for demo sites
echo "🗄️ Starting libSQL database servers..."

create_initial_site "demo1"
create_initial_site "demo2"  
create_initial_site "demo3"

start_libsql_server "demo1" 8081
start_libsql_server "demo2" 8082
start_libsql_server "demo3" 8083

# Wait a moment for libSQL servers to initialize
sleep 3

# Start Ghost
echo "👻 Starting Ghost CMS..."
cd /var/lib/ghost/ghost/core

# Start Ghost in the background
node index.js >> "$GHOST_CONTENT/logs/ghost.log" 2>&1 &
GHOST_PID=$!
echo "Ghost started (PID: $GHOST_PID)"

# Wait for Ghost to be ready
wait_for_service "Ghost" 2368

echo "🎉 Multi-Site Ghost with libSQL is ready!"
echo ""
echo "📊 Services running:"
echo "   Ghost CMS: http://localhost:2368"
echo "   Site demo1 DB: http://localhost:8081"  
echo "   Site demo2 DB: http://localhost:8082"
echo "   Site demo3 DB: http://localhost:8083"
echo ""
echo "📁 Database files:"
echo "   $(ls -la $GHOST_CONTENT/data/ghost-*.db 2>/dev/null || echo 'No site databases found yet')"
echo ""

# Keep the container running and monitor processes
while true; do
    # Check if Ghost is still running
    if ! kill -0 $GHOST_PID 2>/dev/null; then
        echo "❌ Ghost process died, restarting..."
        cd /var/lib/ghost/ghost/core
        node index.js >> "$GHOST_CONTENT/logs/ghost.log" 2>&1 &
        GHOST_PID=$!
        echo "Ghost restarted (PID: $GHOST_PID)"
    fi
    
    # Check libSQL processes
    if ! pgrep -f "sqld" >/dev/null; then
        echo "⚠️ Some libSQL servers may have stopped"
    fi
    
    sleep 30
done