-- M-12 DRAFT (design option A approved; NOT APPLIED; NOT VALIDATED against a database).
-- Order: M-11a, M-11b, then this. Prisma runs the file as written; keep the enum change outside any
-- statement that uses the new value (PostgreSQL rejects using an enum value added in the same transaction).

-- 1. Reversal support (8-B5)
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REVERSED';

ALTER TABLE payments
  ADD COLUMN "reversedAt" TIMESTAMPTZ(3),
  ADD COLUMN "reversedById" UUID,
  ADD COLUMN "reversalReason" TEXT;
ALTER TABLE payments ADD CONSTRAINT "payments_reversedById_hospitalId_fkey"
  FOREIGN KEY ("reversedById", "hospitalId") REFERENCES users(id, "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;
-- A reversed payment always carries who, when and why; any other payment carries none of them.
-- status is compared as text: the new REVERSED value cannot be used as an enum literal in this file.
ALTER TABLE payments ADD CONSTRAINT payments_reversal_complete CHECK (
  (status::text <> 'REVERSED' AND "reversedAt" IS NULL AND "reversedById" IS NULL AND "reversalReason" IS NULL)
  OR (status::text = 'REVERSED' AND "reversedAt" IS NOT NULL AND "reversedById" IS NOT NULL AND length("reversalReason") >= 5));
-- (A positive amount is already enforced by M-11b's payments_amount_chk.)

-- 2. The M-11b invoice guard, with the issued-status rule relaxed for payment transactions only.
--    Copied from 20261119220000_invoice_integrity; every other rule is unchanged.
CREATE OR REPLACE FUNCTION medcore_invoice_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  orig record;
  agg record;
  reg record;
  s record;
  issue date;
  rtype "GstRegistrationType";
  dt "DocumentType";
  scope text;
  fy text;
  pfx text;
  now_ts timestamptz := medcore_tax_clock();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Invoices are never deleted; void a draft instead' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  PERFORM medcore_billing_require_read_committed();

  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'DRAFT' OR NEW.subtotal <> 0 OR NEW."taxAmount" <> 0 OR NEW."discountAmount" <> 0 OR NEW.total <> 0
       OR NEW."discountSetById" IS NOT NULL OR NEW."receiptFileId" IS NOT NULL THEN
      RAISE EXCEPTION 'An invoice starts as an empty draft' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM appointments WHERE id = NEW."appointmentId" AND "patientId" = NEW."patientId") THEN
      RAISE EXCEPTION 'The invoice''s patient must be the patient of its visit' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NEW.kind = 'LATE_CHARGES' THEN
      SELECT * INTO orig FROM invoices WHERE id = NEW."relatedInvoiceId";
      IF orig.kind IS DISTINCT FROM 'ORIGINAL' OR orig."appointmentId" IS DISTINCT FROM NEW."appointmentId"
         OR orig.status NOT IN ('FINALISED', 'PARTIALLY_PAID', 'PAID') THEN
        RAISE EXCEPTION 'A late-charge invoice follows the issued original invoice of the same visit'
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;
    END IF;
    -- Visit sequence, set here (any value supplied is replaced); concurrent creation for one visit is
    -- refused by the unique (appointment, sequence) index and retried by the API.
    SELECT COALESCE(max("sequence"), 0) + 1 INTO NEW."sequence" FROM invoices WHERE "appointmentId" = NEW."appointmentId";
    RETURN NEW;
  END IF;

  -- UPDATE ---------------------------------------------------------------------------------------
  IF (NEW.id, NEW."hospitalId", NEW."appointmentId", NEW."patientId", NEW.kind, NEW."sequence", NEW."relatedInvoiceId",
      NEW."createdById", NEW."createdAt")
     IS DISTINCT FROM (OLD.id, OLD."hospitalId", OLD."appointmentId", OLD."patientId", OLD.kind, OLD."sequence",
      OLD."relatedInvoiceId", OLD."createdById", OLD."createdAt") THEN
    RAISE EXCEPTION 'An invoice keeps its visit, patient, kind and creator' USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.status = 'VOID' THEN
    RAISE EXCEPTION 'A void invoice cannot change' USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF OLD.status <> 'DRAFT' THEN
    IF NEW.status = 'VOID' THEN
      RAISE EXCEPTION 'This document has been issued and cannot be cancelled in MedCore; record a correction request for the accountant'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    -- M-12: an issued document's status moves only between FINALISED, PARTIALLY_PAID and PAID, only
    -- inside a payment transaction (flag set by PaymentsService.syncInvoiceStatus), and the deferred
    -- payments_invoice_consistency trigger proves at commit that it matches the received payments.
    IF NEW.status <> OLD.status THEN
      IF current_setting('medcore.payment_change', true) IS DISTINCT FROM 'on'
         OR NEW.status NOT IN ('FINALISED', 'PARTIALLY_PAID', 'PAID') THEN
        RAISE EXCEPTION 'Payment statuses of an issued document are set by the payment rules (M-12)'
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;
    END IF;
    IF (to_jsonb(NEW) - 'updatedAt' - 'receiptFileId' - 'status') IS DISTINCT FROM (to_jsonb(OLD) - 'updatedAt' - 'receiptFileId' - 'status')
       OR (OLD."receiptFileId" IS NOT NULL AND NEW."receiptFileId" IS DISTINCT FROM OLD."receiptFileId") THEN
      RAISE EXCEPTION 'This document has been issued and cannot be changed in MedCore; record a correction request for the accountant'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- From DRAFT ------------------------------------------------------------------------------------
  IF NEW.status IN ('PARTIALLY_PAID', 'PAID') THEN
    RAISE EXCEPTION 'A draft cannot be paid; finalise it first' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."receiptFileId" IS NOT NULL THEN
    RAISE EXCEPTION 'A draft has no receipt' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW."invoiceNumber", NEW."seriesId", NEW.serial, NEW."documentType", NEW."issueDate", NEW."financialYear",
      NEW."numberingScope", NEW."gstRegistrationId", NEW."registrationType", NEW."sellerGstin", NEW."sellerLegalName",
      NEW."sellerStateCode") IS DISTINCT FROM (NULL::text, NULL::uuid, NULL::integer, NULL::"DocumentType", NULL::date,
      NULL::text, NULL::text, NULL::uuid, NULL::"GstRegistrationType", NULL::text, NULL::text, NULL::text) THEN
    RAISE EXCEPTION 'Document numbers, dates and seller details are set by the database when an invoice is finalised'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  -- Discount (Q2 B): accountants only; the setter and time are recorded.
  IF (NEW."discountAmount", NEW."discountReason") IS DISTINCT FROM (OLD."discountAmount", OLD."discountReason") THEN
    IF NOT medcore_user_role_in(NEW."hospitalId", NEW."discountSetById", ARRAY['ACCOUNTANT']) THEN
      RAISE EXCEPTION 'Only an accountant can set or remove a discount' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    NEW."discountSetAt" := now_ts;
  ELSIF (NEW."discountSetById", NEW."discountSetAt") IS DISTINCT FROM (OLD."discountSetById", OLD."discountSetAt") THEN
    RAISE EXCEPTION 'The discount setter changes only with the discount' USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.status = 'VOID' THEN
    IF NOT medcore_user_role_in(NEW."hospitalId", NEW."voidedById", ARRAY['RECEPTIONIST', 'ACCOUNTANT']) THEN
      RAISE EXCEPTION 'Only a receptionist or accountant can void a draft' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    NEW."voidedAt" := now_ts;
    RETURN NEW;
  END IF;
  IF (NEW."voidedAt", NEW."voidedById", NEW."voidReason") IS DISTINCT FROM (NULL::timestamptz, NULL::uuid, NULL::text) THEN
    RAISE EXCEPTION 'Void details are recorded only when a draft is voided' USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.status = 'DRAFT' THEN
    IF (NEW."finalisedAt", NEW."finalisedById") IS DISTINCT FROM (NULL::timestamptz, NULL::uuid) THEN
      RAISE EXCEPTION 'A draft is finalised only together with its status' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;

  -- DRAFT -> FINALISED: checks, document type, seller snapshot and the number (Q18 A, DEC-052) ------
  -- Lock order: the invoice row is already locked by this UPDATE; the hospital row (FOR SHARE) waits
  -- for any open registration writer, then the series row (FOR UPDATE) serialises numbering.
  PERFORM 1 FROM hospitals WHERE id = NEW."hospitalId" FOR SHARE;
  IF NOT medcore_user_role_in(NEW."hospitalId", NEW."finalisedById", ARRAY['RECEPTIONIST', 'ACCOUNTANT']) THEN
    RAISE EXCEPTION 'Only a receptionist or accountant can finalise an invoice' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (SELECT "taxSetupConfirmedAt" FROM hospitals WHERE id = NEW."hospitalId") IS NULL THEN
    RAISE EXCEPTION 'The hospital admin must confirm the tax set-up before the first invoice is finalised'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT count(*) AS n, count(*) FILTER (WHERE unclassified) AS unclassified, max("serviceDate") AS last_service,
         COALESCE(sum("taxableValue"), 0) AS subtotal, COALESCE(sum("taxAmount"), 0) AS tax,
         COALESCE(sum("discountShare"), 0) AS discount,
         bool_or("gstCollected" AND treatment = 'TAXABLE') AS any_taxed,
         bool_or(NOT ("gstCollected" AND treatment = 'TAXABLE')) AS any_untaxed
    INTO agg FROM invoice_items WHERE "invoiceId" = NEW.id;
  IF agg.n = 0 THEN
    RAISE EXCEPTION 'An invoice needs at least one line before it is finalised' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF agg.unclassified > 0 THEN
    RAISE EXCEPTION 'Lines without a tax classification must be classified and re-resolved before finalising'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW.subtotal, NEW."taxAmount", NEW."discountAmount") IS DISTINCT FROM (agg.subtotal, agg.tax, agg.discount) THEN
    RAISE EXCEPTION 'Invoice totals must equal the sum of its lines' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.total <= 0 THEN
    RAISE EXCEPTION 'An invoice with nothing to pay cannot be finalised' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  issue := medcore_local_date(NEW."hospitalId");
  IF agg.last_service > issue THEN
    RAISE EXCEPTION 'A line is dated after the issue date %; finalise it tomorrow', issue USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  SELECT * INTO reg FROM hospital_gst_registrations
   WHERE "hospitalId" = NEW."hospitalId" AND "effectiveFrom" <= issue ORDER BY "effectiveFrom" DESC LIMIT 1;
  rtype := COALESCE(reg."registrationType", 'UNREGISTERED');
  IF rtype <> 'REGULAR' AND agg.tax > 0 THEN
    RAISE EXCEPTION 'GST was charged on lines dated under an earlier regular registration, but the hospital is no longer a regular taxpayer; the accountant must decide how to bill these charges'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  -- DEC-047 document type: regular with only taxed lines, a tax invoice; regular with taxed and
  -- untaxed lines, an invoice-cum-bill of supply (Rule 46A); otherwise a bill of supply.
  dt := CASE WHEN rtype = 'REGULAR' AND agg.any_taxed AND NOT agg.any_untaxed THEN 'TAX_INVOICE'
             WHEN rtype = 'REGULAR' AND agg.any_taxed THEN 'INVOICE_CUM_BILL_OF_SUPPLY'
             ELSE 'BILL_OF_SUPPLY' END;
  scope := CASE WHEN rtype IN ('REGULAR', 'COMPOSITION') THEN reg.gstin ELSE 'HOSPITAL:' || NEW."hospitalId"::text END;
  fy := medcore_financial_year(issue);

  SELECT * INTO s FROM "document_number_series"
   WHERE "hospitalId" = NEW."hospitalId" AND "gstRegistrationId" IS NOT DISTINCT FROM reg.id
     AND "financialYear" = fy AND "documentType" = dt AND "closedAt" IS NULL
   FOR UPDATE;
  IF NOT FOUND THEN
    pfx := medcore_document_prefix(NEW."hospitalId", scope, fy, dt);
    INSERT INTO "document_number_series" ("hospitalId", "gstRegistrationId", "numberingScope", "documentType",
                                          "financialYear", prefix, "openedById")
    VALUES (NEW."hospitalId", reg.id, scope, dt, fy, pfx, NEW."finalisedById")
    ON CONFLICT DO NOTHING;
    SELECT * INTO s FROM "document_number_series"
     WHERE "hospitalId" = NEW."hospitalId" AND "gstRegistrationId" IS NOT DISTINCT FROM reg.id
       AND "financialYear" = fy AND "documentType" = dt AND "closedAt" IS NULL
     FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Another series was opened at the same moment; please finalise again'
        USING ERRCODE = 'serialization_failure';
    END IF;
  END IF;
  IF s."nextSerial" > 99999 THEN
    RAISE EXCEPTION 'SERIES_EXHAUSTED: series % for % has issued all 99,999 numbers; the hospital admin must open a series with a new prefix', s.prefix, fy
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  UPDATE "document_number_series" SET "nextSerial" = "nextSerial" + 1 WHERE id = s.id;

  NEW."seriesId" := s.id;
  NEW.serial := s."nextSerial";
  NEW."invoiceNumber" := s.prefix || '/' || fy || '/' || lpad(s."nextSerial"::text, 5, '0');
  NEW."documentType" := dt;
  NEW."issueDate" := issue;
  NEW."financialYear" := fy;
  NEW."numberingScope" := scope;
  NEW."finalisedAt" := now_ts;
  NEW."gstRegistrationId" := reg.id;
  NEW."registrationType" := rtype;
  IF rtype IN ('REGULAR', 'COMPOSITION') THEN
    NEW."sellerGstin" := reg.gstin;
    NEW."sellerLegalName" := reg."legalName";
    NEW."sellerStateCode" := reg."stateCode";
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Payment row rules: fixed amount, method and invoice; allowed status moves; no reversal of a
--    reconciled payment; status text compared as text so this compiles before REVERSED is committed.
CREATE OR REPLACE FUNCTION medcore_payment_transition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payments are never deleted' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status::text NOT IN ('PENDING', 'SUCCEEDED') THEN
      RAISE EXCEPTION 'A payment starts as an open checkout or a received payment' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.amount IS DISTINCT FROM OLD.amount OR NEW."invoiceId" IS DISTINCT FROM OLD."invoiceId"
     OR NEW.method IS DISTINCT FROM OLD.method OR NEW."hospitalId" IS DISTINCT FROM OLD."hospitalId" THEN
    RAISE EXCEPTION 'A payment amount, method or invoice cannot be changed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND NOT (
       (OLD.status::text = 'PENDING' AND NEW.status::text IN ('SUCCEEDED', 'FAILED'))
    OR (OLD.status::text = 'SUCCEEDED' AND NEW.status::text = 'REVERSED')) THEN
    RAISE EXCEPTION 'Invalid payment status change' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status::text = 'REVERSED' AND OLD.status::text = 'SUCCEEDED' AND OLD."reconciledAt" IS NOT NULL THEN
    RAISE EXCEPTION 'A reconciled payment cannot be reversed' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."reconciledAt" IS NOT NULL AND NEW."reconciledAt" IS DISTINCT FROM OLD."reconciledAt" THEN
    RAISE EXCEPTION 'A reconciliation cannot be undone' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."reconciledAt" IS NOT NULL AND NEW.status::text <> 'SUCCEEDED' THEN
    RAISE EXCEPTION 'Only a received payment can be reconciled' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- 4. Commit-time proof that received payments never exceed the total and the status matches them.
CREATE OR REPLACE FUNCTION medcore_payment_consistency() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  inv_total numeric; inv_status text; paid numeric; implied text;
BEGIN
  SELECT total, status::text INTO inv_total, inv_status FROM invoices WHERE id = NEW."invoiceId";
  SELECT COALESCE(SUM(amount), 0) INTO paid FROM payments
    WHERE "invoiceId" = NEW."invoiceId" AND status::text = 'SUCCEEDED';
  IF paid > inv_total THEN
    RAISE EXCEPTION 'Received payments exceed the invoice total' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF paid > 0 AND inv_status NOT IN ('FINALISED', 'PARTIALLY_PAID', 'PAID') THEN
    RAISE EXCEPTION 'Payments are received only on an issued invoice' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF inv_status IN ('FINALISED', 'PARTIALLY_PAID', 'PAID') THEN
    implied := CASE WHEN paid >= inv_total THEN 'PAID' WHEN paid > 0 THEN 'PARTIALLY_PAID' ELSE 'FINALISED' END;
    IF inv_status <> implied THEN
      RAISE EXCEPTION 'Invoice status % does not match its payments (expected %)', inv_status, implied
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- The API's gate looks for this trigger name in pg_trigger (PaymentsService.assertRules).
CREATE TRIGGER payments_invoice_status BEFORE INSERT OR UPDATE OR DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION medcore_payment_transition();
CREATE CONSTRAINT TRIGGER payments_invoice_consistency AFTER INSERT OR UPDATE ON payments
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION medcore_payment_consistency();
