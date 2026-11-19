-- M-11b invoice_integrity (Phase 8, task 8-A2). PROPOSAL: not part of prisma/migrations until approved.
--
-- Implements, in the database, the approved billing rules for invoices and their lines:
--   DEC-051  every line snapshots its tax data; the snapshot and the line arithmetic are checked;
--            invoice totals equal the sum of the lines and discount shares equal the discount
--   DEC-052  document numbers allocated at finalising, gap-free, per series (GSTIN or hospital,
--            financial year, document type, prefix); unique per scope, year and hospital
--   DEC-053  issued documents never change; VOID only from DRAFT; append-only correction requests
--            and outcome notes; no deletes of invoices, issued lines, series, requests or notes
--   DEC-058  a line takes FOR SHARE on the hospital row, then on the classification row, before it
--            resolves the version and registration in force, so it always matches committed tax data
--   Q19 A    late-charge invoices; Q2 B accountant-only discounts; Q4 A, Q6 A prices from the source
--
-- Additive: no existing row is changed. invoices and invoice_items have never been written by any
-- code (Phase 8 is the first billing phase); the migration stops with a message if either table, or
-- payments or insurance_claims, holds a row, so nothing is ever guessed or backfilled.

-- 0. Preconditions --------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM invoices) OR EXISTS (SELECT 1 FROM invoice_items)
     OR EXISTS (SELECT 1 FROM payments) OR EXISTS (SELECT 1 FROM insurance_claims) THEN
    RAISE EXCEPTION 'M-11b stopped: invoices, invoice_items, payments or insurance_claims already hold rows. Nothing was changed; review before applying.';
  END IF;
  IF to_regclass('public.tax_classifications') IS NULL THEN
    RAISE EXCEPTION 'M-11b stopped: M-11a (tax_configuration) is not applied.';
  END IF;
END
$$;

-- 1. Types ---------------------------------------------------------------------------------------
CREATE TYPE "InvoiceKind" AS ENUM ('ORIGINAL', 'LATE_CHARGES');
CREATE TYPE "DocumentType" AS ENUM ('TAX_INVOICE', 'INVOICE_CUM_BILL_OF_SUPPLY', 'BILL_OF_SUPPLY');
CREATE TYPE "TaxNotCollectedReason" AS ENUM ('UNREGISTERED', 'COMPOSITION');
CREATE TYPE "InvoiceEventKind" AS ENUM ('CREATED', 'DISCOUNT_CHANGED', 'FINALISED', 'VOIDED', 'CORRECTION_REQUESTED');
CREATE TYPE "CorrectionRequestKind" AS ENUM ('CANCEL_DOCUMENT', 'CHANGE_AMOUNTS', 'WRONG_PATIENT', 'WRONG_DETAILS');

-- 2. Helpers -------------------------------------------------------------------------------------
-- The billing triggers rely on READ COMMITTED: each statement then reads the latest committed rows
-- after waiting for a lock, which is what makes the DEC-058 protocol exact. Tax writers lock the
-- hospital row but do not write it, so under REPEATABLE READ or SERIALIZABLE a waiting line would
-- keep its older snapshot and could miss a registration that took effect today. Prisma and the API
-- use READ COMMITTED (PostgreSQL's default); any other level is refused with a clear message.
CREATE FUNCTION medcore_billing_require_read_committed() RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'Billing writes must run at READ COMMITTED isolation (this transaction uses %)', current_setting('transaction_isolation')
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END;
$$;

-- The hospital's actual local date now (no margin): the issue date of a document and the start of
-- its financial year. Effective dates of tax data keep using medcore_tax_date (ten minutes ahead).
CREATE FUNCTION medcore_local_date(h uuid) RETURNS date LANGUAGE sql VOLATILE AS $$
  SELECT (medcore_tax_clock() AT TIME ZONE timezone)::date FROM hospitals WHERE id = h
$$;

-- Financial year label of a date: 1 April to 31 March, for example 2026-11-19 -> '26-27'.
CREATE FUNCTION medcore_financial_year(d date) RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT to_char(y % 100, 'FM00') || '-' || to_char((y + 1) % 100, 'FM00')
    FROM (SELECT CASE WHEN extract(month FROM d) >= 4 THEN extract(year FROM d)::int
                      ELSE extract(year FROM d)::int - 1 END AS y) s
$$;

CREATE FUNCTION medcore_user_role_in(h uuid, u uuid, roles text[]) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM users WHERE id = u AND "hospitalId" = h AND role::text = ANY (roles))
$$;

-- 3. Invoices ------------------------------------------------------------------------------------
-- Replaced, not dropped silently: the initial CHECKs computed total = subtotal + tax - discount,
-- which DEC-051 replaces (subtotal is the sum of taxable values, already net of the discount).
ALTER TABLE invoices DROP CONSTRAINT invoices_total_chk;
ALTER TABLE invoices DROP CONSTRAINT invoices_discount_chk;
-- Late-charge invoices (Q19 A) share the appointment; drafts have no number (DEC-052).
DROP INDEX "invoices_appointmentId_key";
DROP INDEX "invoices_appointmentId_hospitalId_key";
DROP INDEX "invoices_hospitalId_invoiceNumber_key";
ALTER TABLE invoices ALTER COLUMN "invoiceNumber" DROP NOT NULL;

ALTER TABLE invoices
  ADD COLUMN "patientId" UUID NOT NULL,
  ADD COLUMN "kind" "InvoiceKind" NOT NULL DEFAULT 'ORIGINAL',
  ADD COLUMN "sequence" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "relatedInvoiceId" UUID,
  ADD COLUMN "createdById" UUID NOT NULL,
  ADD COLUMN "discountReason" TEXT,
  ADD COLUMN "discountSetById" UUID,
  ADD COLUMN "discountSetAt" TIMESTAMPTZ(3),
  ADD COLUMN "voidedAt" TIMESTAMPTZ(3),
  ADD COLUMN "voidedById" UUID,
  ADD COLUMN "voidReason" TEXT,
  ADD COLUMN "documentType" "DocumentType",
  ADD COLUMN "issueDate" DATE,
  ADD COLUMN "financialYear" VARCHAR(5),
  ADD COLUMN "numberingScope" TEXT,
  ADD COLUMN "seriesId" UUID,
  ADD COLUMN "serial" INTEGER,
  ADD COLUMN "gstRegistrationId" UUID,
  ADD COLUMN "registrationType" "GstRegistrationType",
  ADD COLUMN "sellerGstin" VARCHAR(15),
  ADD COLUMN "sellerLegalName" TEXT,
  ADD COLUMN "sellerStateCode" VARCHAR(2);

ALTER TABLE invoices
  ADD CONSTRAINT invoices_total_chk CHECK (total = subtotal + "taxAmount"),
  ADD CONSTRAINT invoices_sequence_chk CHECK ("sequence" >= 1), -- set by the database (medcore_invoice_rules)
  ADD CONSTRAINT invoices_late_charges_chk CHECK (("kind" = 'LATE_CHARGES') = ("relatedInvoiceId" IS NOT NULL)),
  ADD CONSTRAINT invoices_discount_chk CHECK (
    ("discountAmount" = 0) = ("discountReason" IS NULL)
    AND ("discountReason" IS NULL OR "discountSetById" IS NOT NULL)
    AND ("discountSetById" IS NULL) = ("discountSetAt" IS NULL)
    AND ("discountReason" IS NULL OR length(btrim("discountReason")) BETWEEN 3 AND 500)),
  ADD CONSTRAINT invoices_void_chk CHECK (
    ("status" = 'VOID') = ("voidedAt" IS NOT NULL)
    AND ("voidedAt" IS NULL) = ("voidedById" IS NULL)
    AND ("voidedById" IS NULL) = ("voidReason" IS NULL)
    AND ("voidReason" IS NULL OR length(btrim("voidReason")) BETWEEN 3 AND 500)),
  -- Drafts, and drafts that were voided, never carry a number; every issued document does.
  ADD CONSTRAINT invoices_issued_chk CHECK (
    ("status" IN ('DRAFT', 'VOID')) = ("invoiceNumber" IS NULL)
    AND ("invoiceNumber" IS NULL) = ("finalisedAt" IS NULL)
    AND ("finalisedAt" IS NULL) = ("finalisedById" IS NULL)
    AND ("finalisedAt" IS NULL) = ("documentType" IS NULL)
    AND ("finalisedAt" IS NULL) = ("issueDate" IS NULL)
    AND ("finalisedAt" IS NULL) = ("financialYear" IS NULL)
    AND ("finalisedAt" IS NULL) = ("numberingScope" IS NULL)
    AND ("finalisedAt" IS NULL) = ("seriesId" IS NULL)
    AND ("finalisedAt" IS NULL) = ("serial" IS NULL)
    AND ("finalisedAt" IS NULL) = ("registrationType" IS NULL)),
  -- Rule 46(b): at most 16 characters from A-Z 0-9 / -; MedCore's format PREFIX/YY-YY/NNNNN.
  ADD CONSTRAINT invoices_number_format_chk CHECK (
    "invoiceNumber" IS NULL OR ("invoiceNumber" ~ '^[A-Z0-9]{1,4}/[0-9]{2}-[0-9]{2}/[0-9]{5}$'
                                AND length("invoiceNumber") <= 16)),
  ADD CONSTRAINT invoices_serial_chk CHECK ("serial" IS NULL OR "serial" BETWEEN 1 AND 99999),
  -- The seller as issued: a registered seller (regular or composition) has GSTIN, name and state.
  ADD CONSTRAINT invoices_seller_chk CHECK (
    ("registrationType" IS NULL AND "gstRegistrationId" IS NULL AND "sellerGstin" IS NULL
       AND "sellerLegalName" IS NULL AND "sellerStateCode" IS NULL)
    OR ("registrationType" = 'UNREGISTERED' AND "sellerGstin" IS NULL AND "sellerLegalName" IS NULL
       AND "sellerStateCode" IS NULL)
    OR ("registrationType" IN ('REGULAR', 'COMPOSITION') AND "gstRegistrationId" IS NOT NULL
       AND "sellerGstin" IS NOT NULL AND "sellerLegalName" IS NOT NULL AND "sellerStateCode" IS NOT NULL));

-- Same-hospital references (composite keys, as everywhere else).
ALTER TABLE invoices
  ADD CONSTRAINT "invoices_patientId_hospitalId_fkey" FOREIGN KEY ("patientId", "hospitalId")
    REFERENCES patients (id, "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "invoices_relatedInvoiceId_hospitalId_fkey" FOREIGN KEY ("relatedInvoiceId", "hospitalId")
    REFERENCES invoices (id, "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "invoices_createdById_hospitalId_fkey" FOREIGN KEY ("createdById", "hospitalId")
    REFERENCES users (id, "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "invoices_discountSetById_hospitalId_fkey" FOREIGN KEY ("discountSetById", "hospitalId")
    REFERENCES users (id, "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "invoices_voidedById_hospitalId_fkey" FOREIGN KEY ("voidedById", "hospitalId")
    REFERENCES users (id, "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "invoices_gstRegistrationId_hospitalId_fkey" FOREIGN KEY ("gstRegistrationId", "hospitalId")
    REFERENCES hospital_gst_registrations (id, "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "invoices_appointmentId_sequence_key" ON invoices ("appointmentId", "sequence");
-- At most one open draft per visit (concurrent automatic lines find the same draft), and at most one
-- original that is not void (a voided original draft can be replaced; an issued one never).
CREATE UNIQUE INDEX "invoices_one_draft_per_appointment" ON invoices ("appointmentId") WHERE "status" = 'DRAFT';
CREATE UNIQUE INDEX "invoices_one_original_per_appointment" ON invoices ("appointmentId")
  WHERE "kind" = 'ORIGINAL' AND "status" <> 'VOID';
-- DEC-052 uniqueness: (series, serial); (scope, year, number), the legal rule; (hospital, year, number).
CREATE UNIQUE INDEX "invoices_seriesId_serial_key" ON invoices ("seriesId", "serial");
CREATE UNIQUE INDEX "invoices_numberingScope_financialYear_invoiceNumber_key"
  ON invoices ("numberingScope", "financialYear", "invoiceNumber");
CREATE UNIQUE INDEX "invoices_hospitalId_financialYear_invoiceNumber_key"
  ON invoices ("hospitalId", "financialYear", "invoiceNumber");
CREATE INDEX "invoices_hospitalId_patientId_createdAt_idx" ON invoices ("hospitalId", "patientId", "createdAt");
CREATE INDEX "invoices_appointmentId_idx" ON invoices ("appointmentId");
CREATE INDEX "invoices_relatedInvoiceId_idx" ON invoices ("relatedInvoiceId");

-- 4. Document number series (DEC-052) -------------------------------------------------------------
-- One open series per hospital, registration, financial year and document type; a prefix change or a
-- new registration closes it and opens another. The numbering scope is the GSTIN when the hospital is
-- registered, otherwise the hospital ('HOSPITAL:<id>'); prefixes never repeat within a scope and year,
-- so no two series can ever print the same number.
CREATE TABLE "document_number_series" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "hospitalId" UUID NOT NULL,
    "gstRegistrationId" UUID,
    "numberingScope" TEXT NOT NULL,
    "documentType" "DocumentType" NOT NULL,
    "financialYear" VARCHAR(5) NOT NULL,
    "prefix" VARCHAR(4) NOT NULL,
    "nextSerial" INTEGER NOT NULL DEFAULT 1,
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedById" UUID NOT NULL,
    "closedAt" TIMESTAMPTZ(3),
    "closedById" UUID,

    CONSTRAINT "document_number_series_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "document_number_series_prefix_chk" CHECK ("prefix" ~ '^[A-Z0-9]{1,4}$'),
    CONSTRAINT "document_number_series_year_chk" CHECK ("financialYear" ~ '^[0-9]{2}-[0-9]{2}$'),
    CONSTRAINT "document_number_series_serial_chk" CHECK ("nextSerial" BETWEEN 1 AND 100000),
    CONSTRAINT "document_number_series_scope_chk" CHECK (
      ("gstRegistrationId" IS NULL AND "numberingScope" = 'HOSPITAL:' || "hospitalId"::text)
      OR ("gstRegistrationId" IS NOT NULL AND ("numberingScope" ~ '^[0-9]{2}[A-Z0-9]{13}$'
                                               OR "numberingScope" = 'HOSPITAL:' || "hospitalId"::text))),
    CONSTRAINT "document_number_series_closed_chk" CHECK (("closedAt" IS NULL) = ("closedById" IS NULL))
);
CREATE UNIQUE INDEX "document_number_series_id_hospitalId_key" ON "document_number_series" ("id", "hospitalId");
CREATE UNIQUE INDEX "document_number_series_numberingScope_financialYear_prefix_key"
  ON "document_number_series" ("numberingScope", "financialYear", "prefix");
CREATE UNIQUE INDEX "document_number_series_one_open"
  ON "document_number_series" ("hospitalId", COALESCE("gstRegistrationId", '00000000-0000-0000-0000-000000000000'::uuid), "financialYear", "documentType")
  WHERE "closedAt" IS NULL;
ALTER TABLE "document_number_series"
  ADD CONSTRAINT "document_number_series_hospitalId_fkey" FOREIGN KEY ("hospitalId")
    REFERENCES hospitals (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "document_number_series_gstRegistrationId_hospitalId_fkey" FOREIGN KEY ("gstRegistrationId", "hospitalId")
    REFERENCES hospital_gst_registrations (id, "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "document_number_series_openedById_hospitalId_fkey" FOREIGN KEY ("openedById", "hospitalId")
    REFERENCES users (id, "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "document_number_series_closedById_hospitalId_fkey" FOREIGN KEY ("closedById", "hospitalId")
    REFERENCES users (id, "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE invoices ADD CONSTRAINT "invoices_seriesId_hospitalId_fkey" FOREIGN KEY ("seriesId", "hospitalId")
  REFERENCES "document_number_series" (id, "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Series rows are never deleted; the counter never goes down; scope, year, type, prefix and owner
-- never change; a closed series stays closed and issues nothing more.
CREATE FUNCTION medcore_document_series_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Document number series are never deleted'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (NEW.id, NEW."hospitalId", NEW."gstRegistrationId", NEW."numberingScope", NEW."documentType",
      NEW."financialYear", NEW.prefix, NEW."openedAt", NEW."openedById")
     IS DISTINCT FROM (OLD.id, OLD."hospitalId", OLD."gstRegistrationId", OLD."numberingScope", OLD."documentType",
      OLD."financialYear", OLD.prefix, OLD."openedAt", OLD."openedById") THEN
    RAISE EXCEPTION 'A document number series keeps its scope, year, type and prefix; open a new series instead'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW."nextSerial" < OLD."nextSerial" THEN
    RAISE EXCEPTION 'A document number series counter never goes down'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."closedAt" IS NOT NULL AND (NEW."closedAt" IS DISTINCT FROM OLD."closedAt"
       OR NEW."closedById" IS DISTINCT FROM OLD."closedById" OR NEW."nextSerial" <> OLD."nextSerial") THEN
    RAISE EXCEPTION 'A closed document number series cannot be reopened or used'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER document_number_series_rules BEFORE UPDATE OR DELETE ON "document_number_series"
  FOR EACH ROW EXECUTE FUNCTION medcore_document_series_rules();

-- 5. Invoice lines: the tax snapshot (DEC-051) ----------------------------------------------------
ALTER TABLE invoice_items DROP CONSTRAINT invoice_items_line_total_chk;
ALTER TABLE invoice_items
  ADD COLUMN "serviceDate" DATE NOT NULL,
  ADD COLUMN "addedById" UUID,
  ADD COLUMN "unclassified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "classificationId" UUID,
  ADD COLUMN "classificationVersionId" UUID,
  ADD COLUMN "classificationName" TEXT,
  ADD COLUMN "hsnSac" VARCHAR(8),
  ADD COLUMN "supplyType" "TaxSupplyType",
  ADD COLUMN "treatment" "TaxTreatment",
  ADD COLUMN "ratePercent" DECIMAL(5,2),
  ADD COLUMN "priceIncludesTax" BOOLEAN,
  ADD COLUMN "gstCollected" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "notCollectedReason" "TaxNotCollectedReason",
  ADD COLUMN "grossAmount" DECIMAL(12,2) NOT NULL,
  ADD COLUMN "discountShare" DECIMAL(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN "taxableValue" DECIMAL(12,2) NOT NULL,
  ADD COLUMN "taxAmount" DECIMAL(12,2) NOT NULL,
  ADD COLUMN "roomRuleId" UUID,
  ADD COLUMN "roomDailyCharge" DECIMAL(12,2),
  ADD COLUMN "roomCriticalCare" BOOLEAN;

ALTER TABLE invoice_items
  ADD CONSTRAINT invoice_items_description_chk CHECK (length(btrim(description)) BETWEEN 1 AND 300),
  ADD CONSTRAINT invoice_items_manual_by_chk CHECK (kind NOT IN ('ROOM', 'OTHER') OR "addedById" IS NOT NULL),
  -- Only automatic consultation, lab and pharmacy lines can be unclassified (never blocks clinical
  -- work); such a line has no tax data and its invoice cannot be finalised.
  ADD CONSTRAINT invoice_items_snapshot_chk CHECK (
    CASE
      WHEN "unclassified" THEN
        kind IN ('CONSULTATION', 'LAB', 'PHARMACY') AND "classificationId" IS NULL
        AND "classificationVersionId" IS NULL AND "classificationName" IS NULL AND "hsnSac" IS NULL
        AND "supplyType" IS NULL AND "treatment" IS NULL AND "ratePercent" IS NULL
        AND "priceIncludesTax" IS NULL AND NOT "gstCollected" AND "notCollectedReason" IS NULL
      WHEN kind = 'ROOM' THEN
        "classificationId" IS NULL AND "classificationVersionId" IS NULL AND "roomRuleId" IS NOT NULL
        AND "roomDailyCharge" IS NOT NULL AND "roomCriticalCare" IS NOT NULL AND "supplyType" = 'SERVICE'
        AND "classificationName" IS NOT NULL AND "hsnSac" IS NOT NULL AND "treatment" IS NOT NULL
        AND "ratePercent" IS NOT NULL AND "priceIncludesTax" IS NOT NULL
      ELSE
        "classificationId" IS NOT NULL AND "classificationVersionId" IS NOT NULL
        AND "classificationName" IS NOT NULL AND "hsnSac" IS NOT NULL AND "supplyType" IS NOT NULL
        AND "treatment" IS NOT NULL AND "ratePercent" IS NOT NULL AND "priceIncludesTax" IS NOT NULL
        AND "roomRuleId" IS NULL AND "roomDailyCharge" IS NULL AND "roomCriticalCare" IS NULL
    END),
  ADD CONSTRAINT invoice_items_collection_chk CHECK (
    ("gstCollected" AND "notCollectedReason" IS NULL)
    OR (NOT "gstCollected" AND ("unclassified" OR "notCollectedReason" IS NOT NULL))),
  ADD CONSTRAINT invoice_items_rate_chk CHECK (
    "treatment" IS NULL
    OR ("treatment" = 'TAXABLE' AND "ratePercent" > 0 AND "ratePercent" <= 40)
    OR ("treatment" <> 'TAXABLE' AND "ratePercent" = 0 AND NOT "priceIncludesTax")),
  -- DEC-051 arithmetic, half-up to 0.01 once per step (PostgreSQL round() on these non-negative values).
  ADD CONSTRAINT invoice_items_arithmetic_chk CHECK (
    "grossAmount" = quantity * "unitPrice"
    AND "discountShare" >= 0 AND "discountShare" <= "grossAmount"
    AND CASE
      WHEN "unclassified" OR NOT "gstCollected" OR "treatment" <> 'TAXABLE' THEN
        "taxableValue" = "grossAmount" - "discountShare" AND "taxAmount" = 0
      WHEN "priceIncludesTax" THEN
        "taxableValue" = round(("grossAmount" - "discountShare") * 100 / (100 + "ratePercent"), 2)
        AND "taxAmount" = ("grossAmount" - "discountShare") - "taxableValue"
      ELSE
        "taxableValue" = "grossAmount" - "discountShare"
        AND "taxAmount" = round("taxableValue" * "ratePercent" / 100, 2)
    END
    AND "lineTotal" = "taxableValue" + "taxAmount");

ALTER TABLE invoice_items
  ADD CONSTRAINT "invoice_items_addedById_hospitalId_fkey" FOREIGN KEY ("addedById", "hospitalId")
    REFERENCES users (id, "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "invoice_items_classificationId_hospitalId_fkey" FOREIGN KEY ("classificationId", "hospitalId")
    REFERENCES tax_classifications (id, "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "invoice_items_classificationVersionId_hospitalId_fkey" FOREIGN KEY ("classificationVersionId", "hospitalId")
    REFERENCES tax_classification_versions (id, "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "invoice_items_roomRuleId_fkey" FOREIGN KEY ("roomRuleId")
    REFERENCES statutory_room_tax_rules (id) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "invoice_items_classificationVersionId_idx" ON invoice_items ("classificationVersionId");
CREATE INDEX "invoice_items_classificationId_idx" ON invoice_items ("classificationId");

-- 6. Line rules: lock protocol, source, snapshot (DEC-051, DEC-058, Q4 A, Q6 A) -------------------
-- The application computes every snapshot value with the shared helpers (packages/types billing.ts)
-- after taking the same locks; this trigger recomputes them from the committed tax data and refuses
-- any difference, so no code path can store a wrong snapshot.
--
-- Lock order, the same in every billing and tax writer (DEC-058): hospital row, then classification
-- row, then the invoice row. A line takes FOR SHARE on the first two, so it waits for any open version,
-- registration or assignment writer (which hold FOR NO KEY UPDATE until commit) and then reads their
-- committed values; it takes FOR NO KEY UPDATE on its invoice, so lines of one invoice are written one
-- at a time and a concurrent finalise either waits for them or is seen by them.
CREATE FUNCTION medcore_invoice_item_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  h uuid;
  inv record;
  appt uuid;
  td date;
  cid uuid;
  cls record;
  ver record;
  reg record;
  rule record;
  rm record;
  exp_price numeric(12,2);
  exp_qty integer;
  e_unclassified boolean := false;
  e_cid uuid; e_vid uuid; e_name text; e_hsn text; e_supply "TaxSupplyType"; e_treat "TaxTreatment";
  e_rate numeric(5,2); e_incl boolean; e_collected boolean; e_reason "TaxNotCollectedReason";
  e_rule uuid; e_daily numeric(12,2); e_critical boolean;
  diff text[] := ARRAY[]::text[];
BEGIN
  PERFORM medcore_billing_require_read_committed();
  h := CASE WHEN TG_OP = 'DELETE' THEN OLD."hospitalId" ELSE NEW."hospitalId" END;
  PERFORM 1 FROM hospitals WHERE id = h FOR SHARE;

  -- Which classification this line must use (read under the hospital lock, so assignments committed
  -- meanwhile are seen). Automatic lines never fail for a missing classification: they are stored as
  -- unclassified and block finalising instead (DEC-045).
  IF TG_OP <> 'DELETE' THEN
    IF NEW.kind = 'CONSULTATION' THEN
      SELECT "classificationId" INTO cid FROM hospital_tax_defaults WHERE "hospitalId" = h AND kind = 'CONSULTATION';
    ELSIF NEW.kind = 'LAB' THEN
      SELECT COALESCE(t."taxClassificationId", d."classificationId") INTO cid
        FROM lab_order_items i JOIN lab_tests t ON t.id = i."labTestId"
        LEFT JOIN hospital_tax_defaults d ON d."hospitalId" = h AND d.kind = 'LAB'
       WHERE i.id = NEW."labOrderItemId";
    ELSIF NEW.kind = 'PHARMACY' THEN
      SELECT m."taxClassificationId" INTO cid
        FROM dispenses x JOIN medicine_batches b ON b.id = x."batchId" JOIN medicines m ON m.id = b."medicineId"
       WHERE x.id = NEW."dispenseId";
    ELSIF NEW.kind = 'OTHER' THEN
      cid := NEW."classificationId";
      IF cid IS NULL THEN
        RAISE EXCEPTION 'An other charge needs a tax classification' USING ERRCODE = 'integrity_constraint_violation';
      END IF;
    END IF;
    -- Always run (cid may be NULL), so the record is assigned even when no row matches.
    SELECT * INTO cls FROM tax_classifications WHERE id = cid AND "hospitalId" = h FOR SHARE;
  END IF;

  SELECT * INTO inv FROM invoices
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD."invoiceId" ELSE NEW."invoiceId" END FOR NO KEY UPDATE;
  IF inv.status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Lines of an issued or void invoice cannot change'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND (NEW.id, NEW."hospitalId", NEW."invoiceId", NEW.kind, NEW.description, NEW.quantity,
        NEW."unitPrice", NEW."labOrderItemId", NEW."dispenseId", NEW."roomId", NEW."serviceDate", NEW."addedById",
        NEW."createdAt")
     IS DISTINCT FROM (OLD.id, OLD."hospitalId", OLD."invoiceId", OLD.kind, OLD.description, OLD.quantity,
        OLD."unitPrice", OLD."labOrderItemId", OLD."dispenseId", OLD."roomId", OLD."serviceDate", OLD."addedById",
        OLD."createdAt") THEN
    RAISE EXCEPTION 'Only the tax snapshot and discount share of a draft line can change; remove the line and add it again instead'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF TG_OP = 'INSERT' THEN
    td := medcore_tax_date(h);
    IF NEW."serviceDate" > td THEN
      RAISE EXCEPTION 'A charge cannot be dated after today (%)', td USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    -- The source belongs to this visit, and price and quantity come from it (Q4 A, Q6 A).
    IF NEW.kind = 'CONSULTATION' THEN
      SELECT d."consultationFee" INTO exp_price FROM appointments a JOIN doctors d ON d.id = a."doctorId"
       WHERE a.id = inv."appointmentId";
      exp_qty := 1;
      IF EXISTS (SELECT 1 FROM invoice_items i JOIN invoices v ON v.id = i."invoiceId"
                  WHERE v."appointmentId" = inv."appointmentId" AND v.status <> 'VOID'
                    AND i.kind = 'CONSULTATION' AND i.id <> NEW.id) THEN
        RAISE EXCEPTION 'This visit is already charged a consultation' USING ERRCODE = 'integrity_constraint_violation';
      END IF;
    ELSIF NEW.kind = 'LAB' THEN
      SELECT r."appointmentId", t.price INTO appt, exp_price
        FROM lab_order_items i JOIN lab_orders o ON o.id = i."labOrderId"
        JOIN medical_records r ON r.id = o."medicalRecordId" JOIN lab_tests t ON t.id = i."labTestId"
       WHERE i.id = NEW."labOrderItemId";
      exp_qty := 1;
      IF appt IS DISTINCT FROM inv."appointmentId" THEN
        RAISE EXCEPTION 'A lab charge must belong to the invoice''s visit' USING ERRCODE = 'integrity_constraint_violation';
      END IF;
    ELSIF NEW.kind = 'PHARMACY' THEN
      SELECT r."appointmentId", b.mrp, x.quantity INTO appt, exp_price, exp_qty
        FROM dispenses x JOIN medicine_batches b ON b.id = x."batchId"
        JOIN prescription_items pi ON pi.id = x."prescriptionItemId"
        JOIN prescriptions p ON p.id = pi."prescriptionId" JOIN medical_records r ON r.id = p."medicalRecordId"
       WHERE x.id = NEW."dispenseId";
      IF appt IS DISTINCT FROM inv."appointmentId" THEN
        RAISE EXCEPTION 'A pharmacy charge must belong to the invoice''s visit' USING ERRCODE = 'integrity_constraint_violation';
      END IF;
    ELSIF NEW.kind = 'ROOM' THEN
      SELECT "dailyCharge" INTO exp_price FROM rooms WHERE id = NEW."roomId";
      exp_qty := NEW.quantity;
      IF exp_price IS NULL THEN
        RAISE EXCEPTION 'This room has no daily charge' USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      IF NEW.quantity > 366 THEN
        RAISE EXCEPTION 'A room charge covers at most 366 days' USING ERRCODE = 'integrity_constraint_violation';
      END IF;
    ELSE
      exp_price := NEW."unitPrice";
      exp_qty := NEW.quantity;
    END IF;
    IF NEW."unitPrice" IS DISTINCT FROM exp_price OR NEW.quantity IS DISTINCT FROM exp_qty THEN
      RAISE EXCEPTION 'The price or quantity of this % charge must be % x % from its source', lower(NEW.kind::text), exp_qty, exp_price
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;

  -- Expected snapshot: the classification and its version in force on the service date, and the
  -- GST registration in force on the service date (DEC-047).
  SELECT * INTO reg FROM hospital_gst_registrations
   WHERE "hospitalId" = h AND "effectiveFrom" <= NEW."serviceDate" ORDER BY "effectiveFrom" DESC LIMIT 1;
  e_collected := FOUND AND reg."registrationType" = 'REGULAR';
  e_reason := CASE WHEN e_collected THEN NULL
                   WHEN FOUND AND reg."registrationType" = 'COMPOSITION' THEN 'COMPOSITION'
                   ELSE 'UNREGISTERED' END;

  IF NEW.kind = 'ROOM' THEN
    SELECT * INTO rule FROM statutory_room_tax_rules
     WHERE "effectiveFrom" <= NEW."serviceDate" ORDER BY "effectiveFrom" DESC LIMIT 1;
    SELECT * INTO rm FROM rooms WHERE id = NEW."roomId";
    e_daily := rm."dailyCharge";
    e_critical := rm.type = 'ICU' OR rm."criticalCareUnit" IS NOT NULL;
    IF rule.id IS NULL THEN
      RAISE EXCEPTION 'No statutory room rule covers %', NEW."serviceDate" USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    e_rule := rule.id; e_name := 'Room accommodation'; e_hsn := rule."sacCode"; e_supply := 'SERVICE';
    -- DEC-049: tested on the per-day charge before any discount; exactly the threshold stays exempt.
    IF NOT e_critical AND e_daily > rule."thresholdPerDay" THEN
      e_treat := 'TAXABLE'; e_rate := rule."ratePercent"; e_incl := rule."priceIncludesTax";
    ELSE
      e_treat := 'EXEMPT'; e_rate := 0; e_incl := false;
    END IF;
  ELSE
    -- An inactive classification cannot be used for a line (DEC-059); a classification with no
    -- version in force on the service date has no rate to apply. Either way: no version.
    SELECT v.* INTO ver FROM tax_classification_versions v
     WHERE v."classificationId" = cid AND v."effectiveFrom" <= NEW."serviceDate" AND cls."isActive" IS TRUE
     ORDER BY v."effectiveFrom" DESC LIMIT 1;
    IF ver.id IS NULL THEN
      IF NEW.kind = 'OTHER' THEN
        RAISE EXCEPTION 'The chosen tax classification is inactive or has no rate in force on %', NEW."serviceDate"
          USING ERRCODE = 'integrity_constraint_violation';
      END IF;
      e_unclassified := true; e_collected := false; e_reason := NULL;
    ELSE
      e_cid := cid; e_vid := ver.id; e_name := cls.name; e_hsn := cls."hsnSac"; e_supply := cls."supplyType";
      e_treat := ver.treatment; e_rate := ver."ratePercent"; e_incl := ver."priceIncludesTax";
    END IF;
  END IF;

  IF NEW."unclassified" IS DISTINCT FROM e_unclassified THEN diff := diff || 'unclassified'::text; END IF;
  IF NEW."classificationId" IS DISTINCT FROM e_cid THEN diff := diff || 'classificationId'::text; END IF;
  IF NEW."classificationVersionId" IS DISTINCT FROM e_vid THEN diff := diff || 'classificationVersionId'::text; END IF;
  IF NEW."classificationName" IS DISTINCT FROM e_name THEN diff := diff || 'classificationName'::text; END IF;
  IF NEW."hsnSac" IS DISTINCT FROM e_hsn THEN diff := diff || 'hsnSac'::text; END IF;
  IF NEW."supplyType" IS DISTINCT FROM e_supply THEN diff := diff || 'supplyType'::text; END IF;
  IF NEW.treatment IS DISTINCT FROM e_treat THEN diff := diff || 'treatment'::text; END IF;
  IF NEW."ratePercent" IS DISTINCT FROM e_rate THEN diff := diff || 'ratePercent'::text; END IF;
  IF NEW."priceIncludesTax" IS DISTINCT FROM e_incl THEN diff := diff || 'priceIncludesTax'::text; END IF;
  IF NEW."gstCollected" IS DISTINCT FROM e_collected THEN diff := diff || 'gstCollected'::text; END IF;
  IF NEW."notCollectedReason" IS DISTINCT FROM e_reason THEN diff := diff || 'notCollectedReason'::text; END IF;
  IF NEW."roomRuleId" IS DISTINCT FROM e_rule THEN diff := diff || 'roomRuleId'::text; END IF;
  IF NEW."roomDailyCharge" IS DISTINCT FROM e_daily THEN diff := diff || 'roomDailyCharge'::text; END IF;
  IF NEW."roomCriticalCare" IS DISTINCT FROM e_critical THEN diff := diff || 'roomCriticalCare'::text; END IF;
  IF cardinality(diff) > 0 THEN
    RAISE EXCEPTION 'The line''s tax snapshot does not match the tax settings in force on % (%); re-resolve the line',
      NEW."serviceDate", array_to_string(diff, ', ')
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invoice_items_rules BEFORE INSERT OR UPDATE OR DELETE ON invoice_items
  FOR EACH ROW EXECUTE FUNCTION medcore_invoice_item_rules();

-- 7. Invoice rules: creation, discount, void, finalise and numbering, immutability (DEC-052, DEC-053)

-- Prefix for a new series: the hospital's latest prefix for this document type, or the suggested
-- default (TI, ICB, BOS); if a series in the same scope and year already uses it, the next free of
-- <prefix>2..<prefix>9 (at most 4 characters), so a new registration under the same GSTIN never
-- repeats a number. The hospital admin can open a series with another prefix at any time.
CREATE FUNCTION medcore_document_prefix(h uuid, scope text, fy text, dt "DocumentType") RETURNS text LANGUAGE plpgsql AS $$
DECLARE
  base text;
  candidate text;
  n integer;
BEGIN
  SELECT prefix INTO base FROM "document_number_series"
   WHERE "hospitalId" = h AND "documentType" = dt ORDER BY "openedAt" DESC, id LIMIT 1;
  base := COALESCE(base, CASE dt WHEN 'TAX_INVOICE' THEN 'TI' WHEN 'INVOICE_CUM_BILL_OF_SUPPLY' THEN 'ICB' ELSE 'BOS' END);
  FOR n IN 1..9 LOOP
    candidate := CASE WHEN n = 1 THEN base ELSE left(base, 3) || n::text END;
    IF NOT EXISTS (SELECT 1 FROM "document_number_series"
                    WHERE "numberingScope" = scope AND "financialYear" = fy AND prefix = candidate) THEN
      RETURN candidate;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'No free document number prefix for % in %; open a series with a new prefix', dt, fy
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

CREATE FUNCTION medcore_invoice_rules() RETURNS trigger LANGUAGE plpgsql AS $$
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
    IF NEW.status <> OLD.status THEN
      RAISE EXCEPTION 'Payment statuses of an issued document are set by the payment rules (M-12)'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF (to_jsonb(NEW) - 'updatedAt' - 'receiptFileId') IS DISTINCT FROM (to_jsonb(OLD) - 'updatedAt' - 'receiptFileId')
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
CREATE TRIGGER invoices_rules BEFORE INSERT OR UPDATE OR DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION medcore_invoice_rules();

-- 8. Totals equal the sum of the lines, checked at commit (DEC-051) --------------------------------
-- Deferred so a transaction can add lines and update totals in any order; checked again, immediately,
-- when an invoice is finalised (above).
CREATE FUNCTION medcore_invoice_totals_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  inv_id uuid;
  inv record;
  agg record;
BEGIN
  IF TG_TABLE_NAME = 'invoices' THEN
    inv_id := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    inv_id := OLD."invoiceId";
  ELSE
    inv_id := NEW."invoiceId";
  END IF;
  SELECT * INTO inv FROM invoices WHERE id = inv_id;
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(sum("taxableValue"), 0) AS subtotal, COALESCE(sum("taxAmount"), 0) AS tax,
         COALESCE(sum("discountShare"), 0) AS discount
    INTO agg FROM invoice_items WHERE "invoiceId" = inv_id;
  IF (inv.subtotal, inv."taxAmount", inv."discountAmount") IS DISTINCT FROM (agg.subtotal, agg.tax, agg.discount) THEN
    RAISE EXCEPTION 'Invoice totals must equal the sum of its lines (subtotal %, tax %, discount %; lines give %, %, %)',
      inv.subtotal, inv."taxAmount", inv."discountAmount", agg.subtotal, agg.tax, agg.discount
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER invoices_totals_at_commit AFTER INSERT OR UPDATE ON invoices
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION medcore_invoice_totals_rules();
CREATE CONSTRAINT TRIGGER invoice_items_totals_at_commit AFTER INSERT OR UPDATE OR DELETE ON invoice_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION medcore_invoice_totals_rules();

-- 9. Invoice history, correction requests and notes (DEC-053), all append-only --------------------
CREATE TABLE "invoice_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "hospitalId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "kind" "InvoiceEventKind" NOT NULL,
    "actorId" UUID NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "invoice_events_invoiceId_createdAt_idx" ON "invoice_events" ("invoiceId", "createdAt");
ALTER TABLE "invoice_events"
  ADD CONSTRAINT "invoice_events_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES hospitals (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "invoice_events_invoiceId_hospitalId_fkey" FOREIGN KEY ("invoiceId", "hospitalId")
    REFERENCES invoices (id, "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "invoice_events_actorId_hospitalId_fkey" FOREIGN KEY ("actorId", "hospitalId")
    REFERENCES users (id, "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER invoice_events_append_only BEFORE UPDATE OR DELETE ON "invoice_events"
  FOR EACH ROW EXECUTE FUNCTION medcore_reject_change();

-- Written by the database itself, so the history cannot be skipped.
CREATE FUNCTION medcore_invoice_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO "invoice_events" ("hospitalId", "invoiceId", kind, "actorId")
    VALUES (NEW."hospitalId", NEW.id, 'CREATED', NEW."createdById");
    RETURN NULL;
  END IF;
  IF (NEW."discountAmount", NEW."discountReason") IS DISTINCT FROM (OLD."discountAmount", OLD."discountReason") THEN
    INSERT INTO "invoice_events" ("hospitalId", "invoiceId", kind, "actorId", note)
    VALUES (NEW."hospitalId", NEW.id, 'DISCOUNT_CHANGED', NEW."discountSetById",
            NEW."discountAmount"::text || COALESCE(': ' || NEW."discountReason", ''));
  END IF;
  IF NEW.status = 'FINALISED' AND OLD.status = 'DRAFT' THEN
    INSERT INTO "invoice_events" ("hospitalId", "invoiceId", kind, "actorId", note)
    VALUES (NEW."hospitalId", NEW.id, 'FINALISED', NEW."finalisedById", NEW."invoiceNumber");
  ELSIF NEW.status = 'VOID' AND OLD.status = 'DRAFT' THEN
    INSERT INTO "invoice_events" ("hospitalId", "invoiceId", kind, "actorId", note)
    VALUES (NEW."hospitalId", NEW.id, 'VOIDED', NEW."voidedById", NEW."voidReason");
  END IF;
  RETURN NULL;
END;
$$;
CREATE TRIGGER invoices_history AFTER INSERT OR UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION medcore_invoice_history();

CREATE TABLE "invoice_correction_requests" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "hospitalId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "kind" "CorrectionRequestKind" NOT NULL,
    "description" TEXT NOT NULL,
    "requestedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_correction_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoice_correction_requests_description_chk" CHECK (length(btrim("description")) BETWEEN 10 AND 2000)
);
CREATE UNIQUE INDEX "invoice_correction_requests_id_hospitalId_key" ON "invoice_correction_requests" ("id", "hospitalId");
CREATE INDEX "invoice_correction_requests_invoiceId_createdAt_idx" ON "invoice_correction_requests" ("invoiceId", "createdAt");
ALTER TABLE "invoice_correction_requests"
  ADD CONSTRAINT "invoice_correction_requests_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES hospitals (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "invoice_correction_requests_invoiceId_hospitalId_fkey" FOREIGN KEY ("invoiceId", "hospitalId")
    REFERENCES invoices (id, "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "invoice_correction_requests_requestedById_hospitalId_fkey" FOREIGN KEY ("requestedById", "hospitalId")
    REFERENCES users (id, "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "invoice_correction_request_notes" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "hospitalId" UUID NOT NULL,
    "requestId" UUID NOT NULL,
    "note" TEXT NOT NULL,
    "externalReference" VARCHAR(100),
    "authorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_correction_request_notes_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "invoice_correction_request_notes_note_chk" CHECK (length(btrim("note")) BETWEEN 3 AND 2000)
);
CREATE INDEX "invoice_correction_request_notes_requestId_createdAt_idx" ON "invoice_correction_request_notes" ("requestId", "createdAt");
ALTER TABLE "invoice_correction_request_notes"
  ADD CONSTRAINT "invoice_correction_request_notes_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES hospitals (id) ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "invoice_correction_request_notes_requestId_hospitalId_fkey" FOREIGN KEY ("requestId", "hospitalId")
    REFERENCES "invoice_correction_requests" (id, "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "invoice_correction_request_notes_authorId_hospitalId_fkey" FOREIGN KEY ("authorId", "hospitalId")
    REFERENCES users (id, "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION medcore_correction_request_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'invoice_correction_requests' THEN
    IF NOT medcore_user_role_in(NEW."hospitalId", NEW."requestedById", ARRAY['RECEPTIONIST', 'ACCOUNTANT']) THEN
      RAISE EXCEPTION 'Only a receptionist or accountant can request a correction' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM invoices WHERE id = NEW."invoiceId" AND status IN ('FINALISED', 'PARTIALLY_PAID', 'PAID')) THEN
      RAISE EXCEPTION 'Corrections are requested only for issued documents; a draft can be edited or voided'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    INSERT INTO "invoice_events" ("hospitalId", "invoiceId", kind, "actorId", note)
    VALUES (NEW."hospitalId", NEW."invoiceId", 'CORRECTION_REQUESTED', NEW."requestedById", NEW.kind::text);
  ELSIF NOT medcore_user_role_in(NEW."hospitalId", NEW."authorId", ARRAY['ACCOUNTANT']) THEN
    RAISE EXCEPTION 'Only an accountant can add an outcome note' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER invoice_correction_requests_rules BEFORE INSERT ON "invoice_correction_requests"
  FOR EACH ROW EXECUTE FUNCTION medcore_correction_request_rules();
CREATE TRIGGER invoice_correction_request_notes_rules BEFORE INSERT ON "invoice_correction_request_notes"
  FOR EACH ROW EXECUTE FUNCTION medcore_correction_request_rules();
CREATE TRIGGER invoice_correction_requests_append_only BEFORE UPDATE OR DELETE ON "invoice_correction_requests"
  FOR EACH ROW EXECUTE FUNCTION medcore_reject_change();
CREATE TRIGGER invoice_correction_request_notes_append_only BEFORE UPDATE OR DELETE ON "invoice_correction_request_notes"
  FOR EACH ROW EXECUTE FUNCTION medcore_reject_change();
