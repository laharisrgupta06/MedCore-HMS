-- M-06 (Phase 6, DEC-040 D7/D8): additive only. No existing row, column, constraint or index is
-- changed or dropped.

-- An ordering doctor may cancel an order before the sample is collected.
ALTER TYPE "LabOrderStatus" ADD VALUE 'CANCELLED';

ALTER TABLE "lab_orders"
  ADD COLUMN "clinicalNotes" TEXT,
  ADD COLUMN "cancelledAt" TIMESTAMPTZ(3),
  ADD COLUMN "cancelledById" UUID,
  ADD COLUMN "cancellationReason" TEXT,
  ADD COLUMN "rejectedAt" TIMESTAMPTZ(3),
  ADD COLUMN "rejectedById" UUID;

-- Same-hospital users (composite tenant keys, DEC-018).
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_cancelledById_hospitalId_fkey"
  FOREIGN KEY ("cancelledById", "hospitalId") REFERENCES "users"("id", "hospitalId")
  ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_rejectedById_hospitalId_fkey"
  FOREIGN KEY ("rejectedById", "hospitalId") REFERENCES "users"("id", "hospitalId")
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- CANCELLED exactly when who, when and a non-blank reason are recorded. Compared as text: a new
-- enum value cannot be used in the transaction that adds it.
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_cancel_chk" CHECK (
  ("status"::text = 'CANCELLED') = (
    "cancelledAt" IS NOT NULL AND "cancelledById" IS NOT NULL
    AND coalesce(length(btrim("cancellationReason")), 0) > 0));

-- A rejection records who and when together with its reason.
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_rejection_chk" CHECK (
  ("rejectedAt" IS NULL) = ("rejectedById" IS NULL)
  AND ("rejectedAt" IS NULL OR coalesce(length(btrim("rejectionReason")), 0) > 0));

-- Reference snapshot on each result (DEC-040 D8).
ALTER TABLE "lab_results"
  ADD COLUMN "unit" TEXT,
  ADD COLUMN "referenceLow" DECIMAL(12,4),
  ADD COLUMN "referenceHigh" DECIMAL(12,4);

ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_reference_chk" CHECK (
  ("referenceLow" IS NULL) = ("referenceHigh" IS NULL)
  AND ("referenceLow" IS NULL OR "referenceLow" <= "referenceHigh"));
