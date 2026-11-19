#!/bin/bash
# M-11a revision 2: two-session races on scratch PostgreSQL 16, real clock (run well before 23:50 IST).
# Each scenario starts from a freshly rebuilt database with M-11a applied, so committed rows from one
# scenario cannot affect the next.
H=/home/claude/m11a
DB=m11a_race
A=aaaaaaaa-0000-0000-0000-000000000001
UA=aaaaaaaa-0000-0000-0000-0000000000a1
B=bbbbbbbb-0000-0000-0000-000000000001
UB=bbbbbbbb-0000-0000-0000-0000000000b1
TODAY="((clock_timestamp() + interval '10 minutes') AT TIME ZONE 'Asia/Kolkata')::date"
CLS="INSERT INTO tax_classifications (id,\"hospitalId\",name,\"supplyType\",\"hsnSac\",\"createdById\",\"updatedAt\") VALUES ('11111111-0000-0000-0000-000000000002','$A','Medicaments','GOODS','3004','$UA',now());"
VER="INSERT INTO tax_classification_versions (id,\"hospitalId\",\"classificationId\",treatment,\"ratePercent\",\"priceIncludesTax\",\"effectiveFrom\",\"createdById\") VALUES ('33333333-0000-0000-0000-000000000001','$A','11111111-0000-0000-0000-000000000002','TAXABLE',5,true,$TODAY,'$UA');"
TZCHANGE="UPDATE hospitals SET timezone='America/Los_Angeles' WHERE id='$A';"
GST="INSERT INTO hospital_gst_registrations (id,\"hospitalId\",\"registrationType\",gstin,\"legalName\",\"stateCode\",\"effectiveFrom\",\"attestedById\") VALUES"

q() { (cd /tmp; sudo -u postgres psql -X -q -d $DB "$@" 2>&1); }
fresh() { $H/rebuild.sh $DB && (cd /tmp; sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d $DB -c "$(cat $H/migration.sql)") && q -c "$CLS" >/dev/null; }
state() { q -Atc "SELECT timezone, (\"taxTimezoneLockedAt\" IS NOT NULL), (SELECT count(*) FROM tax_classification_versions) FROM hospitals WHERE id='$A'"; }

run_race() { # $1 name, $2 iso1, $3 sql1 (held 3 s), $4 iso2, $5 sql2 (starts after 1 s), $6 expected final state
  fresh
  (q -c "BEGIN ISOLATION LEVEL $2; $3 SELECT pg_sleep(3); COMMIT;" > /tmp/s1.out) &
  sleep 1
  local t0=$(date +%s.%N)
  q -c "BEGIN ISOLATION LEVEL $4; $5 COMMIT;" > /tmp/s2.out
  local waited=$(echo "$(date +%s.%N) - $t0" | bc | cut -c1-4)
  wait
  local s=$(state)
  local ok=FAIL; [ "$s" = "$6" ] && ok=PASS
  echo "$ok $1"
  echo "     session 1: $(grep -m1 -E 'ERROR' /tmp/s1.out || echo committed)"
  echo "     session 2 (waited ${waited}s): $(grep -m1 -E 'ERROR' /tmp/s2.out || echo committed)"
  echo "     final: timezone|locked|versions = $s (expected $6)"
}

# 1. First version holds the hospital row; a time-zone change arrives meanwhile.
run_race "RC: version first, then time-zone change: change waits, then is refused" \
  "READ COMMITTED" "$VER" "READ COMMITTED" "$TZCHANGE" "Asia/Kolkata|t|1"
# 2. Time-zone change holds the row; the first version arrives meanwhile.
run_race "RC: time-zone change first, then version: version waits, then uses the new zone and locks it" \
  "READ COMMITTED" "$TZCHANGE" "READ COMMITTED" "$VER" "America/Los_Angeles|t|1"
# 3. and 4. The same under REPEATABLE READ for the second session.
run_race "RR: version first, then time-zone change: change fails, zone unchanged" \
  "READ COMMITTED" "$VER" "REPEATABLE READ" "$TZCHANGE" "Asia/Kolkata|t|1"
run_race "RR: time-zone change first, then version: version fails with a serialization error" \
  "READ COMMITTED" "$TZCHANGE" "REPEATABLE READ" "$VER" "America/Los_Angeles|f|0"
# 5. A GST registration races a time-zone change.
run_race "RC: registration first, then time-zone change: change refused" \
  "READ COMMITTED" "$GST ('44444444-0000-0000-0000-000000000001','$A','UNREGISTERED',NULL,NULL,NULL,$TODAY,'$UA');" \
  "READ COMMITTED" "$TZCHANGE" "Asia/Kolkata|t|0"
# 6. SERIALIZABLE second session, version first.
run_race "SERIALIZABLE: version first, then time-zone change: change fails, zone unchanged" \
  "READ COMMITTED" "$VER" "SERIALIZABLE" "$TZCHANGE" "Asia/Kolkata|t|1"
