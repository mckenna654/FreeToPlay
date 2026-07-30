#!/bin/sh
set -e

export DATABASE_URL="${DATABASE_URL:-file:/app/data/prod.db}"

echo "Starting FreeToPlay..."
echo "Database: $DATABASE_URL"

# Apply migrations. If the DB is from a broken/partial upgrade, print a clear recovery hint.
if ! npx prisma migrate deploy; then
  echo ""
  echo "============================================================"
  echo "Prisma migration failed."
  echo ""
  echo "This usually means the SQLite file is from an older/broken"
  echo "image, or a failed migration is stuck."
  echo ""
  echo "On Unraid, recover with:"
  echo "  rm -f /mnt/user/appdata/freetoplay/data/prod.db"
  echo "  rm -f /mnt/user/appdata/freetoplay/data/prod.db-journal"
  echo "Then set the image to:"
  echo "  ghcr.io/mckenna654/freetoplay:latest"
  echo "and Force Update / restart the container."
  echo "============================================================"
  exit 1
fi

exec npm start
