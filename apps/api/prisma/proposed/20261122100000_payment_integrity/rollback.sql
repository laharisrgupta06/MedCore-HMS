-- M-12 ROLLBACK DRAFT. NOT APPLIED. Run only if M-12 was applied and must be undone.
DROP TRIGGER IF EXISTS payments_invoice_consistency ON payments;
DROP TRIGGER IF EXISTS payments_invoice_status ON payments;
DROP FUNCTION IF EXISTS medcore_payment_consistency();
DROP FUNCTION IF EXISTS medcore_payment_transition();
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_reversal_complete;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS "payments_reversedById_hospitalId_fkey";
ALTER TABLE payments DROP COLUMN IF EXISTS "reversalReason", DROP COLUMN IF EXISTS "reversedById", DROP COLUMN IF EXISTS "reversedAt";
-- Restore medcore_invoice_rules by re-running its CREATE FUNCTION from 20261119220000_invoice_integrity
-- as CREATE OR REPLACE. The REVERSED enum value cannot be removed; any REVERSED rows must be handled first.
