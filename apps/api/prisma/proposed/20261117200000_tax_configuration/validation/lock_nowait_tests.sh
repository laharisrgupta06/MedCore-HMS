#!/bin/bash
# Rehearses T-MIG-TAX-011 in SQL: run against a database built from the given migration file.
# Expected with revision 3: both writer locks present (NOWAIT refused) and the FK insert not blocked.
H=/home/claude/m11a; MIG=${1:-$H/migration.sql}; DB=m11a_nw
A=aaaaaaaa-0000-0000-0000-000000000001; UA=aaaaaaaa-0000-0000-0000-0000000000a1
C=11111111-0000-0000-0000-000000000002; V=33333333-0000-0000-0000-000000000001
q() { (cd /tmp; sudo -u postgres psql -X -q -d $DB "$@" 2>&1); }
$H/rebuild.sh $DB && (cd /tmp; sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d $DB -c "$(cat $MIG)")
q -c "INSERT INTO tax_classifications (id,\"hospitalId\",name,\"supplyType\",\"hsnSac\",\"createdById\",\"updatedAt\") VALUES ('$C','$A','Medicaments','GOODS','3004','$UA',now());
      INSERT INTO tax_classification_versions (id,\"hospitalId\",\"classificationId\",treatment,\"ratePercent\",\"priceIncludesTax\",\"effectiveFrom\",\"createdById\") VALUES ('$V','$A','$C','TAXABLE',12,true,current_date + 30,'$UA');" >/dev/null
hold() { ( (echo "BEGIN; $1"; sleep 3; echo "ROLLBACK;") | (cd /tmp; sudo -u postgres psql -X -q -d $DB) >/dev/null 2>&1 ) & sleep 1; }
hold "UPDATE tax_classification_versions SET \"ratePercent\" = 5 WHERE id='$V';"
echo "version writer open -> FOR SHARE NOWAIT on classification: $(q -Atc "SELECT 1 FROM tax_classifications WHERE id='$C' FOR SHARE NOWAIT" | head -1)"
echo "                    -> FOR SHARE NOWAIT on hospital: $(q -Atc "SELECT 1 FROM hospitals WHERE id='$A' FOR SHARE NOWAIT" | head -1)"
echo "                    -> plain read of the rate: $(q -Atc "SELECT \"ratePercent\" FROM tax_classification_versions WHERE id='$V'")"
wait
hold "INSERT INTO hospital_gst_registrations (id,\"hospitalId\",\"registrationType\",\"effectiveFrom\",\"attestedById\") VALUES (gen_random_uuid(),'$A','UNREGISTERED',current_date + 30,'$UA');"
echo "registration writer open -> FOR SHARE NOWAIT on hospital: $(q -Atc "SELECT 1 FROM hospitals WHERE id='$A' FOR SHARE NOWAIT" | head -1)"
echo "                         -> department insert (FK check): $(q -c "INSERT INTO departments (id,\"hospitalId\",name,\"updatedAt\") VALUES (gen_random_uuid(),'$A','Cardiology',now())" -c "SET lock_timeout='1s'" ; echo done)"
wait
