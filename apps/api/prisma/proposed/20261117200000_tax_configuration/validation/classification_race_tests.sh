#!/bin/bash
# M-11a revision 4: two-session races between assigning a classification, adding a version, and
# deactivating that classification, at READ COMMITTED, REPEATABLE READ and SERIALIZABLE; lock order;
# and a control (revision 3 assignment check, which read without locking) that shows the gap.
# Scratch PostgreSQL 16 only. Real clock; versions start 30 days ahead, so the time of day is irrelevant.
H=/home/claude/m11a
A=aaaaaaaa-0000-0000-0000-000000000001; UA=aaaaaaaa-0000-0000-0000-0000000000a1
LAB=aaaaaaaa-0000-0000-0000-00000000c001; MED=aaaaaaaa-0000-0000-0000-00000000d001
C=11111111-0000-0000-0000-0000000000c1; G=11111111-0000-0000-0000-0000000000c2
q() { (cd /tmp; sudo -u postgres psql -X -q -d "$DB" "$@" 2>&1); }
pass() { echo "PASS $1"; }; fail() { echo "FAIL $1"; }
fresh() { # $1 migration file
  $H/rebuild.sh "$DB" && (cd /tmp; sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "$DB" -c "$(cat "$1")") && \
  q -c "INSERT INTO tax_classifications (id,\"hospitalId\",name,\"supplyType\",\"hsnSac\",\"createdById\",\"updatedAt\") VALUES
          ('$C','$A','Health care','SERVICE','9993','$UA',now()), ('$G','$A','Medicaments','GOODS','3004','$UA',now())" >/dev/null; }
# $1 isolation, $2 first session (held open 3 s), $3 second session (starts after 1 s)
race() {
  ( (echo "BEGIN ISOLATION LEVEL $1; $2"; sleep 3; echo "COMMIT;") | (cd /tmp; sudo -u postgres psql -X -q -d "$DB") > /tmp/cr1.out 2>&1 ) &
  sleep 1
  (echo "BEGIN ISOLATION LEVEL $1; $3 COMMIT;" | (cd /tmp; sudo -u postgres psql -X -q -d "$DB") > /tmp/cr2.out 2>&1)
  wait
  S1=$(grep -m1 -o 'ERROR:.*' /tmp/cr1.out || echo committed); S2=$(grep -m1 -o 'ERROR:.*' /tmp/cr2.out || echo committed)
  echo "     session 1: $S1"; echo "     session 2: $S2"
}
active() { q -Atc "SELECT \"isActive\" FROM tax_classifications WHERE id='$1'"; }
count() { q -Atc "SELECT count(*) FROM $1"; }
ASSIGN="INSERT INTO hospital_tax_defaults VALUES ('$A','CONSULTATION','$C','$UA',now());"
DEACT="UPDATE tax_classifications SET \"isActive\" = false WHERE id='$C';"
VERSION="INSERT INTO tax_classification_versions (id,\"hospitalId\",\"classificationId\",treatment,\"ratePercent\",\"priceIncludesTax\",\"effectiveFrom\",\"createdById\") VALUES (gen_random_uuid(),'$A','$C','EXEMPT',0,false,current_date + 30,'$UA');"
MIG=$H/migration.sql
DB=m11a_crace

n=0
for ISO in "READ COMMITTED" "REPEATABLE READ" "SERIALIZABLE"; do
  echo "== $ISO: default assigned first, deactivation while it is open"
  fresh $MIG; race "$ISO" "$ASSIGN" "$DEACT"
  [ "$S1" = committed ] && [ "$S2" != committed ] && [ "$(active $C)" = t ] && [ "$(count hospital_tax_defaults)" = 1 ] \
    && pass "$ISO: deactivation refused or serialized; the default keeps an active classification" || fail "$ISO: default then deactivate"
  echo "== $ISO: deactivation first, default assigned while it is open"
  fresh $MIG; race "$ISO" "$DEACT" "$ASSIGN"
  [ "$S1" = committed ] && [ "$S2" != committed ] && [ "$(active $C)" = f ] && [ "$(count hospital_tax_defaults)" = 0 ] \
    && pass "$ISO: assignment refused or serialized; no default points at the inactive classification" || fail "$ISO: deactivate then default"
  echo "== $ISO: version added first, deactivation while it is open"
  fresh $MIG; race "$ISO" "$VERSION" "$DEACT"
  [ "$S1" = committed ] && [ "$S2" = committed ] && [ "$(active $C)" = f ] && [ "$(count tax_classification_versions)" = 1 ] \
    && pass "$ISO: deactivation waits and succeeds; the version recorded while active stays" || fail "$ISO: version then deactivate"
  echo "== $ISO: deactivation first, version added while it is open"
  fresh $MIG; race "$ISO" "$DEACT" "$VERSION"
  [ "$S1" = committed ] && [ "$S2" != committed ] && [ "$(count tax_classification_versions)" = 0 ] \
    && pass "$ISO: the new version is refused or serialized; none on the inactive classification" || fail "$ISO: deactivate then version"
done

echo "== READ COMMITTED: deactivation first, lab test and medicine assigned while it is open"
fresh $MIG
race "READ COMMITTED" "$DEACT UPDATE tax_classifications SET \"isActive\" = false WHERE id='$G';" \
  "UPDATE lab_tests SET \"taxClassificationId\"='$C' WHERE id='$LAB';"
L=$S2
( (echo "BEGIN; UPDATE tax_classifications SET \"isActive\" = true WHERE id IN ('$C','$G');"; sleep 0; echo "COMMIT;") | (cd /tmp; sudo -u postgres psql -X -q -d "$DB") >/dev/null 2>&1 )
race "READ COMMITTED" "UPDATE tax_classifications SET \"isActive\" = false WHERE id='$G';" \
  "UPDATE medicines SET \"taxClassificationId\"='$G' WHERE id='$MED';"
[ "$L" != committed ] && [ "$S2" != committed ] && [ "$(q -Atc "SELECT count(*) FROM lab_tests WHERE \"taxClassificationId\" IS NOT NULL")$(q -Atc "SELECT count(*) FROM medicines WHERE \"taxClassificationId\" IS NOT NULL")" = 00 ] \
  && pass "lab test and medicine assignments also wait and are refused" || fail "lab test / medicine assignment"

echo "== Lock order: one transaction assigns a default and then adds a version, against a locking reader"
fresh $MIG
( (echo "BEGIN; $ASSIGN"; sleep 2; echo "$VERSION COMMIT;") | (cd /tmp; sudo -u postgres psql -X -q -d "$DB") > /tmp/cr1.out 2>&1 ) &
sleep 1
q -Atc "BEGIN; SELECT 1 FROM hospitals WHERE id='$A' FOR SHARE; SELECT 1 FROM tax_classifications WHERE id='$C' FOR SHARE; SELECT count(*) FROM tax_classification_versions; COMMIT;" > /tmp/cr2.out
wait
if grep -q ERROR /tmp/cr1.out /tmp/cr2.out; then fail "lock order: $(grep -h -m1 ERROR /tmp/cr1.out /tmp/cr2.out)"
else grep -qx 1 /tmp/cr2.out && pass "no deadlock; the reader waited and saw the committed version" || fail "lock order: reader saw $(tr '\n' ' ' < /tmp/cr2.out)"; fi

echo "== An open assignment does not block plain reads or foreign-key inserts for the hospital"
fresh $MIG
( (echo "BEGIN; $ASSIGN"; sleep 3; echo "COMMIT;") | (cd /tmp; sudo -u postgres psql -X -q -d "$DB") >/dev/null 2>&1 ) &
sleep 1; T0=$(date +%s.%N)
R=$(q -Atc "SELECT \"isActive\" FROM tax_classifications WHERE id='$C'")
D=$(q -c "INSERT INTO departments (id,\"hospitalId\",name,\"updatedAt\") VALUES (gen_random_uuid(),'$A','Cardiology',now())")
W=$(echo "$(date +%s.%N) - $T0" | bc | cut -c1-4); wait
[ "$R" = t ] && [ -z "$D" ] && [ "$(echo "$W < 1" | bc)" = 1 ] && pass "plain read and department insert done in ${W}s" || fail "blocked: read=$R insert=${D:-ok} after ${W}s"

echo "== Control: revision 3's assignment check (read without locking), READ COMMITTED and REPEATABLE READ"
python3 - "$MIG" > /tmp/migration.rev3check.sql <<'PY'
import sys
s = open(sys.argv[1]).read()
new = '''  PERFORM 1 FROM hospitals WHERE id = NEW."hospitalId" FOR NO KEY UPDATE;
  UPDATE tax_classifications SET "isActive" = "isActive"
   WHERE id = ref AND "hospitalId" = NEW."hospitalId"
   RETURNING "supplyType", "isActive" INTO c;
'''
old = '''  SELECT "supplyType", "isActive" INTO c FROM tax_classifications
   WHERE id = ref AND "hospitalId" = NEW."hospitalId";
'''
assert s.count(new) == 1
sys.stdout.write(s.replace(new, old))
PY
for ISO in "READ COMMITTED" "REPEATABLE READ"; do
  fresh /tmp/migration.rev3check.sql; race "$ISO" "$ASSIGN" "$DEACT"
  [ "$S1" = committed ] && [ "$S2" = committed ] && [ "$(active $C)" = f ] && [ "$(count hospital_tax_defaults)" = 1 ] \
    && pass "control $ISO: without the fix both commit and a default points at an inactive classification" || fail "control $ISO"
done

echo "== Rehearsal of T-MIG-TAX-013 (NOWAIT and lock_timeout from a second session), revision 4 and control"
for M in "$MIG" /tmp/migration.rev3check.sql; do
  fresh "$M"
  ( (echo "BEGIN; $ASSIGN"; sleep 3; echo "COMMIT;") | (cd /tmp; sudo -u postgres psql -X -q -d "$DB") >/dev/null 2>&1 ) &
  sleep 1
  N=$(q -Atc "SELECT 1 FROM hospitals WHERE id='$A' FOR SHARE NOWAIT" | grep -c "could not obtain lock")
  T=$(q -c "BEGIN; SET LOCAL lock_timeout = '300ms'; $DEACT ROLLBACK;" | grep -c "lock timeout")
  wait
  AFTER=$(q -c "$DEACT" | grep -o "used as a hospital default")
  if [ "$M" = "$MIG" ]; then
    [ "$N$T" = 11 ] && [ -n "$AFTER" ] && pass "T-MIG-TAX-013 rehearsal: hospital row locked, deactivation waits, then refused" || fail "T-MIG-TAX-013 rehearsal (nowait=$N timeout=$T after=$AFTER)"
  else
    [ "$N$T" = 00 ] && pass "T-MIG-TAX-013 rehearsal on the control: no lock held, so the test would fail without the fix" || fail "control rehearsal (nowait=$N timeout=$T)"
  fi
done
