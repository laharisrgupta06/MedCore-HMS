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

-- Hospitals ---------------------------------------------------------------------------------
ALTER TABLE hospitals ADD CONSTRAINT hospitals_tax_rate_chk CHECK ("taxRatePercent" BETWEEN 0 AND 100);
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

-- Same-hospital guarantees for relations Prisma models with a single column --------------
-- (all other tenant relations are composite foreign keys in schema.prisma).
-- These four objects are ALSO declared in schema.prisma with the same names (map: "...") so
-- Prisma Migrate does not drop them (DEC-031). Keep both in sync; sql-drift.spec.ts checks it.
-- A hospital's address must belong to that hospital.
ALTER TABLE hospitals ADD CONSTRAINT hospitals_address_same_tenant_fkey
  FOREIGN KEY ("addressId", id) REFERENCES addresses (id, "hospitalId") ON DELETE RESTRICT;
-- A hospital notification goes to a user of that hospital (checked when hospitalId is set).
ALTER TABLE notifications ADD CONSTRAINT notifications_recipient_same_tenant_fkey
  FOREIGN KEY ("recipientId", "hospitalId") REFERENCES users (id, "hospitalId") ON DELETE RESTRICT;
ALTER TABLE notifications ADD CONSTRAINT notifications_id_hospital_key UNIQUE (id, "hospitalId");
ALTER TABLE notification_deliveries ADD CONSTRAINT notification_deliveries_same_tenant_fkey
  FOREIGN KEY ("notificationId", "hospitalId") REFERENCES notifications (id, "hospitalId") ON DELETE CASCADE;

-- Role and profile consistency for all nine roles -----------------------------------------
-- SUPER_ADMIN: no profile. DOCTOR: one doctors row. PATIENT: one patients row.
-- HOSPITAL_ADMIN, NURSE, RECEPTIONIST, LAB_TECHNICIAN, PHARMACIST, ACCOUNTANT: one staff_profiles row.
-- Only a LAB_TECHNICIAN may be a senior lab technician. Checked at COMMIT (deferred), so a user
-- and their profile are created in one transaction.
CREATE FUNCTION medcore_check_user_profile(p_user uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  r text; n_doctor int; n_patient int; n_staff int; senior boolean;
BEGIN
  SELECT role::text INTO r FROM users WHERE id = p_user;
  IF NOT FOUND THEN RETURN; END IF;
  SELECT count(*) INTO n_doctor FROM doctors WHERE "userId" = p_user;
  SELECT count(*) INTO n_patient FROM patients WHERE "userId" = p_user;
  SELECT count(*), coalesce(bool_or("isSeniorLabTechnician"), false)
    INTO n_staff, senior FROM staff_profiles WHERE "userId" = p_user;

  IF r = 'SUPER_ADMIN' THEN
    IF n_doctor + n_patient + n_staff > 0 THEN
      RAISE EXCEPTION 'User %: a SUPER_ADMIN must not have a doctor, patient or staff profile', p_user
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF r = 'DOCTOR' THEN
    IF NOT (n_doctor = 1 AND n_patient = 0 AND n_staff = 0) THEN
      RAISE EXCEPTION 'User %: a DOCTOR must have exactly one doctor profile and no other profile', p_user
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF r = 'PATIENT' THEN
    IF NOT (n_patient = 1 AND n_doctor = 0 AND n_staff = 0) THEN
      RAISE EXCEPTION 'User %: a PATIENT must have exactly one patient profile and no other profile', p_user
        USING ERRCODE = 'check_violation';
    END IF;
  ELSIF r IN ('HOSPITAL_ADMIN', 'NURSE', 'RECEPTIONIST', 'LAB_TECHNICIAN', 'PHARMACIST', 'ACCOUNTANT') THEN
    IF NOT (n_staff = 1 AND n_doctor = 0 AND n_patient = 0) THEN
      RAISE EXCEPTION 'User %: role % requires exactly one staff profile and no other profile', p_user, r
        USING ERRCODE = 'check_violation';
    END IF;
  ELSE
    RAISE EXCEPTION 'User %: role % has no profile rule', p_user, r USING ERRCODE = 'check_violation';
  END IF;

  IF senior AND r <> 'LAB_TECHNICIAN' THEN
    RAISE EXCEPTION 'User %: only a LAB_TECHNICIAN can be a senior lab technician', p_user
      USING ERRCODE = 'check_violation';
  END IF;
END;
$$;

CREATE FUNCTION medcore_user_profile_trigger() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'users' THEN
    PERFORM medcore_check_user_profile(NEW.id);
  ELSIF TG_OP = 'DELETE' THEN
    PERFORM medcore_check_user_profile(OLD."userId");
  ELSE
    PERFORM medcore_check_user_profile(NEW."userId");
    IF TG_OP = 'UPDATE' AND OLD."userId" IS DISTINCT FROM NEW."userId" THEN
      PERFORM medcore_check_user_profile(OLD."userId");
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER users_role_profile_chk AFTER INSERT OR UPDATE OF role ON users
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION medcore_user_profile_trigger();
CREATE CONSTRAINT TRIGGER doctors_role_profile_chk AFTER INSERT OR UPDATE OR DELETE ON doctors
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION medcore_user_profile_trigger();
CREATE CONSTRAINT TRIGGER patients_role_profile_chk AFTER INSERT OR UPDATE OR DELETE ON patients
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION medcore_user_profile_trigger();
CREATE CONSTRAINT TRIGGER staff_profiles_role_profile_chk AFTER INSERT OR UPDATE OR DELETE ON staff_profiles
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION medcore_user_profile_trigger();

-- Clinical corrections: originals are kept forever ----------------------------------------
-- A correction is a NEW row that points at the row it corrects and states why. Who and when
-- come from the new row's author and timestamp columns. The corrected row is never changed.

-- Every correction states a reason.
ALTER TABLE record_entries ADD CONSTRAINT record_entries_amendment_chk CHECK (
  "amendsEntryId" IS NULL OR (kind = 'ADDENDUM' AND coalesce(length(btrim("correctionReason")), 0) > 0));
ALTER TABLE vitals ADD CONSTRAINT vitals_correction_reason_chk CHECK (
  "supersedesId" IS NULL OR coalesce(length(btrim("correctionReason")), 0) > 0);
ALTER TABLE diagnoses ADD CONSTRAINT diagnoses_correction_reason_chk CHECK (
  "supersedesId" IS NULL OR coalesce(length(btrim("correctionReason")), 0) > 0);
ALTER TABLE administration_notes ADD CONSTRAINT administration_notes_correction_reason_chk CHECK (
  "supersedesId" IS NULL OR coalesce(length(btrim("correctionReason")), 0) > 0);
ALTER TABLE allergies ADD CONSTRAINT allergies_correction_reason_chk CHECK (
  "supersedesId" IS NULL OR coalesce(length(btrim("correctionReason")), 0) > 0);
ALTER TABLE medication_history ADD CONSTRAINT medication_history_correction_reason_chk CHECK (
  "supersedesId" IS NULL OR coalesce(length(btrim("correctionReason")), 0) > 0);
ALTER TABLE vaccinations ADD CONSTRAINT vaccinations_correction_reason_chk CHECK (
  "supersedesId" IS NULL OR coalesce(length(btrim("correctionReason")), 0) > 0);
ALTER TABLE family_history ADD CONSTRAINT family_history_correction_reason_chk CHECK (
  "supersedesId" IS NULL OR coalesce(length(btrim("correctionReason")), 0) > 0);
ALTER TABLE lab_orders ADD CONSTRAINT lab_orders_amendment_reason_chk CHECK (
  "amendsLabOrderId" IS NULL OR coalesce(length(btrim("amendmentReason")), 0) > 0);

-- A correction belongs to the same encounter or patient as the row it corrects.
-- TG_ARGV[0] = link column, TG_ARGV[1] = parent column.
CREATE FUNCTION medcore_check_correction_parent() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  link_id uuid := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
  parent_of_original text;
BEGIN
  IF link_id IS NULL THEN RETURN NEW; END IF;
  EXECUTE format('SELECT %I::text FROM %I WHERE id = $1', TG_ARGV[1], TG_TABLE_NAME)
    INTO parent_of_original USING link_id;
  IF parent_of_original IS DISTINCT FROM (to_jsonb(NEW) ->> TG_ARGV[1]) THEN
    RAISE EXCEPTION 'A correction in % must have the same % as the entry it corrects', TG_TABLE_NAME, TG_ARGV[1]
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER record_entries_correction_parent BEFORE INSERT ON record_entries
  FOR EACH ROW EXECUTE FUNCTION medcore_check_correction_parent('amendsEntryId', 'medicalRecordId');
CREATE TRIGGER vitals_correction_parent BEFORE INSERT ON vitals
  FOR EACH ROW EXECUTE FUNCTION medcore_check_correction_parent('supersedesId', 'medicalRecordId');
CREATE TRIGGER diagnoses_correction_parent BEFORE INSERT ON diagnoses
  FOR EACH ROW EXECUTE FUNCTION medcore_check_correction_parent('supersedesId', 'medicalRecordId');
CREATE TRIGGER administration_notes_correction_parent BEFORE INSERT ON administration_notes
  FOR EACH ROW EXECUTE FUNCTION medcore_check_correction_parent('supersedesId', 'medicalRecordId');
CREATE TRIGGER allergies_correction_parent BEFORE INSERT ON allergies
  FOR EACH ROW EXECUTE FUNCTION medcore_check_correction_parent('supersedesId', 'patientId');
CREATE TRIGGER medication_history_correction_parent BEFORE INSERT ON medication_history
  FOR EACH ROW EXECUTE FUNCTION medcore_check_correction_parent('supersedesId', 'patientId');
CREATE TRIGGER vaccinations_correction_parent BEFORE INSERT ON vaccinations
  FOR EACH ROW EXECUTE FUNCTION medcore_check_correction_parent('supersedesId', 'patientId');
CREATE TRIGGER family_history_correction_parent BEFORE INSERT ON family_history
  FOR EACH ROW EXECUTE FUNCTION medcore_check_correction_parent('supersedesId', 'patientId');

-- Family history: one original flag per patient and condition; corrections chain from it.
CREATE UNIQUE INDEX family_history_patient_condition_original_key
  ON family_history ("patientId", condition) WHERE "supersedesId" IS NULL;

-- Patient-level history status: who, when and why for every status change.
ALTER TABLE allergies
  ADD CONSTRAINT allergies_status_actor_chk CHECK (status = 'ACTIVE' OR ("statusChangedById" IS NOT NULL AND "statusChangedAt" IS NOT NULL)),
  ADD CONSTRAINT allergies_status_reason_chk CHECK (status <> 'ENTERED_IN_ERROR' OR coalesce(length(btrim("statusReason")), 0) > 0);
ALTER TABLE medication_history
  ADD CONSTRAINT medication_history_status_actor_chk CHECK (status = 'ACTIVE' OR ("statusChangedById" IS NOT NULL AND "statusChangedAt" IS NOT NULL)),
  ADD CONSTRAINT medication_history_status_reason_chk CHECK (status <> 'ENTERED_IN_ERROR' OR coalesce(length(btrim("statusReason")), 0) > 0);
ALTER TABLE vaccinations
  ADD CONSTRAINT vaccinations_status_actor_chk CHECK (status = 'ACTIVE' OR ("statusChangedById" IS NOT NULL AND "statusChangedAt" IS NOT NULL)),
  ADD CONSTRAINT vaccinations_status_reason_chk CHECK (status <> 'ENTERED_IN_ERROR' OR coalesce(length(btrim("statusReason")), 0) > 0);
ALTER TABLE family_history
  ADD CONSTRAINT family_history_status_actor_chk CHECK (status = 'ACTIVE' OR ("statusChangedById" IS NOT NULL AND "statusChangedAt" IS NOT NULL)),
  ADD CONSTRAINT family_history_status_reason_chk CHECK (status <> 'ENTERED_IN_ERROR' OR coalesce(length(btrim("statusReason")), 0) > 0);

-- Append-only and lock rules (PRD 7.3, section 05 hint, section 10) -----------------------
CREATE FUNCTION medcore_reject_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is not permitted: this table is append-only', TG_OP, TG_TABLE_NAME
    USING ERRCODE = 'integrity_constraint_violation';
END;
$$;

-- Patient-level history: only the status columns may change; ENTERED_IN_ERROR is final.
CREATE FUNCTION medcore_only_status_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mutable text[] := ARRAY['status', 'statusReason', 'statusChangedById', 'statusChangedAt'];
BEGIN
  IF (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'Only the status of a % entry can change; record a correction instead', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  IF (to_jsonb(OLD) ->> 'status') = 'ENTERED_IN_ERROR' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'An entry marked ENTERED_IN_ERROR in % cannot change', TG_TABLE_NAME
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- Encounter-level clinical data and the audit log: never updated or deleted.
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

-- Patient-level history: never deleted; only status columns change.
CREATE TRIGGER allergies_no_delete BEFORE DELETE ON allergies FOR EACH ROW EXECUTE FUNCTION medcore_reject_change();
CREATE TRIGGER allergies_status_only BEFORE UPDATE ON allergies FOR EACH ROW EXECUTE FUNCTION medcore_only_status_change();
CREATE TRIGGER medication_history_no_delete BEFORE DELETE ON medication_history FOR EACH ROW EXECUTE FUNCTION medcore_reject_change();
CREATE TRIGGER medication_history_status_only BEFORE UPDATE ON medication_history FOR EACH ROW EXECUTE FUNCTION medcore_only_status_change();
CREATE TRIGGER vaccinations_no_delete BEFORE DELETE ON vaccinations FOR EACH ROW EXECUTE FUNCTION medcore_reject_change();
CREATE TRIGGER vaccinations_status_only BEFORE UPDATE ON vaccinations FOR EACH ROW EXECUTE FUNCTION medcore_only_status_change();
CREATE TRIGGER family_history_no_delete BEFORE DELETE ON family_history FOR EACH ROW EXECUTE FUNCTION medcore_reject_change();
CREATE TRIGGER family_history_status_only BEFORE UPDATE ON family_history FOR EACH ROW EXECUTE FUNCTION medcore_only_status_change();

-- Medical records: never deleted; locked once CLOSED (later changes are addenda).
CREATE FUNCTION medcore_lock_closed_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'CLOSED' THEN
    RAISE EXCEPTION 'Medical record % is closed; add an addendum instead', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER medical_records_no_delete BEFORE DELETE ON medical_records
  FOR EACH ROW EXECUTE FUNCTION medcore_reject_change();
CREATE TRIGGER medical_records_lock_closed BEFORE UPDATE ON medical_records
  FOR EACH ROW EXECUTE FUNCTION medcore_lock_closed_record();

-- Laboratory: approved orders and their results are locked; corrections are amended orders.
CREATE FUNCTION medcore_lock_approved_lab_result() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE order_status text;
BEGIN
  SELECT o.status::text INTO order_status
    FROM lab_order_items i JOIN lab_orders o ON o.id = i."labOrderId"
    WHERE i.id = NEW."labOrderItemId";
  IF order_status = 'APPROVED' THEN
    RAISE EXCEPTION 'Results of an approved lab order are locked; create an amended order instead'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lab_results_no_delete BEFORE DELETE ON lab_results
  FOR EACH ROW EXECUTE FUNCTION medcore_reject_change();
CREATE TRIGGER lab_results_lock_approved BEFORE INSERT OR UPDATE ON lab_results
  FOR EACH ROW EXECUTE FUNCTION medcore_lock_approved_lab_result();

-- After approval only the generated PDF report may be attached to a lab order.
CREATE FUNCTION medcore_lock_approved_lab_order() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  mutable text[] := ARRAY['reportFileId', 'updatedAt'];
BEGIN
  IF OLD.status = 'APPROVED' AND (to_jsonb(NEW) - mutable) IS DISTINCT FROM (to_jsonb(OLD) - mutable) THEN
    RAISE EXCEPTION 'Lab order % is approved and locked; create an amended order instead', OLD.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lab_orders_lock_approved BEFORE UPDATE ON lab_orders
  FOR EACH ROW EXECUTE FUNCTION medcore_lock_approved_lab_order();

-- An amended lab order replaces an APPROVED order from the same encounter.
CREATE FUNCTION medcore_check_lab_amendment() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE original lab_orders%ROWTYPE;
BEGIN
  IF NEW."amendsLabOrderId" IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO original FROM lab_orders WHERE id = NEW."amendsLabOrderId";
  IF original.status <> 'APPROVED' OR original."medicalRecordId" <> NEW."medicalRecordId" THEN
    RAISE EXCEPTION 'An amended lab order must replace an APPROVED order from the same medical record'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER lab_orders_amendment_chk BEFORE INSERT ON lab_orders
  FOR EACH ROW EXECUTE FUNCTION medcore_check_lab_amendment();
