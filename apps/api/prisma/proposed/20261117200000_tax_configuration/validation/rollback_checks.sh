#!/bin/bash
# Atomicity, re-apply and manual-reversal checks for M-11a on scratch PostgreSQL 16.
H=/home/claude/m11a; MIG="$(cat $H/migration.sql)"; RB="$(cat $H/rollback.sql)"
psqlq() { (cd /tmp; sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "$1" -c "$2" 2>&1); }
data() { (cd /tmp; sudo -u postgres psql -d "$1" -Atf $H/dataq.sql); }
# 1. Failure at the end of the file leaves no trace.
$H/rebuild.sh m11a_fail; $H/dump.sh m11a_fail > /tmp/a1; D1=$(data m11a_fail)
psqlq m11a_fail "$MIG
SELECT 1/0;" | head -1
$H/dump.sh m11a_fail > /tmp/a2; [ "$(data m11a_fail)" = "$D1" ] && cmp -s /tmp/a1 /tmp/a2 && echo "PASS atomic: schema and data identical after an injected failure" || echo "FAIL atomic"
# 2. Re-applying to a migrated database fails on the first statement and changes nothing.
$H/rebuild.sh m11a_re; psqlq m11a_re "$MIG" >/dev/null; $H/dump.sh m11a_re > /tmp/b1
psqlq m11a_re "$MIG" | head -1; $H/dump.sh m11a_re > /tmp/b2; cmp -s /tmp/b1 /tmp/b2 && echo "PASS re-apply refused, nothing changed" || echo "FAIL re-apply"
# 3. Manual reversal restores the exact pre-M-11a schema and data.
$H/rebuild.sh m11a_down; psqlq m11a_down 'CREATE TABLE "_prisma_migrations" (migration_name text)' >/dev/null
$H/dump.sh m11a_down > /tmp/c1; D3=$(data m11a_down)
psqlq m11a_down "INSERT INTO \"_prisma_migrations\" VALUES ('20261117200000_tax_configuration')" >/dev/null
psqlq m11a_down "$MIG" >/dev/null && psqlq m11a_down "$RB" >/dev/null
$H/dump.sh m11a_down > /tmp/c2; [ "$(data m11a_down)" = "$D3" ] && cmp -s /tmp/c1 /tmp/c2 && echo "PASS reversal: schema and data identical to before M-11a, migration record removed" || echo "FAIL reversal"
# 4. Reversal refuses once configuration exists.
psqlq m11a_down "$MIG" >/dev/null
psqlq m11a_down "INSERT INTO tax_classifications (id,\"hospitalId\",name,\"supplyType\",\"hsnSac\",\"createdById\",\"updatedAt\") VALUES ('11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','S','SERVICE','9993','aaaaaaaa-0000-0000-0000-0000000000a1',now())" >/dev/null
$H/dump.sh m11a_down > /tmp/d1; psqlq m11a_down "$RB" | head -1; $H/dump.sh m11a_down > /tmp/d2
cmp -s /tmp/d1 /tmp/d2 && echo "PASS reversal refused with configuration present, nothing changed" || echo "FAIL reversal guard"
# 5. Revision 2: a later statutory rule (as a future migration would add) blocks the reversal.
$H/rebuild.sh m11a_down; psqlq m11a_down 'CREATE TABLE "_prisma_migrations" (migration_name text)' >/dev/null
psqlq m11a_down "$MIG" >/dev/null
psqlq m11a_down "INSERT INTO statutory_room_tax_rules (\"effectiveFrom\",\"thresholdPerDay\",\"ratePercent\",\"sacCode\",\"legalReference\") VALUES ('2027-04-01',7500,5,'9993','hypothetical later rule')" >/dev/null
$H/dump.sh m11a_down > /tmp/e1; N1=$(cd /tmp; sudo -u postgres psql -d m11a_down -Atc "select count(*) from statutory_room_tax_rules")
psqlq m11a_down "$RB" | head -1; $H/dump.sh m11a_down > /tmp/e2
cmp -s /tmp/e1 /tmp/e2 && [ "$N1" = "2" ] && echo "PASS reversal refused with a later statutory rule; both rules kept" || echo "FAIL later-rule guard"
# 6. A seed row altered behind the append-only trigger (only possible for a superuser) also blocks it.
$H/rebuild.sh m11a_down; psqlq m11a_down 'CREATE TABLE "_prisma_migrations" (migration_name text)' >/dev/null
psqlq m11a_down "$MIG" >/dev/null
psqlq m11a_down 'ALTER TABLE statutory_room_tax_rules DISABLE TRIGGER statutory_room_tax_rules_append_only; UPDATE statutory_room_tax_rules SET "thresholdPerDay" = 6000; ALTER TABLE statutory_room_tax_rules ENABLE TRIGGER statutory_room_tax_rules_append_only;' >/dev/null
$H/dump.sh m11a_down > /tmp/f1; psqlq m11a_down "$RB" | head -1; $H/dump.sh m11a_down > /tmp/f2
cmp -s /tmp/f1 /tmp/f2 && echo "PASS reversal refused when the seed row differs from M-11a's" || echo "FAIL altered-seed guard"
# 7. A time-zone lock left by a future version that was then deleted does not block the reversal.
$H/rebuild.sh m11a_down; psqlq m11a_down 'CREATE TABLE "_prisma_migrations" (migration_name text)' >/dev/null
$H/dump.sh m11a_down > /tmp/g1; D7=$(data m11a_down)
psqlq m11a_down "INSERT INTO \"_prisma_migrations\" VALUES ('20261117200000_tax_configuration')" >/dev/null
psqlq m11a_down "$MIG" >/dev/null
psqlq m11a_down "INSERT INTO tax_classifications (id,\"hospitalId\",name,\"supplyType\",\"hsnSac\",\"createdById\",\"updatedAt\") VALUES ('11111111-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','M','GOODS','3004','aaaaaaaa-0000-0000-0000-0000000000a1',now()); INSERT INTO hospital_gst_registrations (id,\"hospitalId\",\"registrationType\",\"effectiveFrom\",\"attestedById\") VALUES ('44444444-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','UNREGISTERED',current_date + 30,'aaaaaaaa-0000-0000-0000-0000000000a1'); DELETE FROM hospital_gst_registrations;" >/dev/null
L=$(cd /tmp; sudo -u postgres psql -d m11a_down -Atc "select \"taxTimezoneLockedAt\" is not null from hospitals where id='aaaaaaaa-0000-0000-0000-000000000001'")
psqlq m11a_down "$RB" | head -1   # refused: the classification still exists
psqlq m11a_down 'ALTER TABLE tax_classifications DISABLE TRIGGER tax_classifications_rules; DELETE FROM tax_classifications; ALTER TABLE tax_classifications ENABLE TRIGGER tax_classifications_rules;' >/dev/null
psqlq m11a_down "$RB" >/dev/null
$H/dump.sh m11a_down > /tmp/g2; [ "$L" = "t" ] && [ "$(data m11a_down)" = "$D7" ] && cmp -s /tmp/g1 /tmp/g2 && echo "PASS lock alone does not block; reversal restores the exact prior schema and data" || echo "FAIL lock-only reversal"
