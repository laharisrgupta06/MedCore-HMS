-- M-08 (Phase 7, PHARM-005, DEC-042): additive only; one new table, nothing existing is changed.

-- The stored result of one nightly expiry run: one row per hospital and hospital-local day.
-- "items" is a snapshot (batch, medicine, batch number, expiry, quantity, kind) shown as it was;
-- it is never used to look up rows, so it cannot lead to another hospital's data.
CREATE TABLE "expiry_reports" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "runDate" DATE NOT NULL,
    "items" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expiry_reports_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "expiry_reports_items_chk" CHECK (jsonb_typeof("items") = 'array')
);

-- One report per hospital per day: a second or concurrent run for the same day fails and rolls back.
CREATE UNIQUE INDEX "expiry_reports_hospitalId_runDate_key" ON "expiry_reports"("hospitalId", "runDate");
-- Composite tenant key, as on every hospital-owned table (DEC-018).
CREATE UNIQUE INDEX "expiry_reports_id_hospitalId_key" ON "expiry_reports"("id", "hospitalId");

ALTER TABLE "expiry_reports" ADD CONSTRAINT "expiry_reports_hospitalId_fkey"
  FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
