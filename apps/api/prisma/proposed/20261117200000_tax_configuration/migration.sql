-- M-11a (Phase 8, BILL-008, DEC-045 to DEC-050; review record DEC-055): tax configuration.
-- Adds four enums, five tables, three nullable columns on existing tables, three columns on hospitals,
-- helper functions, CHECKs, an exclusion constraint and triggers, and one row of platform reference
-- data (the statutory room rule). Changes no existing row. The file runs as one implicit
-- transaction: if any statement fails, nothing is created.
--
-- Nothing here is used by application code yet; invoices and their tax snapshots come in M-11b.
--
-- Revision 2 (owner review 2026-11-18 22:24): effective dates are checked against the actual clock
-- when each statement runs and again at commit, with a 10-minute freeze margin before midnight; a
-- hospital's time zone is fixed once it has tax versions or GST registrations; GSTIN validation also
-- checks the PAN holder type and sequence.
--
-- Revision 3 (owner review 2026-11-18 22:47): writers of effective-dated rows hold row locks until
-- they commit (lock order: hospital row, then classification row), so that readers taking shared
-- locks in the same order (required of M-11b) always see a writer's final, committed values. The
-- time checks alone cannot guarantee this: a commit can become visible long after its last check
-- (storage or synchronous-replication stalls), and SET CONSTRAINTS ALL IMMEDIATE moves the
-- commit-time check earlier. See docs/migration-review.md section 11 for the guarantees.
--
-- Revision 4 (owner review 2026-11-19 15:55): assigning a classification (lab test, medicine,
-- hospital default) now takes the hospital row and then writes the classification row (a write that
-- changes no value), so it cannot interleave with a deactivation of that classification at any
-- isolation level; and a new version cannot be added to an inactive classification. No new objects.

CREATE TYPE "TaxSupplyType" AS ENUM ('GOODS', 'SERVICE');
CREATE TYPE "TaxTreatment" AS ENUM ('EXEMPT', 'NIL_RATED', 'TAXABLE');
CREATE TYPE "GstRegistrationType" AS ENUM ('REGULAR', 'COMPOSITION', 'UNREGISTERED');
CREATE TYPE "CriticalCareUnit" AS ENUM ('ICU', 'CCU', 'ICCU', 'NICU');

-- The clock of the tax rules: the actual time of the check. now() would be the transaction's start
-- time, which a transaction open across midnight would still see as yesterday. One function, so the
-- validation can simulate any time of day.
CREATE FUNCTION medcore_tax_clock() RETURNS timestamptz LANGUAGE sql VOLATILE AS $$
  SELECT clock_timestamp()
$$;

-- The hospital's tax date: its local date ten minutes from now. Rows dated on or before it have
-- taken effect (or are about to) and can no longer change. The ten minutes cover the gap between a
-- check and the end of the commit that follows it, so from 23:50 local time the next day already
-- counts as in force.
--
-- The first call for a hospital also stamps hospitals."taxTimezoneLockedAt", after which its time
-- zone cannot change (medcore_tax_timezone_rules). The stamp is a write to the hospital row, so a
-- concurrent time-zone change either waits and is then refused (READ COMMITTED) or fails with a
-- serialization error (REPEATABLE READ, SERIALIZABLE); it can never slip in between.
CREATE FUNCTION medcore_tax_date(h uuid) RETURNS date LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  tz text;
BEGIN
  UPDATE hospitals SET "taxTimezoneLockedAt" = medcore_tax_clock()
   WHERE id = h AND "taxTimezoneLockedAt" IS NULL;
  SELECT timezone INTO tz FROM hospitals WHERE id = h;
  IF tz IS NULL THEN
    RAISE EXCEPTION 'Unknown hospital %', h USING ERRCODE = 'foreign_key_violation';
  END IF;
  RETURN ((medcore_tax_clock() + interval '10 minutes') AT TIME ZONE tz)::date;
END;
$$;

-- GSTIN structure and check character (DEC-048) for the registrations a hospital supplies under
-- (normal taxpayer or composition): 2-digit state code 01..38; PAN of 5 letters, 4 digits and
-- 1 letter, whose fourth letter is an Income Tax Department holder type (A, B, C, F, G, H, J, L, P,
-- T) and whose digits are not 0000; entity character 1-9 or A-Z; 'Z'; and the Luhn mod-36 check
-- character over the first 14. Tax deductor, tax collector, UIN and non-resident formats are refused
-- by design: a hospital does not invoice patients under them. This proves a number is well formed,
-- not that the registration is active; the hospital admin attests to that (attestedById).
CREATE FUNCTION medcore_gstin_valid(g text) RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE
  alphabet constant text := '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  s integer := 0;
  p integer;
BEGIN
  IF g !~ '^[0-9]{2}[A-Z]{3}[ABCFGHJLPT][A-Z][0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$' OR substr(g, 8, 4) = '0000' THEN
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
-- without editing it. Against the hospital's tax date (medcore_tax_date), checked when each
-- statement runs and again at commit: no version starts before it; once a version is in force,
-- later versions start after it, so what applied on any day already begun never changes; and a
-- version can be edited or deleted only while it starts after it. (M-11b adds invoice-line
-- references with ON DELETE RESTRICT on top of this.)
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

-- Effective dates are calendar dates in the hospital's time zone, so changing the zone would move
-- "today" and could reopen a version or registration that has already taken effect (moving west) or
-- allow one to be backdated. Once the hospital has any tax version or GST registration
-- (taxTimezoneLockedAt, stamped by medcore_tax_date), the time zone is fixed and the stamp cannot be
-- cleared. A correction after that is a reviewed migration, not an application change.
ALTER TABLE "hospitals" ADD COLUMN "taxTimezoneLockedAt" TIMESTAMPTZ(3);
CREATE FUNCTION medcore_tax_timezone_rules() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD."taxTimezoneLockedAt" IS NOT NULL AND (
       NEW.timezone IS DISTINCT FROM OLD.timezone
       OR NEW."taxTimezoneLockedAt" IS DISTINCT FROM OLD."taxTimezoneLockedAt") THEN
    RAISE EXCEPTION 'The time zone of a hospital with tax versions or GST registrations cannot change'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER hospitals_tax_timezone BEFORE UPDATE OF timezone, "taxTimezoneLockedAt" ON hospitals
  FOR EACH ROW EXECUTE FUNCTION medcore_tax_timezone_rules();

-- GST registrations (DEC-047, DEC-048, DEC-050): dated rows; the registration in force on a date is
-- the one with the latest effectiveFrom on or before it. Never edited. Against the hospital's tax
-- date, at each statement and at commit: no row starts before it; once a registration is in force,
-- later ones start after it; a row may be deleted only while it starts after it. A hospital with no
-- row is unregistered.
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
-- database accounts exist (P14-09, SECURITY R-11) the database cannot tell a migration from the
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

-- Versions (DEC-045). The same function runs when each statement runs (BEFORE) and again at commit
-- (deferred constraint trigger), with the clock read each time. When each statement runs it also
-- locks the hospital row and then the classification row (FOR NO KEY UPDATE, which does not block
-- foreign-key checks) until commit, so a reader that takes FOR SHARE on those rows in the same order
-- waits for this transaction to finish. Every writer takes the hospital row first, so a transaction
-- that mixes version and registration writes cannot deadlock with such a reader. A new version needs
-- an active classification (revision 4); recorded versions stay valid after a deactivation.
CREATE FUNCTION medcore_tax_classification_version_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  d date;
  active boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    d := medcore_tax_date(OLD."hospitalId");
  ELSE
    IF TG_WHEN = 'AFTER' THEN
      -- At commit, judge the row as it now stands; if it has since been deleted, its delete is judged.
      SELECT * INTO r FROM tax_classification_versions WHERE id = NEW.id;
      IF NOT FOUND THEN
        RETURN NULL;
      END IF;
    ELSE
      r := NEW;
    END IF;
    d := medcore_tax_date(r."hospitalId");
  END IF;
  IF TG_WHEN = 'BEFORE' THEN
    -- Always hospital row first, then classification row, whatever else the transaction writes.
    PERFORM 1 FROM hospitals
     WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD."hospitalId" ELSE NEW."hospitalId" END
       FOR NO KEY UPDATE;
    SELECT "isActive" INTO active FROM tax_classifications
     WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD."classificationId" ELSE NEW."classificationId" END
       FOR NO KEY UPDATE;
    -- Read under the lock: a deactivation committed meanwhile is seen (READ COMMITTED) or makes this
    -- statement fail with a serialization error (REPEATABLE READ, SERIALIZABLE). Versions already
    -- recorded stay valid when a classification is deactivated; only new ones are refused.
    IF TG_OP = 'INSERT' AND active IS FALSE THEN
      RAISE EXCEPTION 'A new tax classification version cannot be added to an inactive classification'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  IF TG_OP IN ('UPDATE', 'DELETE') AND OLD."effectiveFrom" <= d THEN
    RAISE EXCEPTION 'A tax classification version in force from % cannot change (tax date %); add a new version instead', OLD."effectiveFrom", d
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN CASE WHEN TG_WHEN = 'BEFORE' THEN OLD END;
  END IF;
  IF TG_OP = 'UPDATE' AND r."effectiveFrom" <= d THEN
    RAISE EXCEPTION 'A future tax classification version can only be moved to a date after %', d
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF r."effectiveFrom" < d THEN
    RAISE EXCEPTION 'A tax classification version cannot start before % (the hospital''s tax date)', d
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF r."effectiveFrom" = d AND (EXISTS (
       SELECT 1 FROM tax_classification_versions v
        WHERE v."classificationId" = r."classificationId" AND v.id <> r.id AND v."effectiveFrom" <= d)) THEN
    RAISE EXCEPTION 'This classification already has a version in force; a new version must start after %', d
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_WHEN = 'BEFORE' AND TG_OP = 'UPDATE' AND (NEW.id, NEW."hospitalId", NEW."classificationId", NEW."createdById", NEW."createdAt")
       IS DISTINCT FROM (OLD.id, OLD."hospitalId", OLD."classificationId", OLD."createdById", OLD."createdAt") THEN
    RAISE EXCEPTION 'Only the treatment, rate, price-includes-tax flag and start date of a future version can change'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN CASE WHEN TG_WHEN = 'BEFORE' THEN NEW END;
END;
$$;
CREATE TRIGGER tax_classification_versions_rules BEFORE INSERT OR UPDATE OR DELETE ON tax_classification_versions
  FOR EACH ROW EXECUTE FUNCTION medcore_tax_classification_version_rules();
CREATE CONSTRAINT TRIGGER tax_classification_versions_rules_at_commit
  AFTER INSERT OR UPDATE OR DELETE ON tax_classification_versions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION medcore_tax_classification_version_rules();

-- Registrations (DEC-047). Same pattern: checked when each statement runs and again at commit.
-- When each statement runs it first locks the hospital row (FOR NO KEY UPDATE) until commit, so a
-- reader that takes FOR SHARE on the hospital row waits for this transaction to finish.
CREATE FUNCTION medcore_gst_registration_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  d date;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'A GST registration is never edited; add a new registration from a later date'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_WHEN = 'BEFORE' THEN
    PERFORM 1 FROM hospitals
     WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD."hospitalId" ELSE NEW."hospitalId" END
       FOR NO KEY UPDATE;
  END IF;
  IF TG_OP = 'DELETE' THEN
    d := medcore_tax_date(OLD."hospitalId");
    IF OLD."effectiveFrom" <= d THEN
      RAISE EXCEPTION 'A GST registration in force from % cannot be deleted (tax date %)', OLD."effectiveFrom", d
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN CASE WHEN TG_WHEN = 'BEFORE' THEN OLD END;
  END IF;
  IF TG_WHEN = 'AFTER' THEN
    SELECT * INTO r FROM hospital_gst_registrations WHERE id = NEW.id;
    IF NOT FOUND THEN
      RETURN NULL;
    END IF;
  ELSE
    r := NEW;
  END IF;
  d := medcore_tax_date(r."hospitalId");
  IF r."effectiveFrom" < d THEN
    RAISE EXCEPTION 'A GST registration cannot be backdated: it cannot start before % (the hospital''s tax date)', d
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF r."effectiveFrom" = d AND EXISTS (
       SELECT 1 FROM hospital_gst_registrations g
        WHERE g."hospitalId" = r."hospitalId" AND g.id <> r.id AND g."effectiveFrom" <= d) THEN
    RAISE EXCEPTION 'A GST registration is already in force; a new registration must start after %', d
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN CASE WHEN TG_WHEN = 'BEFORE' THEN NEW END;
END;
$$;
CREATE TRIGGER hospital_gst_registrations_rules BEFORE INSERT OR UPDATE OR DELETE ON hospital_gst_registrations
  FOR EACH ROW EXECUTE FUNCTION medcore_gst_registration_rules();
CREATE CONSTRAINT TRIGGER hospital_gst_registrations_rules_at_commit
  AFTER INSERT OR DELETE ON hospital_gst_registrations
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION medcore_gst_registration_rules();

-- A referenced classification must be active and of the right supply type. Arguments: the expected
-- supply type and the name of the referencing column. Fires only when that column is set or changed.
-- Revision 4: it locks the hospital row (hospital first, as every tax writer does, DEC-058) and then
-- writes the classification row without changing it. That write conflicts with a concurrent
-- deactivation of the classification: under READ COMMITTED the later of the two waits and then sees
-- the other's committed result (the deactivation trigger then finds the new default; this check then
-- finds the classification inactive); under REPEATABLE READ and SERIALIZABLE the later one fails with
-- a serialization error. A lock alone would not do: a committed lock is invisible to a REPEATABLE READ
-- transaction whose snapshot is older.
CREATE FUNCTION medcore_tax_classification_ref_chk() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected "TaxSupplyType" := TG_ARGV[0]::"TaxSupplyType";
  ref uuid := (to_jsonb(NEW) ->> TG_ARGV[1])::uuid;
  c record;
BEGIN
  IF ref IS NULL OR (TG_OP = 'UPDATE' AND ref IS NOT DISTINCT FROM (to_jsonb(OLD) ->> TG_ARGV[1])::uuid) THEN
    RETURN NEW;
  END IF;
  PERFORM 1 FROM hospitals WHERE id = NEW."hospitalId" FOR NO KEY UPDATE;
  UPDATE tax_classifications SET "isActive" = "isActive"
   WHERE id = ref AND "hospitalId" = NEW."hospitalId"
   RETURNING "supplyType", "isActive" INTO c;
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
