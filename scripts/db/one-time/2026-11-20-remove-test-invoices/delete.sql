-- Deletion transaction. run.sh sends: this header, checks.sql, then the body below.
-- psql variables: fingerprint (from the backup step), execute (true commits, false rolls back).
-- ON_ERROR_STOP: any failed statement or check stops psql, and the open transaction is rolled back.
--@@HEADER
\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout = '5s';
-- Blocks writes to these tables until the end of the transaction; reads continue.
LOCK TABLE invoices, invoice_items, payments, insurance_claims IN SHARE ROW EXCLUSIVE MODE;
SELECT set_config('cleanup.fingerprint', :'fingerprint', true) \g /dev/null
--@@BODY
DO $del$
DECLARE
  n int;
  now_fp text;
BEGIN
  SELECT md5(string_agg(i::text, E'\n' ORDER BY i.id)) INTO now_fp FROM invoices i;
  IF now_fp IS DISTINCT FROM current_setting('cleanup.fingerprint') THEN
    RAISE EXCEPTION 'ABORT: invoices changed since the backup was taken (fingerprint differs)';
  END IF;

  DELETE FROM invoices i
  USING hospitals h
  WHERE h.id = i."hospitalId"
    AND h.name ~ '^int-[0-9a-f]{6}-[0-9]+$'
    AND h.code ~ '^INT[0-9A-F]{6}-[0-9]+$'
    AND i."invoiceNumber" ~ '^INV-[0-9a-f]{6}-[0-9]+$'
    AND substr(i."invoiceNumber", 5, 6) = substr(h.name, 5, 6)
    AND i.status = 'DRAFT'
    AND i.subtotal = 100 AND i."taxAmount" = 18 AND i."discountAmount" = 10 AND i.total = 108
    AND i."finalisedAt" IS NULL AND i."finalisedById" IS NULL AND i."receiptFileId" IS NULL;
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 15 THEN RAISE EXCEPTION 'ABORT: deleted % rows, expected 15', n; END IF;

  SELECT count(*) INTO n FROM invoices;
  IF n <> 0 THEN RAISE EXCEPTION 'ABORT: % invoices remain after deletion', n; END IF;
  RAISE NOTICE 'Deleted 15 invoices; invoices now holds 0 rows';
END
$del$;
\if :execute
COMMIT;
\echo 'COMMITTED: the 15 test invoices were deleted.'
\else
ROLLBACK;
\echo 'DRY RUN: every check passed and the deletion was rolled back. Nothing changed.'
\endif
