# Ghost CMS Source Installation Fixes & Issues

This document details the issues encountered and fixes required to get Ghost CMS running from source, as the official documentation was incomplete.

## Environment Setup Issues

### 1. Node.js Version Requirement
**Issue**: The codebase requires Node.js v22.13.1+ but this wasn't clearly documented.
- Initial system had Node.js v20.11.1
- Dependency installation failed with engine incompatibility error

**Fix**:
```bash
# Install Node.js 22 via Homebrew
brew install node@22

# Add to PATH permanently
echo 'export PATH="/usr/local/opt/node@22/bin:$PATH"' >> ~/.zshrc
export PATH="/usr/local/opt/node@22/bin:$PATH"
```

**Documentation Gap**: The README.md mentions using the CLI tool but doesn't specify Node.js version requirements for source installation.

### 2. Dependency Installation Engine Compatibility
**Issue**: `yarn install` fails due to engine compatibility even with correct Node.js version.

**Fix**:
```bash
yarn install --ignore-engines
```

**Result**: Successfully installs with warnings but functions correctly.

## Database Setup Issues

### 3. Docker Dependency Not Required
**Issue**: The setup script (`yarn setup`) assumes Docker is available and tries to set up MySQL via Docker.
- Error: "docker: command not found" 
- Setup script fails when Docker is not available

**Fix**: Bypass Docker requirement by configuring SQLite manually:

1. **Create SQLite configuration** in `ghost/core/config.development.json`:
```json
{
    "enableDeveloperExperiments": true,
    "database": {
        "client": "sqlite3",
        "connection": {
            "filename": "content/data/ghost-dev.db"
        }
    },
    "server": {
        "port": 2368,
        "host": "127.0.0.1"
    },
    "url": "http://localhost:2368"
}
```

2. **Initialize database manually**:
```bash
cd ghost/core
mkdir -p content/data
yarn knex-migrator init
```

**Documentation Gap**: The setup process assumes Docker is required, but SQLite works fine for development.

## Build Process Issues

### 4. Admin Interface Build Required
**Issue**: Admin interface fails to load with ENOENT error:
```
Unable to find admin template file /Users/.../ghost/core/core/built/admin/index.html
These template files are generated as part of the build process
```

**Root Cause**: The admin Ember.js application needs to be built before the admin interface can be accessed.

**Fix**:
```bash
# From repository root
yarn build
```

**Result**: 
- Builds all 14 projects including `ghost-admin`
- Takes ~2.5 minutes on first build
- Creates required admin template files

**Documentation Gap**: The quick setup instructions don't mention that the build step is required for admin interface access.

## Working Setup Process Summary

Here's the corrected step-by-step process that actually works:

```bash
# 1. Ensure correct Node.js version
brew install node@22
export PATH="/usr/local/opt/node@22/bin:$PATH"

# 2. Install dependencies (ignore engine warnings)
yarn install --ignore-engines

# 3. Configure for SQLite (create config.development.json as shown above)

# 4. Initialize database manually
cd ghost/core
mkdir -p content/data
yarn knex-migrator init

# 5. Build all components (from repository root)
cd ..
yarn build

# 6. Start development server
cd ghost/core
yarn dev
```

## Verification Steps

After setup, verify functionality:

```bash
# Test frontend
curl -s -o /dev/null -w "%{http_code}" http://localhost:2368/
# Expected: 200

# Test API
curl -s http://localhost:2368/ghost/api/admin/site/
# Expected: JSON response with site data

# Test admin interface
curl -s -o /dev/null -w "%{http_code}" http://localhost:2368/ghost/
# Expected: 200

# Test setup page
curl -s -o /dev/null -w "%{http_code}" http://localhost:2368/ghost/setup/
# Expected: 302 (redirect to setup)
```

## Performance Notes

- Initial build: ~2.5 minutes
- Database initialization: ~4 seconds
- Server startup: ~1 second (after build)
- Memory usage: ~200MB (SQLite mode)

## Key Takeaways for Fork Development

1. **SQLite is sufficient for development** - No need for MySQL/Docker complexity
2. **Build step is mandatory** - Cannot skip for admin interface
3. **Node.js 22 is required** - Older versions won't work
4. **Engine warnings are safe to ignore** - Use `--ignore-engines` flag

## Improvements for Documentation

The official Ghost source installation docs should:

1. Clearly state Node.js v22+ requirement upfront
2. Provide SQLite-based development setup as primary option
3. Mention the required build step for admin interface
4. Include verification steps to confirm successful setup
5. Document the `--ignore-engines` flag for dependency installation

These fixes ensure a smooth development experience without unnecessary Docker dependencies or unclear error messages.