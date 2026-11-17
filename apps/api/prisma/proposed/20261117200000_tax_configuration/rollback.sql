-- Manual reversal of M-11a (tax configuration). FOR REVIEW ONLY: never run without the owner's
-- explicit approval. Prisma has no down migrations; this script exists so the reversal is known and
-- tested in advance.
--
-- It is safe only while no billing code depends on these objects and nothing has been recorded that
-- must be kept: it DELETES all tax classifications, versions, defaults, GST registrations and the
-- tax classification assigned to lab tests and medicines. It refuses to run if any of those holds a
-- row, so it can never discard real configuration silently. After running it, the migration's row
-- in _prisma_migrations must also be removed (last statement), or Prisma will believe it is applied.
-- Runs as one implicit transaction: if anything fails, nothing changes.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM tax_classifications) OR EXISTS (SELECT 1 FROM hospital_gst_registrations)
     OR EXISTS (SELECT 1 FROM hospitals WHERE "taxSetupConfirmedAt" IS NOT NULL)
     OR EXISTS (SELECT 1 FROM rooms WHERE "criticalCareUnit" IS NOT NULL) THEN
    RAISE EXCEPTION 'M-11a rollback refused: tax configuration data exists and would be lost';
  END IF;
END $$;

DROP TRIGGER lab_tests_tax_classification ON lab_tests;
DROP TRIGGER medicines_tax_classification ON medicines;
ALTER TABLE "lab_tests" DROP CONSTRAINT "lab_tests_taxClassificationId_hospitalId_fkey";
ALTER TABLE "lab_tests" DROP COLUMN "taxClassificationId";
ALTER TABLE "medicines" DROP CONSTRAINT "medicines_taxClassificationId_hospitalId_fkey";
ALTER TABLE "medicines" DROP COLUMN "taxClassificationId";
ALTER TABLE "rooms" DROP COLUMN "criticalCareUnit";
ALTER TABLE "hospitals" DROP CONSTRAINT "hospitals_taxSetupConfirmedById_id_fkey";
ALTER TABLE "hospitals" DROP CONSTRAINT "hospitals_tax_setup_confirmed_chk";
ALTER TABLE "hospitals" DROP COLUMN "taxSetupConfirmedById";
ALTER TABLE "hospitals" DROP COLUMN "taxSetupConfirmedAt";

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
DROP FUNCTION medcore_gstin_valid(text);
DROP FUNCTION medcore_hospital_today(uuid);

DROP TYPE "CriticalCareUnit";
DROP TYPE "GstRegistrationType";
DROP TYPE "TaxTreatment";
DROP TYPE "TaxSupplyType";

DELETE FROM "_prisma_migrations" WHERE "migration_name" = '20261117200000_tax_configuration';
