-- M-07 (Phase 7, PHARM-003, DEC-042): additive only. No existing row, column, constraint or index is
-- changed or dropped. Existing medicines start with NULL and are evaluated at their next stock change
-- or the first nightly expiry run, whichever comes first.

-- Set when available stock first falls strictly below "reorderLevel"; cleared when it is back at or
-- above it. The low-stock alert is raised only when this changes from NULL, so once per crossing.
ALTER TABLE "medicines" ADD COLUMN "lowStockSince" TIMESTAMPTZ(3);
