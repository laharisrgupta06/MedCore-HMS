#!/bin/bash
# M-11a revision 3: how late can a commit become visible after its commit-time check, and what do the
# row locks guarantee? Scratch PostgreSQL 16 only. Test 1 changes the cluster setting
# synchronous_standby_names and always restores it.
H=/home/claude/m11a
A=aaaaaaaa-0000-0000-0000-000000000001; UA=aaaaaaaa-0000-0000-0000-0000000000a1
C=11111111-0000-0000-0000-000000000002; V=33333333-0000-0000-0000-000000000001
q() { local db=$1; shift; (cd /tmp; sudo -u postgres psql -X -q -d "$db" "$@" 2>&1); }
fresh() { $H/rebuild.sh "$1" && (cd /tmp; sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "$1" -c "$(cat $H/migration.sql)"); }
setup_version() { # classification + a version 30 days ahead (12%); the tax date stamp locks the zone
  q "$1" -c "INSERT INTO tax_classifications (id,\"hospitalId\",name,\"supplyType\",\"hsnSac\",\"createdById\",\"updatedAt\") VALUES ('$C','$A','Medicaments','GOODS','3004','$UA',now());
             INSERT INTO tax_classification_versions (id,\"hospitalId\",\"classificationId\",treatment,\"ratePercent\",\"priceIncludesTax\",\"effectiveFrom\",\"createdById\") VALUES ('$V','$A','$C','TAXABLE',12,true,current_date + 30,'$UA');" >/dev/null
}
rate() { q "$1" -Atc "SELECT \"ratePercent\" FROM tax_classification_versions WHERE id='$V'"; }
pass() { echo "PASS $1"; }; fail() { echo "FAIL $1"; }

echo "== 1. A commit stalled after its commit-time check (synchronous replication to a missing standby)"
restore_sync() { (cd /tmp; sudo -u postgres psql -X -q -d postgres -c "ALTER SYSTEM RESET synchronous_standby_names" -c "SELECT pg_reload_conf()" >/dev/null 2>&1); }
trap restore_sync EXIT
DB=m11a_t1; fresh $DB; setup_version $DB
q postgres -c "ALTER SYSTEM SET synchronous_standby_names = 'missing_standby'" -c "SELECT pg_reload_conf()" >/dev/null; sleep 1
# The writer passes every check (statement-time and commit-time) and then waits for the standby.
(cd /tmp; sudo -u postgres env PGAPPNAME=stalled_writer timeout 60 psql -X -q -d $DB \
   -c "BEGIN; UPDATE tax_classification_versions SET \"ratePercent\" = 5 WHERE id='$V'; COMMIT;" > /tmp/w1.out 2>&1) &
sleep 2
WAIT=$(q $DB -Atc "SELECT wait_event FROM pg_stat_activity WHERE application_name = 'stalled_writer'")
NOLOCK=$(rate $DB)
# The locking reader ends with ROLLBACK: its own COMMIT would also wait for the missing standby.
(cd /tmp; sudo -u postgres env PGAPPNAME=locking_reader timeout 60 psql -X -q -At -d $DB \
   -c "BEGIN; SELECT 1 FROM hospitals WHERE id='$A' FOR SHARE; SELECT 1 FROM tax_classifications WHERE id='$C' FOR SHARE; SELECT \"ratePercent\" FROM tax_classification_versions WHERE id='$V'; ROLLBACK;" > /tmp/r1.out 2>&1) &
sleep 5
READER_STATE=$(q $DB -Atc "SELECT wait_event_type || '/' || wait_event FROM pg_stat_activity WHERE application_name = 'locking_reader'")
STALL_SECONDS=$(q $DB -Atc "SELECT round(extract(epoch FROM clock_timestamp() - state_change)) FROM pg_stat_activity WHERE application_name = 'stalled_writer'")
q $DB -Atc "SELECT pg_cancel_backend(pid) FROM pg_stat_activity WHERE application_name = 'stalled_writer'" >/dev/null
wait
restore_sync; trap - EXIT
echo "     writer, after passing its commit-time check: wait_event = $WAIT for ${STALL_SECONDS}s so far (no limit applies)"
echo "     reader without locks during the stall saw rate $NOLOCK (the old value: the commit was not yet visible)"
echo "     locking reader during the stall: $READER_STATE"
echo "     writer when the wait was cancelled: $(grep -m1 -o 'already committed locally' /tmp/w1.out)"
echo "     locking reader then read: $(grep -E '^[0-9]+[.][0-9]+$' /tmp/r1.out)"
[ "$WAIT" = "SyncRep" ] && [ "$NOLOCK" = "12.00" ] && [ "${READER_STATE%%/*}" = "Lock" ] && grep -qx "5.00" /tmp/r1.out && [ "$(rate $DB)" = "5.00" ] \
  && pass "a commit became visible ${STALL_SECONDS}+ s after its check; the unlocked read saw the old value; the locked read waited for the final value" \
  || fail "commit stall"
[ -z "$(q postgres -Atc "SHOW synchronous_standby_names")" ] && pass "synchronous_standby_names restored" || fail "setting not restored"

echo "== 2. SET CONSTRAINTS ALL IMMEDIATE moves the commit-time check earlier (simulated clock)"
DB=m11a_t2; fresh $DB; setup_version $DB
q $DB -c "CREATE OR REPLACE FUNCTION medcore_tax_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS \$\$ SELECT current_setting('medcore_test.clock')::timestamptz \$\$" >/dev/null
q $DB -c "SET medcore_test.clock = '2026-11-18 12:00+05:30'; UPDATE hospitals SET timezone = timezone WHERE id='$A';" >/dev/null
q $DB -c "ALTER TABLE tax_classification_versions DISABLE TRIGGER USER; UPDATE tax_classification_versions SET \"effectiveFrom\" = '2026-11-19'; ALTER TABLE tax_classification_versions ENABLE TRIGGER USER;" >/dev/null
OUT=$(q $DB -c "BEGIN; SET LOCAL medcore_test.clock = '2026-11-18 23:45+05:30';
                UPDATE tax_classification_versions SET \"ratePercent\" = 5 WHERE id='$V';
                SET CONSTRAINTS ALL IMMEDIATE;
                SET LOCAL medcore_test.clock = '2026-11-19 00:30+05:30'; COMMIT;")
R=$(rate $DB)
echo "     commit at a simulated 00:30 after an immediate check at 23:45: ${OUT:-no error}; rate now $R"
[ "$R" = "5.00" ] && pass "the bypass is real: the version took effect at midnight but its edit committed at 00:30" || fail "bypass not reproduced"

echo "== 3. ... but a locking reader still waits for the final value (bypass plus a client idle in transaction)"
DB=m11a_t3; fresh $DB; setup_version $DB
( (echo "BEGIN; UPDATE tax_classification_versions SET \"ratePercent\" = 5 WHERE id='$V'; SET CONSTRAINTS ALL IMMEDIATE;"; sleep 4; echo "COMMIT;") \
   | (cd /tmp; sudo -u postgres psql -X -q -d $DB) > /tmp/w3.out 2>&1 ) &
sleep 1
T0=$(date +%s)
R=$(q $DB -Atc "BEGIN; SELECT 1 FROM hospitals WHERE id='$A' FOR SHARE; SELECT 1 FROM tax_classifications WHERE id='$C' FOR SHARE; SELECT \"ratePercent\" FROM tax_classification_versions WHERE id='$V'; COMMIT;" | grep -E '^[0-9]+\.[0-9]+$')
W=$(( $(date +%s) - T0 )); wait
echo "     locking reader waited ${W}s and read $R"
[ "$R" = "5.00" ] && [ "$W" -ge 2 ] && pass "locking reader saw only the writer's final committed value" || fail "locking reader"

echo "== 4. idle_in_transaction_session_timeout ends a client idling after its immediate check"
DB=m11a_t4; fresh $DB; setup_version $DB
( (echo "SET idle_in_transaction_session_timeout = '2s'; BEGIN; UPDATE tax_classification_versions SET \"ratePercent\" = 5 WHERE id='$V'; SET CONSTRAINTS ALL IMMEDIATE;"; sleep 4; echo "COMMIT;") \
   | (cd /tmp; sudo -u postgres psql -X -q -d $DB) > /tmp/w4.out 2>&1 )
R=$(rate $DB)
echo "     session: $(grep -m1 -o 'terminating connection due to idle-in-transaction timeout' /tmp/w4.out)"
[ "$R" = "12.00" ] && grep -q "idle-in-transaction timeout" /tmp/w4.out && pass "idle session terminated; its edit rolled back (rate $R)" || fail "idle timeout"
TT=$(q postgres -Atc "SHOW transaction_timeout" | head -1)
echo "     SHOW transaction_timeout on PostgreSQL $(q postgres -Atc 'SHOW server_version'): $TT"
echo "$TT" | grep -q "unrecognized configuration parameter" && pass "no total transaction timeout in PostgreSQL 16 (transaction_timeout arrives in 17)" || fail "transaction_timeout check"

echo "== 5. The registration lock (FOR NO KEY UPDATE on the hospital) does not block foreign-key checks"
DB=m11a_t5; fresh $DB
(q $DB -c "BEGIN; INSERT INTO hospital_gst_registrations (id,\"hospitalId\",\"registrationType\",\"effectiveFrom\",\"attestedById\") VALUES ('44444444-0000-0000-0000-000000000001','$A','UNREGISTERED',current_date + 30,'$UA'); SELECT pg_sleep(4); COMMIT;" >/dev/null) &
sleep 1; T0=$(date +%s.%N)
D=$(q $DB -c "INSERT INTO departments (id,\"hospitalId\",name,\"updatedAt\") VALUES (gen_random_uuid(),'$A','Cardiology',now())" 2>&1)
W=$(echo "$(date +%s.%N) - $T0" | bc | cut -c1-4); wait
echo "     department insert for the same hospital during the registration write: ${D:-ok} after ${W}s"
[ -z "$D" ] && [ "$(echo "$W < 1" | bc)" = "1" ] && pass "foreign-key inserts are not delayed by the registration lock" || fail "FK insert delayed"

echo "== 6. Lock order: a first version (stamps the hospital) and a locking reader do not deadlock"
DB=m11a_t6; fresh $DB
q $DB -c "INSERT INTO tax_classifications (id,\"hospitalId\",name,\"supplyType\",\"hsnSac\",\"createdById\",\"updatedAt\") VALUES ('$C','$A','Medicaments','GOODS','3004','$UA',now());" >/dev/null
(q $DB -c "BEGIN; SELECT 1 FROM hospitals WHERE id='$A' FOR SHARE; SELECT pg_sleep(2); SELECT 1 FROM tax_classifications WHERE id='$C' FOR SHARE; COMMIT;" > /tmp/r6.out) &
sleep 0.5
q $DB -c "INSERT INTO tax_classification_versions (id,\"hospitalId\",\"classificationId\",treatment,\"ratePercent\",\"priceIncludesTax\",\"effectiveFrom\",\"createdById\") VALUES ('$V','$A','$C','TAXABLE',5,true,current_date + 30,'$UA');" > /tmp/w6.out
wait
if grep -q deadlock /tmp/r6.out /tmp/w6.out; then fail "deadlock"; else
  [ "$(q $DB -Atc "SELECT count(*) FROM tax_classification_versions")" = "1" ] && pass "no deadlock; the version committed after the reader" || fail "version missing"; fi

echo "== 7. A new version inserted by a writer that is slow to commit: the locking reader waits and resolves it"
DB=m11a_t7; fresh $DB; setup_version $DB
( (echo "BEGIN; INSERT INTO tax_classification_versions (id,\"hospitalId\",\"classificationId\",treatment,\"ratePercent\",\"priceIncludesTax\",\"effectiveFrom\",\"createdById\") VALUES ('33333333-0000-0000-0000-000000000002','$A','$C','NIL_RATED',0,false,current_date + 20,'$UA');"; sleep 4; echo "COMMIT;") \
   | (cd /tmp; sudo -u postgres psql -X -q -d $DB) > /tmp/w7.out 2>&1 ) &
sleep 1; T0=$(date +%s)
R=$(q $DB -Atc "BEGIN; SELECT 1 FROM hospitals WHERE id='$A' FOR SHARE; SELECT 1 FROM tax_classifications WHERE id='$C' FOR SHARE;
     SELECT treatment FROM tax_classification_versions WHERE \"classificationId\"='$C' AND \"effectiveFrom\" <= current_date + 25 ORDER BY \"effectiveFrom\" DESC LIMIT 1; COMMIT;" | grep -E '^[A-Z_]+$')
W=$(( $(date +%s) - T0 )); wait
echo "     version in force on day +25 as resolved by the locking reader after waiting ${W}s: $R"
[ "$R" = "NIL_RATED" ] && [ "$W" -ge 2 ] && pass "the reader waited and resolved the newly committed version" || fail "insert visibility"

echo "== 8. Control: the same slow writer with the writer locks removed (revision 2): the reader does not wait"
DB=m11a_t8
# The control is this migration with its two writer-lock blocks removed (exactly revision 2's behaviour).
python3 - "$H/migration.sql" > /tmp/migration.nolock.sql <<'PY'
import re, sys
s = open(sys.argv[1]).read()
# Each writer-lock block is "  IF TG_WHEN = 'BEFORE' THEN ... FOR NO KEY UPDATE ...  END IF;" at two-space
# indent; revision 4's block also holds the active-classification check, removed with it (revision 2).
blocks = re.compile(r"  IF TG_WHEN = 'BEFORE' THEN\n(?:(?:    [^\n]*)?\n)*?  END IF;\n")
n = 0
def drop(m):
    global n
    if "FOR NO KEY UPDATE" in m.group(0):
        n += 1
        return ""
    return m.group(0)
s2 = blocks.sub(drop, s)
assert n == 2, n
sys.stdout.write(s2)
PY
$H/rebuild.sh $DB && (cd /tmp; sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d $DB -c "$(cat /tmp/migration.nolock.sql)"); setup_version $DB
( (echo "BEGIN; UPDATE tax_classification_versions SET \"ratePercent\" = 5 WHERE id='$V';"; sleep 4; echo "COMMIT;") \
   | (cd /tmp; sudo -u postgres psql -X -q -d $DB) > /tmp/w8.out 2>&1 ) &
sleep 1; T0=$(date +%s)
R=$(q $DB -Atc "BEGIN; SELECT 1 FROM hospitals WHERE id='$A' FOR SHARE; SELECT 1 FROM tax_classifications WHERE id='$C' FOR SHARE; SELECT \"ratePercent\" FROM tax_classification_versions WHERE id='$V'; COMMIT;" | grep -E '^[0-9]+[.][0-9]+$')
W=$(( $(date +%s) - T0 )); wait
echo "     without writer locks: reader waited ${W}s and read $R while the writer was still open"
[ "$R" = "12.00" ] && [ "$W" -lt 2 ] && pass "without the writer locks the reader reads a value about to change (the gap revision 3 closes)" || fail "control"

echo "== 9. One transaction edits a version and then adds a registration, against a locking reader"
DB=m11a_t9; fresh $DB; setup_version $DB
( (echo "BEGIN; UPDATE tax_classification_versions SET \"ratePercent\" = 5 WHERE id='$V';"; sleep 2; echo "INSERT INTO hospital_gst_registrations (id,\"hospitalId\",\"registrationType\",\"effectiveFrom\",\"attestedById\") VALUES (gen_random_uuid(),'$A','UNREGISTERED',current_date + 30,'$UA'); COMMIT;") \
   | (cd /tmp; sudo -u postgres psql -X -q -d $DB) > /tmp/w9.out 2>&1 ) &
sleep 1
q $DB -Atc "BEGIN; SELECT 1 FROM hospitals WHERE id='$A' FOR SHARE; SELECT 1 FROM tax_classifications WHERE id='$C' FOR SHARE; SELECT \"ratePercent\" FROM tax_classification_versions WHERE id='$V'; COMMIT;" > /tmp/r9.out
wait
echo "     writer: $(grep -m1 ERROR /tmp/w9.out || echo committed); reader: $(grep -m1 ERROR /tmp/r9.out || grep -E '^[0-9]+[.][0-9]+$' /tmp/r9.out)"
! grep -q ERROR /tmp/w9.out /tmp/r9.out && grep -qx "5.00" /tmp/r9.out && pass "no deadlock: every writer takes the hospital row first; the reader saw the final value" || fail "mixed writer"
