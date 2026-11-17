-- M-11a (Phase 8, BILL-008, DEC-045 to DEC-050; review record DEC-055): tax configuration.
-- Adds four enums, five tables, three nullable columns on existing tables, two columns on hospitals,
-- helper functions, CHECKs, an exclusion constraint and triggers, and one row of platform reference
-- data (the statutory room rule). Changes no existing row. The file runs as one implicit
-- transaction: if any statement fails, nothing is created.
--
-- Nothing here is used by application code yet; invoices and their tax snapshots come in M-11b.

CREATE TYPE "TaxSupplyType" AS ENUM ('GOODS', 'SERVICE');
CREATE TYPE "TaxTreatment" AS ENUM ('EXEMPT', 'NIL_RATED', 'TAXABLE');
CREATE TYPE "GstRegistrationType" AS ENUM ('REGULAR', 'COMPOSITION', 'UNREGISTERED');
CREATE TYPE "CriticalCareUnit" AS ENUM ('ICU', 'CCU', 'ICCU', 'NICU');

-- Today's date in the hospital's own time zone (hospitals.timezone). now() is the transaction's
-- start time, so every check in one transaction sees the same date.
CREATE FUNCTION medcore_hospital_today(h uuid) RETURNS date LANGUAGE sql STABLE AS $$
  SELECT (now() AT TIME ZONE timezone)::date FROM hospitals WHERE id = h
$$;

-- GSTIN structure and check character (DEC-048): 2-digit state code 01..38, PAN (5 letters,
-- 4 digits, 1 letter), entity character, 'Z', and a mod-36 check character over the first 14.
-- This proves a number is well formed, not that the registration is active; the hospital admin
-- attests to that (hospital_gst_registrations.attestedById).
CREATE FUNCTION medcore_gstin_valid(g text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  s integer := 0;
  p integer;
BEGIN
  IF g !~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' THEN
    RETURN false;
  END IF;
  IF substr(g, 1, 2)::integer NOT BETWEEN 1 AND 38 THEN
    RETURN false;
  END IF;
  FOR i IN 1..14 LOOP
    p := (strpos(alphabet, substr(g, i, 1)) - 1) * (CASE WHEN i % 2 = 1 THEN 1 ELSE 2 END);
    s := s + p / 36 + p % 36;
  END LOOP;
  RETURN substr(alphabet, ((36 - s % 36) % 36) + 1, 1) = substr(g, 15, 1);
END;
$$;

-- Tax classifications (DEC-045): the stable identity of a kind of supply in one hospital.
-- SAC codes for services start with 99; HSN codes for goods never do.
CREATE TABLE "tax_classifications" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "supplyType" "TaxSupplyType" NOT NULL,
    "hsnSac" VARCHAR(8) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tax_classifications_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "tax_classifications_name_chk" CHECK (length(btrim("name")) BETWEEN 1 AND 120),
    CONSTRAINT "tax_classifications_code_chk" CHECK (
      "hsnSac" ~ '^[0-9]{4}([0-9]{2}([0-9]{2})?)?$'
      AND (("supplyType" = 'SERVICE') = ("hsnSac" LIKE '99%')))
);
CREATE UNIQUE INDEX "tax_classifications_id_hospitalId_key" ON "tax_classifications"("id", "hospitalId");
CREATE UNIQUE INDEX "tax_classifications_hospitalId_name_key" ON "tax_classifications"("hospitalId", "name");
ALTER TABLE "tax_classifications" ADD CONSTRAINT "tax_classifications_hospitalId_fkey"
  FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tax_classifications" ADD CONSTRAINT "tax_classifications_createdById_hospitalId_fkey"
  FOREIGN KEY ("createdById", "hospitalId") REFERENCES "users"("id", "hospitalId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- What the law says for a classification from a date (DEC-045). The version in force on a date is
-- the one with the latest effectiveFrom on or before it, so a new version closes the previous one
-- without editing it. No version takes effect before today (hospital time), and a version can be
-- edited or deleted only while it has not yet taken effect, so a version that applied to any day
-- can never change. (M-11b adds invoice-line references with ON DELETE RESTRICT on top of this.)
CREATE TABLE "tax_classification_versions" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "classificationId" UUID NOT NULL,
    "treatment" "TaxTreatment" NOT NULL,
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "priceIncludesTax" BOOLEAN NOT NULL,
    "effectiveFrom" DATE NOT NULL,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_classification_versions_pkey" PRIMARY KEY ("id"),
    -- Exempt and nil-rated supplies carry no rate and no tax inside the price; taxable supplies
    -- carry a positive rate no higher than the highest GST slab (40%).
    CONSTRAINT "tax_classification_versions_rate_chk" CHECK (
      ("treatment" = 'TAXABLE' AND "ratePercent" > 0 AND "ratePercent" <= 40)
      OR ("treatment" <> 'TAXABLE' AND "ratePercent" = 0 AND NOT "priceIncludesTax"))
);
CREATE UNIQUE INDEX "tax_classification_versions_id_hospitalId_key"
  ON "tax_classification_versions"("id", "hospitalId");
CREATE UNIQUE INDEX "tax_classification_versions_classificationId_effectiveFrom_key"
  ON "tax_classification_versions"("classificationId", "effectiveFrom");
ALTER TABLE "tax_classification_versions" ADD CONSTRAINT "tax_classification_versions_hospitalId_fkey"
  FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tax_classification_versions" ADD CONSTRAINT "tax_classification_versions_classificationId_hospitalId_fkey"
  FOREIGN KEY ("classificationId", "hospitalId") REFERENCES "tax_classifications"("id", "hospitalId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "tax_classification_versions" ADD CONSTRAINT "tax_classification_versions_createdById_hospitalId_fkey"
  FOREIGN KEY ("createdById", "hospitalId") REFERENCES "users"("id", "hospitalId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Hospital defaults (DEC-046): one classification for consultations and one for lab tests. Rooms
-- follow the statutory rule, medicines need their own classification, other lines are chosen by
-- staff, so no other kind has a default.
CREATE TABLE "hospital_tax_defaults" (
    "hospitalId" UUID NOT NULL,
    "kind" "InvoiceItemKind" NOT NULL,
    "classificationId" UUID NOT NULL,
    "updatedById" UUID NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "hospital_tax_defaults_pkey" PRIMARY KEY ("hospitalId", "kind"),
    CONSTRAINT "hospital_tax_defaults_kind_chk" CHECK ("kind" IN ('CONSULTATION', 'LAB'))
);
ALTER TABLE "hospital_tax_defaults" ADD CONSTRAINT "hospital_tax_defaults_hospitalId_fkey"
  FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospital_tax_defaults" ADD CONSTRAINT "hospital_tax_defaults_classificationId_hospitalId_fkey"
  FOREIGN KEY ("classificationId", "hospitalId") REFERENCES "tax_classifications"("id", "hospitalId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospital_tax_defaults" ADD CONSTRAINT "hospital_tax_defaults_updatedById_hospitalId_fkey"
  FOREIGN KEY ("updatedById", "hospitalId") REFERENCES "users"("id", "hospitalId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- The hospital admin's confirmation of the tax set-up, required before the first invoice (DEC-046).
-- The confirming user belongs to the same hospital (composite key, as for the address, DEC-031).
ALTER TABLE "hospitals" ADD COLUMN "taxSetupConfirmedAt" TIMESTAMPTZ(3);
ALTER TABLE "hospitals" ADD COLUMN "taxSetupConfirmedById" UUID;
ALTER TABLE "hospitals" ADD CONSTRAINT "hospitals_tax_setup_confirmed_chk" CHECK (
  ("taxSetupConfirmedAt" IS NULL) = ("taxSetupConfirmedById" IS NULL));
ALTER TABLE "hospitals" ADD CONSTRAINT "hospitals_taxSetupConfirmedById_id_fkey"
  FOREIGN KEY ("taxSetupConfirmedById", "id") REFERENCES "users"("id", "hospitalId")
  ON DELETE RESTRICT ON UPDATE NO ACTION;

-- GST registrations (DEC-047, DEC-048, DEC-050): dated rows; the registration in force on a date is
-- the one with the latest effectiveFrom on or before it. No backdating, no edits; a row that has
-- not yet taken effect may be deleted to correct a mistake. A hospital with no row is unregistered.
-- A GSTIN can belong to only one MedCore hospital (Q1g A), enforced by the exclusion constraint;
-- the API turns its error into a message that names no hospital.
CREATE TABLE "hospital_gst_registrations" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "registrationType" "GstRegistrationType" NOT NULL,
    "gstin" VARCHAR(15),
    "legalName" TEXT,
    "stateCode" CHAR(2),
    "effectiveFrom" DATE NOT NULL,
    "attestedById" UUID NOT NULL,
    "attestedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hospital_gst_registrations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "hospital_gst_registrations_details_chk" CHECK (
      ("registrationType" = 'UNREGISTERED'
        AND "gstin" IS NULL AND "legalName" IS NULL AND "stateCode" IS NULL)
      OR ("registrationType" <> 'UNREGISTERED'
        AND "gstin" IS NOT NULL AND medcore_gstin_valid("gstin")
        AND "stateCode" IS NOT NULL AND "stateCode" = substr("gstin", 1, 2)
        AND "legalName" IS NOT NULL AND length(btrim("legalName")) BETWEEN 1 AND 200)),
    CONSTRAINT "hospital_gst_registrations_gstin_one_hospital" EXCLUDE USING gist (
      "gstin" WITH =, "hospitalId" WITH <>) WHERE ("gstin" IS NOT NULL)
);
CREATE UNIQUE INDEX "hospital_gst_registrations_id_hospitalId_key"
  ON "hospital_gst_registrations"("id", "hospitalId");
CREATE UNIQUE INDEX "hospital_gst_registrations_hospitalId_effectiveFrom_key"
  ON "hospital_gst_registrations"("hospitalId", "effectiveFrom");
ALTER TABLE "hospital_gst_registrations" ADD CONSTRAINT "hospital_gst_registrations_hospitalId_fkey"
  FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "hospital_gst_registrations" ADD CONSTRAINT "hospital_gst_registrations_attestedById_hospitalId_fkey"
  FOREIGN KEY ("attestedById", "hospitalId") REFERENCES "users"("id", "hospitalId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Statutory room rule (DEC-049): platform reference data, not tenant data. A non-ICU, CCU, ICCU or
-- NICU room whose charge per day per patient exceeds the threshold is taxed on the whole charge.
-- Rows change only through a reviewed migration; the application has no writer. Until separate
-- database accounts exist (P14-09, SECURITY R-08) the database cannot tell a migration from the
-- application, so "append-only" is what the trigger enforces and "no application writer" is
-- enforced by code review and a test.
CREATE TABLE "statutory_room_tax_rules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "effectiveFrom" DATE NOT NULL,
    "thresholdPerDay" DECIMAL(12,2) NOT NULL,
    "ratePercent" DECIMAL(5,2) NOT NULL,
    "sacCode" VARCHAR(8) NOT NULL,
    "priceIncludesTax" BOOLEAN NOT NULL DEFAULT false,
    "legalReference" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "statutory_room_tax_rules_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "statutory_room_tax_rules_values_chk" CHECK (
      "thresholdPerDay" > 0 AND "ratePercent" > 0 AND "ratePercent" <= 40
      AND "sacCode" ~ '^99[0-9]{2}([0-9]{2})?$'
      AND length(btrim("legalReference")) > 0)
);
CREATE UNIQUE INDEX "statutory_room_tax_rules_effectiveFrom_key" ON "statutory_room_tax_rules"("effectiveFrom");

INSERT INTO "statutory_room_tax_rules"
  ("effectiveFrom", "thresholdPerDay", "ratePercent", "sacCode", "priceIncludesTax", "legalReference")
VALUES
  ('2022-07-18', 5000.00, 5.00, '9993', false,
   'Notification 04/2022-Central Tax (Rate) dated 13 July 2022, proviso to entry 74 of Notification 12/2017-Central Tax (Rate): room other than ICU/CCU/ICCU/NICU with room charges exceeding Rs. 5000 per day to a person receiving health care services; 5% without input tax credit');

CREATE TRIGGER statutory_room_tax_rules_append_only BEFORE UPDATE OR DELETE ON statutory_room_tax_rules
  FOR EACH ROW EXECUTE FUNCTION medcore_reject_change();

-- Item classifications (DEC-045, DEC-046): lab tests take a service classification, medicines a
-- goods classification. Nullable, no backfill: existing rows and Phase 6/7 flows are unchanged.
ALTER TABLE "lab_tests" ADD COLUMN "taxClassificationId" UUID;
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_taxClassificationId_hospitalId_fkey"
  FOREIGN KEY ("taxClassificationId", "hospitalId") REFERENCES "tax_classifications"("id", "hospitalId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "medicines" ADD COLUMN "taxClassificationId" UUID;
ALTER TABLE "medicines" ADD CONSTRAINT "medicines_taxClassificationId_hospitalId_fkey"
  FOREIGN KEY ("taxClassificationId", "hospitalId") REFERENCES "tax_classifications"("id", "hospitalId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- Critical-care rooms (DEC-049): a room of type ICU, or with any critical-care unit set, is exempt
-- from the room rule at any price. Nullable, no backfill.
ALTER TABLE "rooms" ADD COLUMN "criticalCareUnit" "CriticalCareUnit";

-- Rules ------------------------------------------------------------------------------------------

-- Classifications are never deleted. Only the name and the active flag change; a different code or
-- supply type is a new classification. A classification in use as a hospital default stays active.
CREATE FUNCTION medcore_tax_classification_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mutable text[] := ARRAY['name', 'isActive', 'updatedAt'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Tax classifications are never deleted; deactivate it instead'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'Only the name and active flag of a tax classification can change; create a new classification instead'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."isActive" AND NOT NEW."isActive" AND EXISTS (
       SELECT 1 FROM hospital_tax_defaults d WHERE d."classificationId" = NEW.id) THEN
    RAISE EXCEPTION 'A tax classification used as a hospital default cannot be deactivated'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tax_classifications_rules BEFORE UPDATE OR DELETE ON tax_classifications
  FOR EACH ROW EXECUTE FUNCTION medcore_tax_classification_rules();

-- Versions: start today or later; editable or deletable only before they take effect.
CREATE FUNCTION medcore_tax_classification_version_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  today date;
BEGIN
  today := medcore_hospital_today(CASE WHEN TG_OP = 'DELETE' THEN OLD."hospitalId" ELSE NEW."hospitalId" END);
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD."effectiveFrom" <= today THEN
    RAISE EXCEPTION 'A tax classification version that has taken effect cannot change; add a new version instead'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF NEW."effectiveFrom" < today THEN
    RAISE EXCEPTION 'A tax classification version cannot start before today in the hospital time zone'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.id, NEW."hospitalId", NEW."classificationId", NEW."createdById", NEW."createdAt")
       IS DISTINCT FROM (OLD.id, OLD."hospitalId", OLD."classificationId", OLD."createdById", OLD."createdAt") THEN
    RAISE EXCEPTION 'Only the treatment, rate, price-includes-tax flag and start date of a future version can change'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER tax_classification_versions_rules BEFORE INSERT OR UPDATE OR DELETE ON tax_classification_versions
  FOR EACH ROW EXECUTE FUNCTION medcore_tax_classification_version_rules();

-- Registrations: start today or later; never edited; deletable only before they take effect.
CREATE FUNCTION medcore_gst_registration_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'A GST registration is never edited; add a new registration from a later date'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD."effectiveFrom" <= medcore_hospital_today(OLD."hospitalId") THEN
      RAISE EXCEPTION 'A GST registration that has taken effect cannot be deleted'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF NEW."effectiveFrom" < medcore_hospital_today(NEW."hospitalId") THEN
    RAISE EXCEPTION 'A GST registration cannot be backdated'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hospital_gst_registrations_rules BEFORE INSERT OR UPDATE OR DELETE ON hospital_gst_registrations
  FOR EACH ROW EXECUTE FUNCTION medcore_gst_registration_rules();

-- A referenced classification must be active and of the right supply type. Arguments: the expected
-- supply type and the name of the referencing column. Fires only when that column is set or changed.
CREATE FUNCTION medcore_tax_classification_ref_chk() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected "TaxSupplyType" := TG_ARGV[0]::"TaxSupplyType";
  ref uuid := (to_jsonb(NEW) ->> TG_ARGV[1])::uuid;
  c record;
BEGIN
  IF ref IS NULL OR (TG_OP = 'UPDATE' AND ref IS NOT DISTINCT FROM (to_jsonb(OLD) ->> TG_ARGV[1])::uuid) THEN
    RETURN NEW;
  END IF;
  SELECT "supplyType", "isActive" INTO c FROM tax_classifications
   WHERE id = ref AND "hospitalId" = NEW."hospitalId";
  IF NOT FOUND THEN
    RETURN NEW;  -- the composite foreign key reports it
  END IF;
  IF c."supplyType" <> expected THEN
    RAISE EXCEPTION '% needs a % tax classification', TG_TABLE_NAME, lower(expected::text)
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT c."isActive" THEN
    RAISE EXCEPTION 'An inactive tax classification cannot be assigned'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lab_tests_tax_classification BEFORE INSERT OR UPDATE OF "taxClassificationId" ON lab_tests
  FOR EACH ROW EXECUTE FUNCTION medcore_tax_classification_ref_chk('SERVICE', 'taxClassificationId');
CREATE TRIGGER medicines_tax_classification BEFORE INSERT OR UPDATE OF "taxClassificationId" ON medicines
  FOR EACH ROW EXECUTE FUNCTION medcore_tax_classification_ref_chk('GOODS', 'taxClassificationId');
CREATE TRIGGER hospital_tax_defaults_classification BEFORE INSERT OR UPDATE OF "classificationId" ON hospital_tax_defaults
  FOR EACH ROW EXECUTE FUNCTION medcore_tax_classification_ref_chk('SERVICE', 'classificationId');
-- A default can be changed to another classification but not removed.
CREATE FUNCTION medcore_tax_default_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A hospital tax default cannot be removed; point it at another classification instead'
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;
CREATE TRIGGER hospital_tax_defaults_no_delete BEFORE DELETE ON hospital_tax_defaults
  FOR EACH ROW EXECUTE FUNCTION medcore_tax_default_no_delete();
