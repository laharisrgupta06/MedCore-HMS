-- MedCore HMS: database-level guarantees that Prisma's schema language cannot express.
-- Appended to the initial migration (see docs/database-schema.md, "Migration workflow").
-- Column names are camelCase (Prisma default), so they are double-quoted.

-- Extensions --------------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- encryption at rest for *Enc columns (PRD section 10)
CREATE EXTENSION IF NOT EXISTS btree_gist;  -- equality + range in one exclusion constraint

-- Users -------------------------------------------------------------------------------------
-- Only SUPER_ADMIN exists outside a hospital (PRD section 03, multi-tenancy).
ALTER TABLE users ADD CONSTRAINT users_hospital_scope_chk
  CHECK ((role = 'SUPER_ADMIN') = ("hospitalId" IS NULL));
-- Email uniqueness regardless of letter case.
CREATE UNIQUE INDEX users_email_lower_key ON users (lower(email));

-- Scheduling --------------------------------------------------------------------------------
ALTER TABLE doctor_schedules
  ADD CONSTRAINT doctor_schedules_time_chk CHECK ("endTime" > "startTime"),
  ADD CONSTRAINT doctor_schedules_slot_chk CHECK ("slotMinutes" BETWEEN 5 AND 240),
  ADD CONSTRAINT doctor_schedules_validity_chk CHECK ("validTo" IS NULL OR "validTo" >= "validFrom");

ALTER TABLE schedule_exceptions
  ADD CONSTRAINT schedule_exceptions_both_times_chk CHECK (("startTime" IS NULL) = ("endTime" IS NULL)),
  ADD CONSTRAINT schedule_exceptions_time_chk CHECK ("endTime" IS NULL OR "endTime" > "startTime");

-- Appointments: no double booking (PRD 7.2), enforced by the database itself --------------
ALTER TABLE appointments ADD CONSTRAINT appointments_time_chk CHECK ("endAt" > "scheduledAt");

-- A doctor cannot have overlapping active appointments. EMERGENCY bookings bypass slot
-- availability (PRD 7.2), so they are excluded from this rule.
ALTER TABLE appointments ADD CONSTRAINT appointments_doctor_no_overlap
  EXCLUDE USING gist ("doctorId" WITH =, tstzrange("scheduledAt", "endAt", '[)') WITH &&)
  WHERE (status NOT IN ('CANCELLED', 'NO_SHOW') AND type <> 'EMERGENCY' AND "deletedAt" IS NULL);

-- A patient cannot have two appointments at the same time across any doctor (PRD 7.2).
-- Applies to emergencies too (roadmap contradiction C5, approved default).
ALTER TABLE appointments ADD CONSTRAINT appointments_patient_no_overlap
  EXCLUDE USING gist ("patientId" WITH =, tstzrange("scheduledAt", "endAt", '[)') WITH &&)
  WHERE (status NOT IN ('CANCELLED', 'NO_SHOW') AND "deletedAt" IS NULL);

-- EMR: plausible vitals ---------------------------------------------------------------------
ALTER TABLE vitals
  ADD CONSTRAINT vitals_bp_chk CHECK ("systolicBp" IS NULL OR "systolicBp" BETWEEN 40 AND 300),
  ADD CONSTRAINT vitals_bp_dia_chk CHECK ("diastolicBp" IS NULL OR "diastolicBp" BETWEEN 20 AND 200),
  ADD CONSTRAINT vitals_pulse_chk CHECK (pulse IS NULL OR pulse BETWEEN 20 AND 300),
  ADD CONSTRAINT vitals_temp_chk CHECK ("temperatureC" IS NULL OR "temperatureC" BETWEEN 25 AND 45),
  ADD CONSTRAINT vitals_spo2_chk CHECK (spo2 IS NULL OR spo2 BETWEEN 0 AND 100),
  ADD CONSTRAINT vitals_height_chk CHECK ("heightCm" IS NULL OR "heightCm" BETWEEN 20 AND 272),
  ADD CONSTRAINT vitals_weight_chk CHECK ("weightKg" IS NULL OR "weightKg" BETWEEN 0.3 AND 650);

-- Files: 20 MB limit (PRD 7.3) ---------------------------------------------------------------
ALTER TABLE file_attachments ADD CONSTRAINT file_attachments_size_chk
  CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 20971520);

-- Pharmacy ----------------------------------------------------------------------------------
ALTER TABLE medicines ADD CONSTRAINT medicines_reorder_chk CHECK ("reorderLevel" >= 0);
ALTER TABLE medicine_batches
  ADD CONSTRAINT medicine_batches_quantity_chk CHECK (quantity >= 0),
  ADD CONSTRAINT medicine_batches_dates_chk CHECK ("expiresOn" > "manufacturedOn"),
  ADD CONSTRAINT medicine_batches_money_chk CHECK ("unitCost" >= 0 AND mrp >= 0);
ALTER TABLE prescription_items ADD CONSTRAINT prescription_items_amounts_chk
  CHECK ("durationDays" > 0 AND quantity > 0);
ALTER TABLE dispenses ADD CONSTRAINT dispenses_quantity_chk CHECK (quantity > 0);
ALTER TABLE stock_movements ADD CONSTRAINT stock_movements_nonzero_chk CHECK (quantity <> 0);

-- Laboratory --------------------------------------------------------------------------------
ALTER TABLE lab_test_ranges
  ADD CONSTRAINT lab_test_ranges_bounds_chk CHECK (low <= high),
  ADD CONSTRAINT lab_test_ranges_age_chk CHECK (
    ("ageMinYears" IS NULL OR "ageMinYears" >= 0)
    AND ("ageMaxYears" IS NULL OR "ageMinYears" IS NULL OR "ageMaxYears" >= "ageMinYears"));
ALTER TABLE lab_tests ADD CONSTRAINT lab_tests_price_chk CHECK (price >= 0);
ALTER TABLE lab_results ADD CONSTRAINT lab_results_value_chk
  CHECK ("valueNumeric" IS NOT NULL OR "valueText" IS NOT NULL);

-- Billing integrity (PRD 7.7 and mandatory test "invoice total matches line items") -------
ALTER TABLE invoices
  ADD CONSTRAINT invoices_amounts_chk CHECK (subtotal >= 0 AND "taxAmount" >= 0 AND "discountAmount" >= 0),
  ADD CONSTRAINT invoices_discount_chk CHECK ("discountAmount" <= subtotal + "taxAmount"),
  ADD CONSTRAINT invoices_total_chk CHECK (total = subtotal + "taxAmount" - "discountAmount");
ALTER TABLE invoice_items
  ADD CONSTRAINT invoice_items_amounts_chk CHECK (quantity > 0 AND "unitPrice" >= 0),
  ADD CONSTRAINT invoice_items_line_total_chk CHECK ("lineTotal" = quantity * "unitPrice"),
  ADD CONSTRAINT invoice_items_lab_link_chk CHECK ((kind = 'LAB') = ("labOrderItemId" IS NOT NULL)),
  ADD CONSTRAINT invoice_items_pharmacy_link_chk CHECK ((kind = 'PHARMACY') = ("dispenseId" IS NOT NULL)),
  ADD CONSTRAINT invoice_items_room_link_chk CHECK ((kind = 'ROOM') = ("roomId" IS NOT NULL));
ALTER TABLE payments
  ADD CONSTRAINT payments_amount_chk CHECK (amount > 0),
  ADD CONSTRAINT payments_provider_chk CHECK ((method = 'CASH') = (provider IS NULL));
ALTER TABLE insurance_claims ADD CONSTRAINT insurance_claims_amount_chk
  CHECK ("claimAmount" > 0 AND ("settledAmount" IS NULL OR "settledAmount" >= 0));

-- Append-only clinical and audit data (PRD 7.3, section 05 hint, section 10) ---------------
CREATE FUNCTION medcore_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not permitted: this table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

-- Never updated or deleted.
CREATE TRIGGER record_entries_append_only BEFORE UPDATE OR DELETE ON record_entries
  FOR EACH ROW EXECUTE FUNCTION medcore_reject_change();
CREATE TRIGGER administration_notes_append_only BEFORE UPDATE OR DELETE ON administration_notes
  FOR EACH ROW EXECUTE FUNCTION medcore_reject_change();
CREATE TRIGGER diagnoses_append_only BEFORE UPDATE OR DELETE ON diagnoses
  FOR EACH ROW EXECUTE FUNCTION medcore_reject_change();
CREATE TRIGGER vitals_append_only BEFORE UPDATE OR DELETE ON vitals
  FOR EACH ROW EXECUTE FUNCTION medcore_reject_change();
CREATE TRIGGER audit_logs_append_only BEFORE UPDATE OR DELETE ON audit_logs
  FOR EACH ROW EXECUTE FUNCTION medcore_reject_change();
-- Never deleted (status and closing fields may change).
CREATE TRIGGER medical_records_no_delete BEFORE DELETE ON medical_records
  FOR EACH ROW EXECUTE FUNCTION medcore_reject_change();
CREATE TRIGGER lab_results_no_delete BEFORE DELETE ON lab_results
  FOR EACH ROW EXECUTE FUNCTION medcore_reject_change();
