#!/bin/bash
# Full M-11b validation on scratch PostgreSQL 16; writes results.txt. Concurrency tests use the real
# clock (run before 23:50 IST). Never touches any database other than the scratch m11b* databases.
cd /home/claude/m11b; V=validation; L=$V/results.txt; : > $L
log() { echo "$@" | tee -a $L; }
log "M-11b invoice_integrity revision 2 validation, PostgreSQL $(cd /tmp; sudo -u postgres psql -Atc 'SHOW server_version' -d postgres | cut -d' ' -f1)"
log "started $(TZ=Asia/Kolkata date '+%Y-%m-%d %H:%M:%S IST'); migration.sql sha256 $(sha256sum migration.sql | cut -c1-16); rollback.sql sha256 $(sha256sum rollback.sql | cut -c1-16); schema.prisma sha256 $(sha256sum schema.prisma | cut -c1-16)"
log ""; log "######## safety_checks.sh (preconditions, existing rows, rollback)"
$V/safety_checks.sh 2>/dev/null | tee -a $L
log ""; log "######## fresh scratch database m11b: 9 applied migrations + seed + M-11b"
$V/rebuild.sh m11b && (cd /tmp && sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d m11b -c "$(cat /home/claude/m11b/migration.sql)") && log "applied: ok" || log "FAIL apply"
(cd /tmp; sudo -u postgres dropdb --if-exists m11b_base; sudo -u postgres createdb -T m11b m11b_base)
log ""; log "######## behaviour_tests.py"
python3 $V/behaviour_tests.py m11b 2>&1 | tee -a $L > /dev/null; tail -1 $L
log ""; log "######## concurrency_tests.py (real sessions, real clock)"
(cd /tmp && sudo -u postgres python3 /home/claude/m11b/$V/concurrency_tests.py) 2>&1 | tee -a $L > /dev/null; tail -1 $L
log ""; log "######## conform.js (proposed schema.prisma vs migrated database)"
cp schema.prisma /tmp/m11bcheck/schema.prisma && (cd /tmp/m11bcheck && DB=m11b node /home/claude/m11b/$V/conform.js) 2>&1 | tee -a $L > /dev/null; tail -1 $L
log ""; log "######## summary"
log "PASS lines: $(grep -c '^PASS' $L); FAIL lines: $(grep -c '^FAIL' $L); MISMATCH lines: $(grep -c '^MISMATCH' $L)"
log "behaviour $(grep -E '^[0-9]+/[0-9]+ passed' $L); concurrency $(grep 'concurrency checks passed' $L); conformance $(grep 'checks match' $L)"
log "finished $(TZ=Asia/Kolkata date '+%Y-%m-%d %H:%M:%S IST')"
