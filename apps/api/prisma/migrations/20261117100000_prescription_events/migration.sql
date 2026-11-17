-- M-10 (Phase 7, PHARM-006, DEC-044): append-only prescription history and the status workflow in
-- the database. Adds one enum, one table, triggers and evidence-based history rows; changes no
-- existing row. The file runs as one implicit transaction: if the consistency check below stops it,
-- nothing is created or written.

CREATE TYPE "PrescriptionEventKind" AS ENUM (
  'ISSUED', 'VERIFIED', 'DISPENSED', 'HANDED_OVER', 'CANCELLED', 'BASELINE');

CREATE TABLE "prescription_events" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "prescriptionId" UUID NOT NULL,
    "kind" "PrescriptionEventKind" NOT NULL,
    -- The prescription's status after this event.
    "status" "PrescriptionStatus" NOT NULL,
    "actorId" UUID,
    "reason" TEXT,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prescription_events_pkey" PRIMARY KEY ("id"),
    -- Every real event names who did it; only BASELINE (start of recorded history) has no actor.
    CONSTRAINT "prescription_events_actor_chk" CHECK (("kind" = 'BASELINE') = ("actorId" IS NULL)),
    CONSTRAINT "prescription_events_reason_chk" CHECK (
      "kind" NOT IN ('CANCELLED', 'BASELINE') OR coalesce(length(btrim("reason")), 0) > 0),
    CONSTRAINT "prescription_events_status_chk" CHECK (
      ("kind" = 'ISSUED' AND "status" = 'ISSUED')
      OR ("kind" = 'VERIFIED' AND "status" = 'ISSUED')
      OR ("kind" = 'DISPENSED' AND "status" IN ('PARTIALLY_DISPENSED', 'READY_FOR_PICKUP'))
      OR ("kind" = 'HANDED_OVER' AND "status" = 'DISPENSED')
      OR ("kind" = 'CANCELLED' AND "status" = 'CANCELLED')
      OR ("kind" = 'BASELINE' AND "status" IN ('PARTIALLY_DISPENSED', 'READY_FOR_PICKUP', 'DISPENSED')))
);
CREATE UNIQUE INDEX "prescription_events_id_hospitalId_key" ON "prescription_events"("id", "hospitalId");
CREATE INDEX "prescription_events_prescriptionId_occurredAt_idx" ON "prescription_events"("prescriptionId", "occurredAt");
ALTER TABLE "prescription_events" ADD CONSTRAINT "prescription_events_hospitalId_fkey"
  FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prescription_events" ADD CONSTRAINT "prescription_events_prescriptionId_hospitalId_fkey"
  FOREIGN KEY ("prescriptionId", "hospitalId") REFERENCES "prescriptions"("id", "hospitalId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "prescription_events" ADD CONSTRAINT "prescription_events_actorId_hospitalId_fkey"
  FOREIGN KEY ("actorId", "hospitalId") REFERENCES "users"("id", "hospitalId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TRIGGER prescription_events_append_only BEFORE UPDATE OR DELETE ON prescription_events
  FOR EACH ROW EXECUTE FUNCTION medcore_reject_change();

-- ---- Evidence-based history for existing prescriptions (owner instruction 2026-11-17 13:38) ----
-- Stop (and change nothing) when stored facts contradict the allowed workflow.
DO $$
DECLARE
  bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM prescriptions p
   WHERE (p."verifiedAt" IS NOT NULL AND p."verifiedAt" < p."issuedAt")
      OR (p."cancelledAt" IS NOT NULL AND p."cancelledAt" < p."issuedAt")
      OR (p.status = 'CANCELLED' AND p."verifiedAt" IS NOT NULL AND p."verifiedAt" > p."cancelledAt")
      OR (p."verifiedAt" IS NULL) <> (p."verifiedById" IS NULL)
      OR (p.status IN ('PARTIALLY_DISPENSED', 'READY_FOR_PICKUP', 'DISPENSED') AND p."verifiedAt" IS NULL)
      OR EXISTS (SELECT 1 FROM prescription_items i JOIN dispenses d ON d."prescriptionItemId" = i.id
                  WHERE i."prescriptionId" = p.id
                    AND (p.status IN ('ISSUED', 'CANCELLED')
                         OR d."dispensedAt" < coalesce(p."verifiedAt", p."issuedAt")));
  IF bad > 0 THEN
    RAISE EXCEPTION 'M-10 stopped: % prescription(s) have stored facts that contradict the workflow; nothing was changed', bad
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
END;
$$;

-- ISSUED for every prescription, by the prescribing doctor at the issue time.
INSERT INTO prescription_events (id, "hospitalId", "prescriptionId", kind, status, "actorId", "occurredAt")
SELECT gen_random_uuid(), p."hospitalId", p.id, 'ISSUED', 'ISSUED', d."userId", p."issuedAt"
  FROM prescriptions p
  JOIN medical_records r ON r.id = p."medicalRecordId"
  JOIN appointments a ON a.id = r."appointmentId"
  JOIN doctors d ON d.id = a."doctorId";
-- VERIFIED only where a verification is stored.
INSERT INTO prescription_events (id, "hospitalId", "prescriptionId", kind, status, "actorId", "occurredAt")
SELECT gen_random_uuid(), p."hospitalId", p.id, 'VERIFIED', 'ISSUED', p."verifiedById", p."verifiedAt"
  FROM prescriptions p WHERE p."verifiedAt" IS NOT NULL;
-- CANCELLED only where the cancellation is stored (M-05 guarantees who, when and why).
INSERT INTO prescription_events (id, "hospitalId", "prescriptionId", kind, status, "actorId", "reason", "occurredAt")
SELECT gen_random_uuid(), p."hospitalId", p.id, 'CANCELLED', 'CANCELLED', p."cancelledById", p."cancellationReason", p."cancelledAt"
  FROM prescriptions p WHERE p.status = 'CANCELLED';
-- BASELINE only where stored facts cannot explain the current status (dispensing steps have no
-- recorded grouping, so no DISPENSED or HANDED_OVER event is ever invented).
INSERT INTO prescription_events (id, "hospitalId", "prescriptionId", kind, status, "reason", "occurredAt")
SELECT gen_random_uuid(), p."hospitalId", p.id, 'BASELINE', p.status,
       'History recording began here; earlier dispensing steps were not recorded', CURRENT_TIMESTAMP
  FROM prescriptions p WHERE p.status IN ('PARTIALLY_DISPENSED', 'READY_FOR_PICKUP', 'DISPENSED');

-- ---- The status workflow -------------------------------------------------------------------------
CREATE FUNCTION medcore_prescription_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  incomplete boolean;
  dispensed boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'ISSUED' OR NEW."verifiedAt" IS NOT NULL OR NEW."verifiedById" IS NOT NULL
       OR NEW."cancelledAt" IS NOT NULL OR NEW."pdfFileId" IS NOT NULL THEN
      RAISE EXCEPTION 'A new prescription starts ISSUED, unverified, without a PDF'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NEW;
  END IF;
  -- Never edited after issue.
  IF NEW."hospitalId" <> OLD."hospitalId" OR NEW."medicalRecordId" <> OLD."medicalRecordId"
     OR NEW.notes IS DISTINCT FROM OLD.notes OR NEW."issuedAt" <> OLD."issuedAt"
     OR NEW."allergyOverrideReason" IS DISTINCT FROM OLD."allergyOverrideReason" THEN
    RAISE EXCEPTION 'A prescription is never edited after issue' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  -- The PDF is attached once.
  IF OLD."pdfFileId" IS NOT NULL AND NEW."pdfFileId" IS DISTINCT FROM OLD."pdfFileId" THEN
    RAISE EXCEPTION 'The prescription PDF is attached once' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  -- Verification is recorded once, together, while ISSUED.
  IF OLD."verifiedAt" IS NOT NULL THEN
    IF NEW."verifiedAt" IS DISTINCT FROM OLD."verifiedAt" OR NEW."verifiedById" IS DISTINCT FROM OLD."verifiedById" THEN
      RAISE EXCEPTION 'A verification cannot change' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  ELSIF NEW."verifiedAt" IS NOT NULL OR NEW."verifiedById" IS NOT NULL THEN
    IF NEW."verifiedAt" IS NULL OR NEW."verifiedById" IS NULL OR OLD.status <> 'ISSUED' THEN
      RAISE EXCEPTION 'Verification needs who and when, while the prescription is ISSUED'
        USING ERRCODE = 'integrity_constraint_violation';
    END IF;
  END IF;
  -- Cancellation fields only arrive with the move to CANCELLED.
  IF NOT (OLD.status <> 'CANCELLED' AND NEW.status = 'CANCELLED')
     AND (NEW."cancelledAt" IS DISTINCT FROM OLD."cancelledAt"
          OR NEW."cancelledById" IS DISTINCT FROM OLD."cancelledById"
          OR NEW."cancellationReason" IS DISTINCT FROM OLD."cancellationReason") THEN
    RAISE EXCEPTION 'Cancellation details are recorded only when cancelling'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;
  -- Allowed moves.
  IF NOT ((OLD.status = 'ISSUED' AND NEW.status IN ('PARTIALLY_DISPENSED', 'READY_FOR_PICKUP', 'CANCELLED'))
          OR (OLD.status = 'PARTIALLY_DISPENSED' AND NEW.status = 'READY_FOR_PICKUP')
          OR (OLD.status = 'READY_FOR_PICKUP' AND NEW.status = 'DISPENSED')) THEN
    RAISE EXCEPTION 'A prescription cannot move from % to %', OLD.status, NEW.status
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT EXISTS (SELECT 1 FROM prescription_items i JOIN dispenses d ON d."prescriptionItemId" = i.id
                  WHERE i."prescriptionId" = NEW.id) INTO dispensed;
  SELECT EXISTS (SELECT 1 FROM prescription_items i
                  WHERE i."prescriptionId" = NEW.id
                    AND i.quantity > (SELECT coalesce(sum(d.quantity), 0) FROM dispenses d
                                       WHERE d."prescriptionItemId" = i.id)) INTO incomplete;
  IF NEW.status = 'CANCELLED' AND dispensed THEN
    RAISE EXCEPTION 'A prescription with dispensed items cannot be cancelled'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status IN ('PARTIALLY_DISPENSED', 'READY_FOR_PICKUP')
     AND (NEW."verifiedAt" IS NULL OR NOT dispensed) THEN
    RAISE EXCEPTION 'Dispensing needs a verified prescription and at least one dispense'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status = 'PARTIALLY_DISPENSED' AND NOT incomplete THEN
    RAISE EXCEPTION 'Every item is complete: the prescription is ready, not partly dispensed'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.status = 'READY_FOR_PICKUP' AND incomplete THEN
    RAISE EXCEPTION 'Ready for collection needs every item fully dispensed'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prescriptions_rules BEFORE INSERT OR UPDATE ON prescriptions
  FOR EACH ROW EXECUTE FUNCTION medcore_prescription_rules();

-- Every new prescription, status change and first verification has its event in the same
-- transaction (checked at commit, so the event may be written after the change).
CREATE FUNCTION medcore_prescription_has_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NOT EXISTS (SELECT 1 FROM prescription_events e WHERE e."prescriptionId" = NEW.id
                     AND e.kind = 'ISSUED' AND medcore_same_tx(e.xmin)) THEN
      RAISE EXCEPTION 'A new prescription needs its ISSUED event' USING ERRCODE = 'integrity_constraint_violation';
    END IF;
    RETURN NULL;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status
     AND NOT EXISTS (SELECT 1 FROM prescription_events e WHERE e."prescriptionId" = NEW.id
                       AND e.status = NEW.status AND e.kind <> 'BASELINE' AND medcore_same_tx(e.xmin)) THEN
    RAISE EXCEPTION 'A prescription status change needs its history event' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF OLD."verifiedAt" IS NULL AND NEW."verifiedAt" IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM prescription_events e WHERE e."prescriptionId" = NEW.id
                       AND e.kind = 'VERIFIED' AND medcore_same_tx(e.xmin)) THEN
    RAISE EXCEPTION 'A verification needs its VERIFIED event' USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER prescriptions_have_events AFTER INSERT OR UPDATE ON prescriptions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION medcore_prescription_has_event();

-- A dispense is written only for a verified prescription that is waiting. The row lock serialises
-- it with a concurrent cancel, which in turn refuses once any dispense exists.
CREATE FUNCTION medcore_dispense_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p record;
BEGIN
  SELECT pr.status, pr."verifiedAt" INTO p
    FROM prescription_items i JOIN prescriptions pr ON pr.id = i."prescriptionId"
   WHERE i.id = NEW."prescriptionItemId" AND pr."hospitalId" = NEW."hospitalId"
     FOR UPDATE OF pr;
  IF NOT FOUND OR p.status NOT IN ('ISSUED', 'PARTIALLY_DISPENSED') OR p."verifiedAt" IS NULL THEN
    RAISE EXCEPTION 'Dispensing needs a verified prescription that is waiting'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  -- Never more than prescribed, counted under the prescription row lock taken above.
  IF NEW.quantity + (SELECT coalesce(sum(d.quantity), 0) FROM dispenses d
                      WHERE d."prescriptionItemId" = NEW."prescriptionItemId")
     > (SELECT i.quantity FROM prescription_items i WHERE i.id = NEW."prescriptionItemId") THEN
    RAISE EXCEPTION 'More than the prescribed quantity cannot be dispensed'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER dispenses_rules BEFORE INSERT ON dispenses
  FOR EACH ROW EXECUTE FUNCTION medcore_dispense_rules();

-- An event is accepted only together with the change it records: the prescription was created or
-- changed in this transaction and now has the event's status. BASELINE is written only by this
-- migration (above, before this trigger exists). Single-occurrence events appear at most once.
CREATE FUNCTION medcore_prescription_event_rules() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  p record;
BEGIN
  IF NEW.kind = 'BASELINE' THEN
    RAISE EXCEPTION 'BASELINE events are written only by migration M-10'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  SELECT pr.xmin AS x, pr.status, pr."verifiedAt", pr."verifiedById" INTO p
    FROM prescriptions pr WHERE pr.id = NEW."prescriptionId" AND pr."hospitalId" = NEW."hospitalId";
  IF NOT FOUND OR NOT medcore_same_tx(p.x) OR p.status <> NEW.status THEN
    RAISE EXCEPTION 'A prescription event must be written with the change it records'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF NEW.kind = 'VERIFIED' AND (p."verifiedAt" IS NULL OR p."verifiedById" IS DISTINCT FROM NEW."actorId") THEN
    RAISE EXCEPTION 'A VERIFIED event must match the recorded verification'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER prescription_events_rules BEFORE INSERT ON prescription_events
  FOR EACH ROW EXECUTE FUNCTION medcore_prescription_event_rules();
CREATE UNIQUE INDEX "prescription_events_once" ON "prescription_events"("prescriptionId", "kind")
  WHERE "kind" IN ('ISSUED', 'VERIFIED', 'HANDED_OVER', 'CANCELLED', 'BASELINE');

-- Every dispense comes with its prescription moving to (or staying in) a dispensing status in the
-- same transaction, so a dispense can never sit on an ISSUED prescription (checked at commit).
CREATE FUNCTION medcore_dispense_has_status() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM prescription_items i JOIN prescriptions p ON p.id = i."prescriptionId"
                  WHERE i.id = NEW."prescriptionItemId"
                    AND p.status IN ('PARTIALLY_DISPENSED', 'READY_FOR_PICKUP')
                    AND medcore_same_tx(p.xmin)) THEN
    RAISE EXCEPTION 'A dispense needs its prescription status update in the same transaction'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER dispenses_have_status AFTER INSERT ON dispenses
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION medcore_dispense_has_status();
