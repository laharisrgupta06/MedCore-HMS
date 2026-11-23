#!/bin/bash
# Full M-11a validation run; writes results-rev4.txt. The scripts must be executable (chmod +x *.sh). Concurrency races use the real clock: run before 23:50 IST.
cd /home/claude/m11a; L=/home/claude/m11a/results-rev4.txt; : > $L
log() { echo "$@" | tee -a $L; }
run() { log ""; log "######## $1"; shift; "$@" 2>&1 | tee -a $L > /dev/null; }
P=/mnt/user-data/uploads/MedCore-HMS/apps/api/prisma/migrations
log "M-11a revision 4 validation, PostgreSQL $(cd /tmp; sudo -u postgres psql -Atc 'SHOW server_version' -d postgres | cut -d' ' -f1)"
log "started $(TZ=Asia/Kolkata date '+%Y-%m-%d %H:%M:%S IST'); migration.sql md5 $(md5sum migration.sql | cut -d' ' -f1); rollback.sql md5 $(md5sum rollback.sql | cut -d' ' -f1); schema.prisma md5 $(md5sum prisma/schema.prisma | cut -d' ' -f1)"
run "concurrency_tests.sh (real clock)" ./concurrency_tests.sh
log ""; log "######## existing rows and migration application (fresh scratch database m11a)"
OKSTEP=1; ./rebuild.sh m11a || { OKSTEP=0; log "FAIL rebuild of the scratch database"; }; B=$(cd /tmp; sudo -u postgres psql -d m11a -Atf /home/claude/m11a/dataq_old.sql | md5sum)
(cd /tmp; sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d m11a -c "$(cat /home/claude/m11a/migration.sql)") && log "applied as one multi-statement query: ok" || { OKSTEP=0; log "FAIL migration did not apply"; }
A=$(cd /tmp; sudo -u postgres psql -d m11a -Atf /home/claude/m11a/dataq_old.sql | md5sum)
[ "$OKSTEP" = 1 ] && [ "$B" = "$A" ] && log "PASS existing rows identical by hash before and after (new columns excluded): ${A%% *}" || log "FAIL existing rows changed"
log "applied migrations used: $(ls $P | grep -c '^2') (last $(ls $P | grep '^2' | sort | tail -1))"
log "object counts: $(cd /tmp; sudo -u postgres psql -d m11a -Atc "SELECT (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations')||' tables, '||(SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal)||' triggers, '||(SELECT count(*) FROM pg_constraint WHERE contype='x')||' exclusions'")"
run "behaviour_tests.py" python3 behaviour_tests.py m11a
run "conform.js (proposed schema.prisma vs migrated database)" bash -c "cp prisma/schema.prisma /tmp/prismacheck/schema.prisma && cd /tmp/prismacheck && node conform.js"
run "gstin_verification.py" python3 gstin_verification.py m11a
run "commit_tests.sh" ./commit_tests.sh
run "rollback_checks.sh" ./rollback_checks.sh
run "timing_tests.sh (commit stall, SET CONSTRAINTS bypass, timeouts, lock order)" ./timing_tests.sh
run "lock_nowait_tests.sh (SQL rehearsal of T-MIG-TAX-011) - final migration" ./lock_nowait_tests.sh
run "lock_nowait_tests.sh - control: writer locks removed" ./lock_nowait_tests.sh /tmp/migration.nolock.sql
run "classification_race_tests.sh (assignment, version and deactivation races; revision 4)" ./classification_race_tests.sh
log ""; log "######## summary"
log "PASS lines: $(grep -c '^PASS' $L); FAIL lines: $(grep -c '^FAIL' $L)"
log "behaviour $(grep -E '^[0-9]+/[0-9]+ passed' $L); conformance $(grep 'checks match' $L); GSTIN $(grep 'checks passed' $L)"
log "synchronous_standby_names after the run: '$(cd /tmp; sudo -u postgres psql -Atc 'SHOW synchronous_standby_names' -d postgres)'"
log "finished $(TZ=Asia/Kolkata date '+%Y-%m-%d %H:%M:%S IST')"
