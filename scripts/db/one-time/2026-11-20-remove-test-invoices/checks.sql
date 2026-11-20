-- Preconditions for removing the 15 invoices left by the old T-MIG-006 test (DEC-066 follow-up).
-- Read-only. Raises an exception, which stops psql and rolls the transaction back, if any check fails.
-- Included by run.sh in both the read-only backup step and the deletion transaction.
DO $checks$
DECLARE
  expected CONSTANT int := 15;
  total int;
  matching int;
  hospitals_n int;
  refs bigint;
  fk record;
BEGIN
  SELECT count(*) INTO total FROM invoices;
  IF total <> expected THEN
    RAISE EXCEPTION 'ABORT: invoices holds % rows, expected exactly %', total, expected;
  END IF;

  -- The old test's exact fingerprint: a throwaway hospital "int-<run>-<n>" / "INT<RUN>-<n>",
  -- invoice "INV-<run>-<n>" from the same test run, DRAFT, 100 + 18 - 10 = 108, never finalised.
  SELECT count(*), count(DISTINCT i."hospitalId") INTO matching, hospitals_n
  FROM invoices i JOIN hospitals h ON h.id = i."hospitalId"
  WHERE h.name ~ '^int-[0-9a-f]{6}-[0-9]+$'
    AND h.code ~ '^INT[0-9A-F]{6}-[0-9]+$'
    AND i."invoiceNumber" ~ '^INV-[0-9a-f]{6}-[0-9]+$'
    AND substr(i."invoiceNumber", 5, 6) = substr(h.name, 5, 6)
    AND i.status = 'DRAFT'
    AND i.subtotal = 100 AND i."taxAmount" = 18 AND i."discountAmount" = 10 AND i.total = 108
    AND i."finalisedAt" IS NULL AND i."finalisedById" IS NULL AND i."receiptFileId" IS NULL;
  IF matching <> expected THEN
    RAISE EXCEPTION 'ABORT: only % of % invoices match the test pattern', matching, total;
  END IF;
  IF hospitals_n <> expected THEN
    RAISE EXCEPTION 'ABORT: the invoices belong to % hospitals, expected one each (%)', hospitals_n, expected;
  END IF;

  -- The three known referencing tables must be empty (M-11b requires this too).
  IF EXISTS (SELECT 1 FROM invoice_items) THEN RAISE EXCEPTION 'ABORT: invoice_items is not empty'; END IF;
  IF EXISTS (SELECT 1 FROM payments) THEN RAISE EXCEPTION 'ABORT: payments is not empty'; END IF;
  IF EXISTS (SELECT 1 FROM insurance_claims) THEN RAISE EXCEPTION 'ABORT: insurance_claims is not empty'; END IF;

  -- Every foreign key in the live database that points at invoices, whatever its table: no row may
  -- reference any invoice. Uses the column that maps to invoices.id in each key.
  FOR fk IN
    SELECT c.conrelid::regclass AS tbl, c.conname, a.attname AS col
    FROM pg_constraint c
    JOIN LATERAL unnest(c.conkey, c.confkey) AS k(src, dst) ON true
    JOIN pg_attribute ra ON ra.attrelid = c.confrelid AND ra.attnum = k.dst AND ra.attname = 'id'
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.src
    WHERE c.contype = 'f' AND c.confrelid = 'invoices'::regclass
  LOOP
    EXECUTE format('SELECT count(*) FROM %s WHERE %I IN (SELECT id FROM invoices)', fk.tbl, fk.col) INTO refs;
    IF refs <> 0 THEN
      RAISE EXCEPTION 'ABORT: % rows in % reference invoices (%)', refs, fk.tbl, fk.conname;
    END IF;
  END LOOP;

  -- Audit entries naming these invoices (plain text, no foreign key).
  SELECT count(*) INTO refs FROM audit_logs a WHERE a."entityId" IN (SELECT id::text FROM invoices);
  IF refs <> 0 THEN RAISE EXCEPTION 'ABORT: % audit entries reference these invoices', refs; END IF;

  RAISE NOTICE 'Checks passed: % invoices, all match the test pattern, % hospitals, no references', total, hospitals_n;
END
$checks$;
