#!/bin/bash
# M-11a revision 2: the commit-time check under a real COMMIT, on a throwaway database whose
# medcore_tax_clock() is permanently replaced by the simulated clock (never done outside this test).
H=/home/claude/m11a; DB=m11a_commit
A=aaaaaaaa-0000-0000-0000-000000000001; UA=aaaaaaaa-0000-0000-0000-0000000000a1
q() { (cd /tmp; sudo -u postgres psql -X -q -d $DB "$@" 2>&1); }
$H/rebuild.sh $DB && (cd /tmp; sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d $DB -c "$(cat $H/migration.sql)")
q -c "CREATE OR REPLACE FUNCTION medcore_tax_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS \$\$ SELECT current_setting('medcore_test.clock')::timestamptz \$\$" >/dev/null
SETUP="SET medcore_test.clock = '2026-11-18 12:00+05:30';
INSERT INTO tax_classifications (id,\"hospitalId\",name,\"supplyType\",\"hsnSac\",\"createdById\",\"updatedAt\") VALUES ('11111111-0000-0000-0000-000000000002','$A','Medicaments','GOODS','3004','$UA',now());
INSERT INTO tax_classification_versions (id,\"hospitalId\",\"classificationId\",treatment,\"ratePercent\",\"priceIncludesTax\",\"effectiveFrom\",\"createdById\") VALUES ('33333333-0000-0000-0000-000000000001','$A','11111111-0000-0000-0000-000000000002','TAXABLE',12,true,'2026-11-19','$UA');"
q -c "$SETUP" >/dev/null
rate() { q -Atc "SELECT \"ratePercent\" FROM tax_classification_versions"; }
echo "== Edit at 23:45, COMMIT at 00:01 the next day"
q -c "BEGIN; SET LOCAL medcore_test.clock = '2026-11-18 23:45+05:30'; UPDATE tax_classification_versions SET \"ratePercent\" = 5; SELECT 'statement accepted at 23:45'; SET LOCAL medcore_test.clock = '2026-11-19 00:01+05:30'; COMMIT;" | grep -E "accepted|ERROR"
r=$(rate); [ "$r" = "12.00" ] && echo "PASS refused at COMMIT; rate still $r" || echo "FAIL rate is $r"
echo "== Edit at 23:45, COMMIT at 23:46"
q -c "BEGIN; SET LOCAL medcore_test.clock = '2026-11-18 23:45+05:30'; UPDATE tax_classification_versions SET \"ratePercent\" = 5; SET LOCAL medcore_test.clock = '2026-11-18 23:46+05:30'; COMMIT;" | grep -E "ERROR" || true
r=$(rate); [ "$r" = "5.00" ] && echo "PASS committed; rate now $r" || echo "FAIL rate is $r"
echo "== Insert a first registration effective 18 Nov at 23:40, COMMIT at 00:01"
q -c "BEGIN; SET LOCAL medcore_test.clock = '2026-11-18 23:40+05:30'; INSERT INTO hospital_gst_registrations (id,\"hospitalId\",\"registrationType\",\"effectiveFrom\",\"attestedById\") VALUES ('44444444-0000-0000-0000-000000000001','$A','UNREGISTERED','2026-11-18','$UA'); SET LOCAL medcore_test.clock = '2026-11-19 00:01+05:30'; COMMIT;" | grep -E "ERROR"
n=$(q -Atc "SELECT count(*) FROM hospital_gst_registrations"); [ "$n" = "0" ] && echo "PASS refused at COMMIT; no registration stored" || echo "FAIL $n stored"
