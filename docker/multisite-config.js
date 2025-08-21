{
  "url": "http://localhost:2368",
  "server": {
    "port": 2368,
    "host": "0.0.0.0"
  },
  "database": {
    "client": "better-sqlite3",
    "connection": {
      "filename": "/var/lib/ghost/content/data/ghost-platform.db"
    }
  },
  "mail": {
    "transport": "Direct"
  },
  "logging": {
    "transports": ["file", "stdout"],
    "level": "info"
  },
  "process": "local",
  "paths": {
    "contentPath": "/var/lib/ghost/content"
  }
}