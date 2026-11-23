-- M-13 ROLLBACK DRAFT. NOT APPLIED.
-- PostgreSQL cannot remove an enum value. Any TPA_SETTLEMENT rows must be reviewed by hand first;
-- the original provider check is then restored (it fails while such rows exist, by design).
ALTER TABLE payments DROP CONSTRAINT payments_provider_chk;
ALTER TABLE payments ADD CONSTRAINT payments_provider_chk CHECK ((method = 'CASH'::"PaymentMethod") = (provider IS NULL));
