-- Manual reversal of M-11a (tax configuration). FOR REVIEW ONLY: never run without the owner's
-- explicit approval. Prisma has no down migrations; this script exists so the reversal is known and
-- tested in advance.
--
-- The guard below makes it refuse, changing nothing, if any tax configuration exists: a tax
-- classification (and so any version, default or lab-test or medicine assignment, which all need
-- one), a GST registration, a confirmed tax set-up, a critical-care unit on a room, or any statutory
-- room rule other than the exact row M-11a seeded. Only when all of these are empty does it drop
-- M-11a's objects, so it can never discard configuration or later statutory rules. A time-zone lock
-- (hospitals."taxTimezoneLockedAt") left behind by future-dated rows that were since deleted is
-- dropped with its column; it records no configuration. The migration's row in _prisma_migrations is
-- removed last, or Prisma would believe it is still applied. Runs as one implicit transaction: if
-- anything fails, nothing changes.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tax_classifications)
     OR EXISTS (SELECT 1 FROM hospital_gst_registrations)
     OR EXISTS (SELECT 1 FROM hospitals WHERE "taxSetupConfirmedAt" IS NOT NULL)
     OR EXISTS (SELECT 1 FROM rooms WHERE "criticalCareUnit" IS NOT NULL)
     OR (SELECT count(*) FROM statutory_room_tax_rules) <> 1
     OR NOT EXISTS (
       SELECT 1 FROM statutory_room_tax_rules
        WHERE "effectiveFrom" = '2022-07-18' AND "thresholdPerDay" = 5000.00 AND "ratePercent" = 5.00
          AND "sacCode" = '9993' AND NOT "priceIncludesTax"
          AND "legalReference" = 'Notification 04/2022-Central Tax (Rate) dated 13 July 2022, proviso to entry 74 of Notification 12/2017-Central Tax (Rate): room other than ICU/CCU/ICCU/NICU with room charges exceeding Rs. 5000 per day to a person receiving health care services; 5% without input tax credit') THEN
    RAISE EXCEPTION 'M-11a rollback refused: tax configuration or statutory rules exist and would be lost';
  END IF;
END $$;

DROP TRIGGER lab_tests_tax_classification ON lab_tests;
DROP TRIGGER medicines_tax_classification ON medicines;
DROP TRIGGER hospitals_tax_timezone ON hospitals;
ALTER TABLE "lab_tests" DROP CONSTRAINT "lab_tests_taxClassificationId_hospitalId_fkey";
ALTER TABLE "lab_tests" DROP COLUMN "taxClassificationId";
ALTER TABLE "medicines" DROP CONSTRAINT "medicines_taxClassificationId_hospitalId_fkey";
ALTER TABLE "medicines" DROP COLUMN "taxClassificationId";
ALTER TABLE "rooms" DROP COLUMN "criticalCareUnit";
ALTER TABLE "hospitals" DROP CONSTRAINT "hospitals_taxSetupConfirmedById_id_fkey";
ALTER TABLE "hospitals" DROP CONSTRAINT "hospitals_tax_setup_confirmed_chk";
ALTER TABLE "hospitals" DROP COLUMN "taxSetupConfirmedById";
ALTER TABLE "hospitals" DROP COLUMN "taxSetupConfirmedAt";
ALTER TABLE "hospitals" DROP COLUMN "taxTimezoneLockedAt";

DROP TABLE "hospital_tax_defaults";
DROP TABLE "tax_classification_versions";
DROP TABLE "tax_classifications";
DROP TABLE "hospital_gst_registrations";
DROP TABLE "statutory_room_tax_rules";

DROP FUNCTION medcore_tax_default_no_delete();
DROP FUNCTION medcore_tax_classification_ref_chk();
DROP FUNCTION medcore_gst_registration_rules();
DROP FUNCTION medcore_tax_classification_version_rules();
DROP FUNCTION medcore_tax_classification_rules();
DROP FUNCTION medcore_tax_timezone_rules();
DROP FUNCTION medcore_tax_date(uuid);
DROP FUNCTION medcore_tax_clock();
DROP FUNCTION medcore_gstin_valid(text);

DROP TYPE "CriticalCareUnit";
DROP TYPE "GstRegistrationType";
DROP TYPE "TaxTreatment";
DROP TYPE "TaxSupplyType";

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261117200000_tax_configuration';
