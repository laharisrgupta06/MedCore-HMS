-- M-05 (Phase 5, DEC-040 D3/D4): additive only. No existing row or column is changed.
-- Prescriptions are never edited after issue; a cancellation records who, when and why, and
-- an acknowledged allergy conflict records the doctor's reason.

ALTER TABLE "prescriptions"
  ADD COLUMN "cancelledAt" TIMESTAMPTZ(3),
  ADD COLUMN "cancelledById" UUID,
  ADD COLUMN "cancellationReason" TEXT,
  ADD COLUMN "allergyOverrideReason" TEXT;

-- Same-hospital user, like every other actor column (composite tenant key, DEC-018).
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_cancelledById_hospitalId_fkey"
  FOREIGN KEY ("cancelledById", "hospitalId") REFERENCES "users"("id", "hospitalId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- CANCELLED if and only if who, when and a non-blank reason are recorded.
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_cancel_chk" CHECK (
  ("status" = 'CANCELLED') = (
    "cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL
    AND coalesce(length(btrim("cancellationReason")), 0) > 0));

-- An override reason, when present, is not blank.
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_allergy_override_chk" CHECK (
  "allergyOverrideReason" IS NULL OR length(btrim("allergyOverrideReason")) > 0);
