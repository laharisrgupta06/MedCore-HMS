-- M-09 (Phase 7, PHARM-001..004, DEC-042). Changes no existing row. It relaxes one NOT NULL (with a
-- CHECK that limits the exception) and adds CHECKs and triggers; stock_movements and dispenses have
-- no writer before Phase 7, so the CHECKs hold for any existing rows. If a row did violate one, the
-- whole migration would fail and change nothing.

-- The nightly expiry run quarantines batches with no signed-in user (owner decision, 23:17). Only such
-- automatic QUARANTINE rows, which must carry a reason, may have no performer.
ALTER TABLE "stock_movements" ALTER COLUMN "performedById" DROP NOT NULL;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_actor_chk" CHECK (
  "performedById" IS NOT NULL
  OR ("type" = 'QUARANTINE' AND coalesce(length(btrim("reason")), 0) > 0));

-- Ledger signs. RECEIPT adds, DISPENSE removes, ADJUSTMENT is a signed correction. QUARANTINE does not
-- change the batch quantity (owner decision, 23:17): its quantity is the number of units set aside,
-- recorded as a positive figure and excluded from the quantity balance.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sign_chk" CHECK (
  ("type" = 'RECEIPT' AND "quantity" > 0)
  OR ("type" = 'DISPENSE' AND "quantity" < 0)
  OR "type" = 'ADJUSTMENT'
  OR ("type" = 'QUARANTINE' AND "quantity" > 0));

-- A DISPENSE row is always linked to its dispense, and only DISPENSE rows are.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_dispense_link_chk" CHECK (
  ("type" = 'DISPENSE') = ("dispenseId" IS NOT NULL));

-- Adjustments and quarantines always say why.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reason_chk" CHECK (
  "type" NOT IN ('ADJUSTMENT', 'QUARANTINE') OR coalesce(length(btrim("reason")), 0) > 0);

-- The ledger and dispense records are never edited or deleted (approved plan, section 6).
-- medcore_reject_change() is defined in the initial migration.
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION medcore_reject_change();
CREATE TRIGGER dispenses_append_only BEFORE UPDATE OR DELETE ON dispenses
  FOR EACH ROW EXECUTE FUNCTION medcore_reject_change();
