#!/bin/bash
# Rebuild scratch DB $1 from the eight applied migrations plus seed rows.
set -e
DB=${1:-m11a}
M=/mnt/user-data/uploads/MedCore-HMS/apps/api/prisma/migrations
cd /tmp
sudo -u postgres psql -qc "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null 2>&1
for d in $(ls $M | sort); do f=$M/$d/migration.sql; [ -f $f ] || continue
  sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d $DB -c "$(cat $f)" >/dev/null; done
sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d $DB -f /home/claude/m11a/seed.sql >/dev/null
