#!/usr/bin/env bash
# One-time cleanup: remove the 15 invoices left in the development database by the old
# T-MIG-006 test, so M-11b's empty-table precondition can pass. Approved for preparation
# 2026-11-20; run it only after explicit approval to execute.
#
#   CONFIRM_DB=<database name> scripts/db/one-time/2026-11-20-remove-test-invoices/run.sh            dry run
#   CONFIRM_DB=<database name> scripts/db/one-time/2026-11-20-remove-test-invoices/run.sh --execute  delete
#
# Run from anywhere; it works from the repository root. A dry run takes the backup and runs every
# check and the deletion, then rolls back. Nothing outside the invoices table is touched.
# It prints no secrets: credentials stay inside the PostgreSQL container.
set -euo pipefail
set -o noclobber

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../../.." && pwd)"
cd "$ROOT"

EXECUTE=false
case "${1:-}" in
  '') ;;
  --execute) EXECUTE=true ;;
  *) echo "Usage: CONFIRM_DB=<name> $0 [--execute]" >&2; exit 2 ;;
esac

DC=(docker compose -f docker/compose.dev.yml --env-file .env)
psql_dev() {
  "${DC[@]}" exec -T postgres sh -c \
    'exec psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" "$@"' sh "$@"
}

DB="$(psql_dev -At -c 'SELECT current_database()')"
if [ "${CONFIRM_DB:-}" != "$DB" ]; then
  echo "Target database is \"$DB\". Rerun with CONFIRM_DB=$DB to confirm it is the one you mean." >&2
  exit 1
fi
case "$DB" in *e2e*|*test*) echo "Refusing: \"$DB\" looks like a test database." >&2; exit 1 ;; esac

echo "Database: $DB. Mode: $([ "$EXECUTE" = true ] && echo EXECUTE || echo 'dry run')."

echo "1/5 Checking preconditions (read-only)."
FP1="$( { echo 'BEGIN TRANSACTION READ ONLY;'; cat "$HERE/checks.sql" "$HERE/fingerprint.sql"; echo 'ROLLBACK;'; } | psql_dev -At)"
[ -n "$FP1" ] || { echo "ABORT: no fingerprint." >&2; exit 1; }

STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="backups/db/test-invoices-$STAMP"
mkdir -p backups/db
mkdir "$OUT"            # fails if it already exists: never overwrites a backup
chmod 700 "$OUT"
CSV="$OUT/invoices.csv"

echo "2/5 Backing up every invoice row to $CSV (read-only)."
psql_dev -c 'BEGIN TRANSACTION READ ONLY' \
         -c 'COPY (SELECT * FROM invoices ORDER BY id) TO STDOUT WITH (FORMAT csv, HEADER)' \
         -c 'ROLLBACK' > "$CSV"
chmod 600 "$CSV"

echo "3/5 Verifying the backup."
ROWS=$(( $(wc -l < "$CSV") - 1 ))
[ "$ROWS" -eq 15 ] || { echo "ABORT: the backup holds $ROWS rows, expected 15." >&2; exit 1; }
FP2="$( { echo 'BEGIN TRANSACTION READ ONLY;'; cat "$HERE/fingerprint.sql"; echo 'ROLLBACK;'; } | psql_dev -At)"
[ "$FP1" = "$FP2" ] || { echo "ABORT: invoices changed while the backup was taken." >&2; exit 1; }
SHA="$(shasum -a 256 "$CSV" 2>/dev/null || sha256sum "$CSV")"
{
  echo "database: $DB"
  echo "taken: $STAMP"
  echo "rows: $ROWS"
  echo "row fingerprint (md5 of all columns, id order): $FP1"
  echo "csv sha256: ${SHA%% *}"
  echo "mode: $([ "$EXECUTE" = true ] && echo execute || echo dry-run)"
} > "$OUT/manifest.txt"

echo "4/5 Deleting inside one transaction ($([ "$EXECUTE" = true ] && echo 'will commit' || echo 'will roll back'))."
{
  sed -n '/^--@@HEADER/,/^--@@BODY/p' "$HERE/delete.sql"
  cat "$HERE/checks.sql"
  sed -n '/^--@@BODY/,$p' "$HERE/delete.sql"
} | psql_dev -v fingerprint="$FP1" -v execute="$EXECUTE"

echo "5/5 Verifying the result (read-only)."
LEFT="$(psql_dev -At -c 'BEGIN TRANSACTION READ ONLY' -c 'SELECT count(*) FROM invoices' -c 'ROLLBACK')"
if [ "$EXECUTE" = true ]; then
  [ "$LEFT" = 0 ] || { echo "UNEXPECTED: $LEFT invoices remain." >&2; exit 1; }
  echo "Done. invoices: 0. Backup: $OUT"
else
  [ "$LEFT" = 15 ] || { echo "UNEXPECTED: dry run left $LEFT invoices." >&2; exit 1; }
  echo "Dry run complete. invoices: 15 (unchanged). Backup: $OUT"
fi
