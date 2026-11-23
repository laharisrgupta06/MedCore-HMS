-- M-13 DRAFT. NOT APPLIED. Validated on a scratch PostgreSQL 16 database (2026-11-22, Phase 13).
-- Order: after M-12.
ALTER TYPE "PaymentMethod" ADD VALUE IF NOT EXISTS 'TPA_SETTLEMENT';

-- M-11b's payments_provider_chk requires a provider for every payment that is not cash. A TPA
-- settlement is paid outside MedCore and has no provider, so the check must treat it like cash.
-- method is compared as text: the new value cannot be used as an enum literal in this file.
ALTER TABLE payments DROP CONSTRAINT payments_provider_chk;
ALTER TABLE payments ADD CONSTRAINT payments_provider_chk
  CHECK ((method::text IN ('CASH', 'TPA_SETTLEMENT')) = (provider IS NULL));
