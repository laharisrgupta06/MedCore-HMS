-- M-09 (Phase 7, PHARM-001..004, DEC-042, DEC-044). Changes no existing row. stock_movements and
-- dispenses have no writer before Phase 7, so the new rules hold for any existing rows; if one did
-- not, the whole migration fails and changes nothing (one implicit transaction).
--
-- Layer A of the system-quarantine design (owner approval 2026-11-17 13:38): the database cannot
-- tell two processes that share a login apart, so it guarantees instead that a system quarantine is
-- exactly what the nightly run would write. Layer B (separate database accounts for migrations,
-- the application and background jobs) is a mandatory Phase 14 task (SECURITY.md R-08).

-- Helper: true when the row version `x` was written by the current transaction.
CREATE FUNCTION medcore_same_tx(x xid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT x::text::bigint = (txid_current() % 4294967296)
$$;

-- System rows: no performer, linked to that day's expiry report of the same hospital.
ALTER TABLE "stock_movements" ALTER COLUMN "performedById" DROP NOT NULL;
ALTER TABLE "stock_movements" ADD COLUMN "expiryReportId" UUID;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_expiryReportId_hospitalId_fkey"
  FOREIGN KEY ("expiryReportId", "hospitalId") REFERENCES "expiry_reports"("id", "hospitalId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_system_chk" CHECK (
  ("performedById" IS NULL) = ("expiryReportId" IS NOT NULL)
  AND ("expiryReportId" IS NULL
       OR ("type" = 'QUARANTINE' AND coalesce(length(btrim("reason")), 0) > 0)));
CREATE UNIQUE INDEX "stock_movements_one_system_quarantine"
  ON "stock_movements"("batchId") WHERE "expiryReportId" IS NOT NULL;

-- Ledger signs. RECEIPT adds, DISPENSE removes, ADJUSTMENT is a signed correction. QUARANTINE does not
-- change the batch quantity: its figure is the physical units set aside, excluded from the balance.
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_sign_chk" CHECK (
  ("type" = 'RECEIPT' AND "quantity" > 0)
  OR ("type" = 'DISPENSE' AND "quantity" < 0)
  OR "type" = 'ADJUSTMENT'
  OR ("type" = 'QUARANTINE' AND "quantity" > 0));
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_dispense_link_chk" CHECK (
  ("type" = 'DISPENSE') = ("dispenseId" IS NOT NULL));
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_reason_chk" CHECK (
  "type" NOT IN ('ADJUSTMENT', 'QUARANTINE') OR coalesce(length(btrim("reason")), 0) > 0);

-- A system quarantine row is accepted only as the nightly run writes it: report of the same
-- hospital, created in this transaction, dated today in the hospital's time zone, listing this batch
-- as QUARANTINED; the batch expired by that date, quarantined in this transaction, and the row's
-- quantity equal to the batch's physical quantity.
CREATE FUNCTION medcore_system_quarantine_chk() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  r record;
  b record;
BEGIN
  IF NEW."expiryReportId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT er.xmin AS x, er."runDate", er.items, h.timezone INTO r
    FROM expiry_reports er JOIN hospitals h ON h.id = er."hospitalId"
   WHERE er.id = NEW."expiryReportId" AND er."hospitalId" = NEW."hospitalId";
  IF NOT FOUND OR NOT medcore_same_tx(r.x) THEN
    RAISE EXCEPTION 'A system quarantine must be written with its expiry report, in the same transaction'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF r."runDate" <> (now() AT TIME ZONE r.timezone)::date THEN
    RAISE EXCEPTION 'The expiry report of a system quarantine must be dated today in the hospital time zone'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NOT r.items @> jsonb_build_array(jsonb_build_object('batchId', NEW."batchId"::text, 'kind', 'QUARANTINED')) THEN
    RAISE EXCEPTION 'The expiry report does not list this batch as quarantined'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT mb.xmin AS x, mb.status, mb.quantity, mb."expiresOn" INTO b
    FROM medicine_batches mb WHERE mb.id = NEW."batchId" AND mb."hospitalId" = NEW."hospitalId";
  IF NOT FOUND OR b."expiresOn" > r."runDate" OR b.status <> 'QUARANTINED'
     OR NOT medcore_same_tx(b.x) OR NEW.quantity <> b.quantity THEN
    RAISE EXCEPTION 'A system quarantine must be an expired batch quarantined in this transaction, with its physical quantity'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stock_movements_system_quarantine BEFORE INSERT ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION medcore_system_quarantine_chk();

-- Batch status rules: new batches are ACTIVE; QUARANTINED is final; DEPLETED means empty.
CREATE FUNCTION medcore_batch_status_chk() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'ACTIVE' THEN
    RAISE EXCEPTION 'A new batch must be ACTIVE' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'QUARANTINED' AND NEW.status <> 'QUARANTINED' THEN
    RAISE EXCEPTION 'A quarantined batch stays quarantined' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status = 'DEPLETED' AND NEW.quantity <> 0 THEN
    RAISE EXCEPTION 'A depleted batch holds no units' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER medicine_batches_status BEFORE INSERT OR UPDATE ON medicine_batches
  FOR EACH ROW EXECUTE FUNCTION medcore_batch_status_chk();

-- Every quarantine of a batch holding units has its QUARANTINE ledger row in the same transaction.
CREATE FUNCTION medcore_quarantine_has_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'QUARANTINED' AND NEW.status = 'QUARANTINED' AND NEW.quantity > 0
     AND NOT EXISTS (SELECT 1 FROM stock_movements m
                      WHERE m."batchId" = NEW.id AND m.type = 'QUARANTINE' AND medcore_same_tx(m.xmin)) THEN
    RAISE EXCEPTION 'A quarantine needs its QUARANTINE ledger row in the same transaction'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER medicine_batches_quarantine_has_ledger AFTER UPDATE OF status ON medicine_batches
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION medcore_quarantine_has_ledger();

-- The ledger and dispense records are never edited or deleted. medcore_reject_change() is defined in
-- the initial migration.
CREATE TRIGGER stock_movements_append_only BEFORE UPDATE OR DELETE ON stock_movements
  FOR EACH ROW EXECUTE FUNCTION medcore_reject_change();
CREATE TRIGGER dispenses_append_only BEFORE UPDATE OR DELETE ON dispenses
  FOR EACH ROW EXECUTE FUNCTION medcore_reject_change();
