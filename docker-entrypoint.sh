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
  echo "Your data has not been touched. Please do not delete prod.db,"
  echo "because it holds every session and RSVP."
  echo ""
  echo "Try these first:"
  echo "  1. Read the error above. A full disk or locked file can be"
  echo "     fixed, and then a restart is all you need."
  echo "  2. Back up /mnt/user/appdata/freetoplay/data/"
  echo "  3. Set the image to ghcr.io/mckenna654/freetoplay:latest"
  echo "     and Force Update, in case a newer image has a fix."
  echo ""
  echo "If the database is damaged beyond that, restore it from a"
  echo "backup. Starting with an empty database loses all of its data."
  echo "============================================================"
  exit 1
fi

exec npm start
