-- Rollback of M-11b invoice_integrity. For a database where M-11b is applied but billing has not been
-- used. Refuses if any invoice, line, series, event, request or note exists (those rows would be lost
-- or would no longer satisfy the initial schema). Restores the schema exactly as M-11a left it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM invoices) OR EXISTS (SELECT 1 FROM invoice_items)
     OR EXISTS (SELECT 1 FROM "document_number_series") OR EXISTS (SELECT 1 FROM "invoice_events")
     OR EXISTS (SELECT 1 FROM "invoice_correction_requests") OR EXISTS (SELECT 1 FROM "invoice_correction_request_notes") THEN
    RAISE EXCEPTION 'Rollback of M-11b refused: billing rows exist. Nothing was changed.';
  END IF;
END
$$;

DROP TRIGGER invoice_correction_request_notes_append_only ON "invoice_correction_request_notes";
DROP TRIGGER invoice_correction_requests_append_only ON "invoice_correction_requests";
DROP TRIGGER invoice_correction_request_notes_rules ON "invoice_correction_request_notes";
DROP TRIGGER invoice_correction_requests_rules ON "invoice_correction_requests";
DROP TRIGGER invoices_history ON invoices;
DROP TRIGGER invoice_events_append_only ON "invoice_events";
DROP TRIGGER invoice_items_totals_at_commit ON invoice_items;
DROP TRIGGER invoices_totals_at_commit ON invoices;
DROP TRIGGER invoices_rules ON invoices;
DROP TRIGGER invoice_items_rules ON invoice_items;
DROP TRIGGER document_number_series_rules ON "document_number_series";

DROP TABLE "invoice_correction_request_notes";
DROP TABLE "invoice_correction_requests";
DROP TABLE "invoice_events";

DROP FUNCTION medcore_correction_request_rules();
DROP FUNCTION medcore_invoice_history();
DROP FUNCTION medcore_invoice_totals_rules();
DROP FUNCTION medcore_invoice_rules();
DROP FUNCTION medcore_document_prefix(uuid, text, text, "DocumentType");
DROP FUNCTION medcore_invoice_item_rules();
DROP FUNCTION medcore_document_series_rules();

-- Lines
DROP INDEX "invoice_items_classificationId_idx";
DROP INDEX "invoice_items_classificationVersionId_idx";
ALTER TABLE invoice_items
  DROP CONSTRAINT "invoice_items_roomRuleId_fkey",
  DROP CONSTRAINT "invoice_items_classificationVersionId_hospitalId_fkey",
  DROP CONSTRAINT "invoice_items_classificationId_hospitalId_fkey",
  DROP CONSTRAINT "invoice_items_addedById_hospitalId_fkey",
  DROP CONSTRAINT invoice_items_arithmetic_chk,
  DROP CONSTRAINT invoice_items_rate_chk,
  DROP CONSTRAINT invoice_items_collection_chk,
  DROP CONSTRAINT invoice_items_snapshot_chk,
  DROP CONSTRAINT invoice_items_manual_by_chk,
  DROP CONSTRAINT invoice_items_description_chk;
ALTER TABLE invoice_items
  DROP COLUMN "roomCriticalCare", DROP COLUMN "roomDailyCharge", DROP COLUMN "roomRuleId",
  DROP COLUMN "taxAmount", DROP COLUMN "taxableValue", DROP COLUMN "discountShare", DROP COLUMN "grossAmount",
  DROP COLUMN "notCollectedReason", DROP COLUMN "gstCollected", DROP COLUMN "priceIncludesTax", DROP COLUMN "ratePercent",
  DROP COLUMN "treatment", DROP COLUMN "supplyType", DROP COLUMN "hsnSac", DROP COLUMN "classificationName",
  DROP COLUMN "classificationVersionId", DROP COLUMN "classificationId", DROP COLUMN "unclassified",
  DROP COLUMN "addedById", DROP COLUMN "serviceDate";
ALTER TABLE invoice_items ADD CONSTRAINT invoice_items_line_total_chk CHECK ("lineTotal" = quantity * "unitPrice");

-- Invoices
ALTER TABLE invoices DROP CONSTRAINT "invoices_seriesId_hospitalId_fkey";
DROP TABLE "document_number_series";
DROP INDEX "invoices_relatedInvoiceId_idx";
DROP INDEX "invoices_appointmentId_idx";
DROP INDEX "invoices_hospitalId_patientId_createdAt_idx";
DROP INDEX "invoices_hospitalId_financialYear_invoiceNumber_key";
DROP INDEX "invoices_numberingScope_financialYear_invoiceNumber_key";
DROP INDEX "invoices_seriesId_serial_key";
DROP INDEX "invoices_one_original_per_appointment";
DROP INDEX "invoices_one_draft_per_appointment";
DROP INDEX "invoices_appointmentId_sequence_key";
ALTER TABLE invoices
  DROP CONSTRAINT "invoices_gstRegistrationId_hospitalId_fkey",
  DROP CONSTRAINT "invoices_voidedById_hospitalId_fkey",
  DROP CONSTRAINT "invoices_discountSetById_hospitalId_fkey",
  DROP CONSTRAINT "invoices_createdById_hospitalId_fkey",
  DROP CONSTRAINT "invoices_relatedInvoiceId_hospitalId_fkey",
  DROP CONSTRAINT "invoices_patientId_hospitalId_fkey",
  DROP CONSTRAINT invoices_seller_chk,
  DROP CONSTRAINT invoices_serial_chk,
  DROP CONSTRAINT invoices_number_format_chk,
  DROP CONSTRAINT invoices_issued_chk,
  DROP CONSTRAINT invoices_void_chk,
  DROP CONSTRAINT invoices_discount_chk,
  DROP CONSTRAINT invoices_late_charges_chk,
  DROP CONSTRAINT invoices_sequence_chk,
  DROP CONSTRAINT invoices_total_chk;
ALTER TABLE invoices
  DROP COLUMN "sellerStateCode", DROP COLUMN "sellerLegalName", DROP COLUMN "sellerGstin", DROP COLUMN "registrationType",
  DROP COLUMN "gstRegistrationId", DROP COLUMN "serial", DROP COLUMN "seriesId", DROP COLUMN "numberingScope",
  DROP COLUMN "financialYear", DROP COLUMN "issueDate", DROP COLUMN "documentType", DROP COLUMN "voidReason",
  DROP COLUMN "voidedById", DROP COLUMN "voidedAt", DROP COLUMN "discountSetAt", DROP COLUMN "discountSetById",
  DROP COLUMN "discountReason", DROP COLUMN "createdById", DROP COLUMN "relatedInvoiceId", DROP COLUMN "sequence",
  DROP COLUMN "kind", DROP COLUMN "patientId";
ALTER TABLE invoices ALTER COLUMN "invoiceNumber" SET NOT NULL;
CREATE UNIQUE INDEX "invoices_hospitalId_invoiceNumber_key" ON "invoices"("hospitalId", "invoiceNumber");
CREATE UNIQUE INDEX "invoices_appointmentId_hospitalId_key" ON "invoices"("appointmentId", "hospitalId");
CREATE UNIQUE INDEX "invoices_appointmentId_key" ON "invoices"("appointmentId");
ALTER TABLE invoices
  ADD CONSTRAINT invoices_discount_chk CHECK ("discountAmount" <= subtotal + "taxAmount"),
  ADD CONSTRAINT invoices_total_chk CHECK (total = subtotal + "taxAmount" - "discountAmount");

DROP FUNCTION medcore_user_role_in(uuid, uuid, text[]);
DROP FUNCTION medcore_financial_year(date);
DROP FUNCTION medcore_local_date(uuid);
DROP FUNCTION medcore_billing_require_read_committed();

DROP TYPE "CorrectionRequestKind";
DROP TYPE "InvoiceEventKind";
DROP TYPE "TaxNotCollectedReason";
DROP TYPE "DocumentType";
DROP TYPE "InvoiceKind";
