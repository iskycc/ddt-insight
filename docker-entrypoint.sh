#!/bin/sh
set -eu

# Bind-mounted host directories are commonly created as root. Fix ownership
# before dropping privileges so SQLite can create its database, WAL and secret.
if [ "$(id -u)" = "0" ]; then
  chown nextjs:nodejs /app/data 2>/dev/null || true
  chown nextjs:nodejs /app/data/ddt-insight.sqlite* 2>/dev/null || true
  chown nextjs:nodejs /app/data/.session-secret 2>/dev/null || true
  exec su-exec nextjs:nodejs "$@"
fi

exec "$@"
