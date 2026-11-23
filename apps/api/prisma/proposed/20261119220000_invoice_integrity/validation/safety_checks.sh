#!/bin/bash
# M-11b safety checks: existing rows preserved, preconditions, rollback restores the schema exactly.
cd /tmp
P() { sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "$@"; }
M="$(cat /home/claude/m11b/migration.sql)"; R="$(cat /home/claude/m11b/rollback.sql)"
pass() { echo "PASS $1"; }; fail() { echo "FAIL $1"; }
/home/claude/m11b/validation/rebuild.sh m11b_pre >/dev/null || { fail "rebuild"; exit 1; }
sudo -u postgres pg_dump -s m11b_pre | grep -v -e '^--' -e '^\\restrict' -e '^\\unrestrict' > /tmp/s0.sql
sudo -u postgres pg_dump -a --exclude-table=invoices --exclude-table=invoice_items m11b_pre | grep -v -e '^--' -e '^\\restrict' -e '^\\unrestrict' > /tmp/d0.sql
echo "existing rows before: $(wc -l < /tmp/d0.sql) dump lines, $(P m11b_pre -Atc "SELECT sum(n_live_tup) FROM pg_stat_user_tables") live rows"

# 1. Preconditions: a database with an invoice row is left untouched.
sudo -u postgres dropdb --if-exists m11b_pc; sudo -u postgres createdb -T m11b_pre m11b_pc
P m11b_pc -c "SET session_replication_role = replica; INSERT INTO invoices (id,\"hospitalId\",\"appointmentId\",\"invoiceNumber\",\"updatedAt\") VALUES (gen_random_uuid(),'aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000a001','X',now())"
OUT=$(P m11b_pc -c "$M" 2>&1); S=$(sudo -u postgres pg_dump -s m11b_pc | grep -v -e '^--' -e '^\\restrict' -e '^\\unrestrict')
[[ "$OUT" == *"M-11b stopped: invoices"* ]] && [ "$S" = "$(cat /tmp/s0.sql)" ] && pass "migration stops on existing billing rows and changes nothing" || fail "precondition ($OUT)"
sudo -u postgres dropdb m11b_pc

# 2. Apply as one multi-statement query; existing rows identical.
P m11b_pre -c "$M" && pass "migration applies as one multi-statement query" || fail "apply"
sudo -u postgres pg_dump -a --exclude-table=invoices --exclude-table=invoice_items --exclude-table=document_number_series \
  --exclude-table=invoice_events --exclude-table=invoice_correction_requests --exclude-table=invoice_correction_request_notes m11b_pre | grep -v -e '^--' -e '^\\restrict' -e '^\\unrestrict' > /tmp/d1.sql
cmp -s /tmp/d0.sql /tmp/d1.sql && pass "every existing row identical after the migration (data dump, $(md5sum < /tmp/d1.sql | cut -c1-12))" || fail "existing rows changed"
echo "object counts: $(P m11b_pre -Atc "SELECT (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename<>'_prisma_migrations')||' tables, '||(SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal)||' triggers, '||(SELECT count(*) FROM pg_constraint WHERE contype='x')||' exclusions'")"

# 3. Rollback refused while billing rows exist; works on an unused database and restores the schema.
sudo -u postgres dropdb --if-exists m11b_rb; sudo -u postgres createdb -T m11b_pre m11b_rb
P m11b_rb -c "INSERT INTO document_number_series (\"hospitalId\",\"numberingScope\",\"documentType\",\"financialYear\",prefix,\"openedById\") VALUES ('aaaaaaaa-0000-0000-0000-000000000001','HOSPITAL:aaaaaaaa-0000-0000-0000-000000000001','BILL_OF_SUPPLY','26-27','BOS','aaaaaaaa-0000-0000-0000-0000000000a1')"
OUT=$(P m11b_rb -c "$R" 2>&1); [[ "$OUT" == *"Rollback of M-11b refused"* ]] && pass "rollback refused while billing rows exist" || fail "rollback guard ($OUT)"
sudo -u postgres dropdb m11b_rb
P m11b_pre -c "$R" && pass "rollback applies" || fail "rollback"
sudo -u postgres pg_dump -s m11b_pre | grep -v -e '^--' -e '^\\restrict' -e '^\\unrestrict' > /tmp/s2.sql
diff /tmp/s0.sql /tmp/s2.sql > /tmp/s_diff.txt && pass "schema after rollback identical to before M-11b (pg_dump -s)" || { fail "schema differs after rollback"; head -40 /tmp/s_diff.txt; }
sudo -u postgres pg_dump -a --exclude-table=invoices --exclude-table=invoice_items m11b_pre | grep -v -e '^--' -e '^\\restrict' -e '^\\unrestrict' > /tmp/d2.sql
cmp -s /tmp/d0.sql /tmp/d2.sql && pass "existing rows identical after rollback" || fail "rows changed by rollback"
P m11b_pre -c "$M" && pass "migration applies again after rollback" || fail "re-apply"
sudo -u postgres dropdb m11b_pre
