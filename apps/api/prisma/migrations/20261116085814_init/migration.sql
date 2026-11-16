-- CreateEnum
CREATE TYPE "Role" AS ENUM ('SUPER_ADMIN', 'HOSPITAL_ADMIN', 'DOCTOR', 'NURSE', 'RECEPTIONIST', 'LAB_TECHNICIAN', 'PHARMACIST', 'ACCOUNTANT', 'PATIENT');

-- CreateEnum
CREATE TYPE "HospitalStatus" AS ENUM ('PENDING', 'VERIFIED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIAL', 'ACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED');

-- CreateEnum
CREATE TYPE "BloodGroup" AS ENUM ('A_POSITIVE', 'A_NEGATIVE', 'B_POSITIVE', 'B_NEGATIVE', 'AB_POSITIVE', 'AB_NEGATIVE', 'O_POSITIVE', 'O_NEGATIVE');

-- CreateEnum
CREATE TYPE "RoomType" AS ENUM ('WARD', 'PRIVATE', 'ICU', 'CONSULTATION', 'OTHER');

-- CreateEnum
CREATE TYPE "BedStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateEnum
CREATE TYPE "ScheduleExceptionType" AS ENUM ('LEAVE', 'BLOCKED', 'EXTRA_HOURS');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "AppointmentType" AS ENUM ('REGULAR', 'FOLLOW_UP', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "MedicalRecordStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "RecordEntryKind" AS ENUM ('NOTE', 'ADDENDUM');

-- CreateEnum
CREATE TYPE "ClinicalEntryStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'ENTERED_IN_ERROR');

-- CreateEnum
CREATE TYPE "DiagnosisType" AS ENUM ('DIFFERENTIAL', 'CONFIRMED');

-- CreateEnum
CREATE TYPE "AllergyKind" AS ENUM ('ALLERGY', 'ADVERSE_DRUG_REACTION');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('MILD', 'MODERATE', 'SEVERE');

-- CreateEnum
CREATE TYPE "FamilyCondition" AS ENUM ('DIABETES', 'HYPERTENSION', 'CANCER', 'CARDIAC');

-- CreateEnum
CREATE TYPE "FilePurpose" AS ENUM ('MEDICAL_ATTACHMENT', 'LAB_REPORT', 'DOCTOR_SIGNATURE', 'PRESCRIPTION_PDF', 'RECEIPT_PDF');

-- CreateEnum
CREATE TYPE "MedicineForm" AS ENUM ('TABLET', 'CAPSULE', 'SYRUP', 'INJECTION', 'TOPICAL');

-- CreateEnum
CREATE TYPE "DoseFrequency" AS ENUM ('OD', 'BD', 'TDS', 'QID', 'SOS');

-- CreateEnum
CREATE TYPE "PrescriptionStatus" AS ENUM ('ISSUED', 'READY_FOR_PICKUP', 'PARTIALLY_DISPENSED', 'DISPENSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LabTestCategory" AS ENUM ('LABORATORY', 'RADIOLOGY');

-- CreateEnum
CREATE TYPE "LabOrderStatus" AS ENUM ('ORDERED', 'SAMPLE_COLLECTED', 'PROCESSING', 'RESULT_UPLOADED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LabPriority" AS ENUM ('ROUTINE', 'URGENT');

-- CreateEnum
CREATE TYPE "ResultFlag" AS ENUM ('NORMAL', 'LOW', 'HIGH');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('ACTIVE', 'QUARANTINED', 'DEPLETED');

-- CreateEnum
CREATE TYPE "StockMovementType" AS ENUM ('RECEIPT', 'DISPENSE', 'ADJUSTMENT', 'QUARANTINE');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'FINALISED', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "InvoiceItemKind" AS ENUM ('CONSULTATION', 'LAB', 'PHARMACY', 'ROOM', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('STRIPE_CARD', 'RAZORPAY_UPI', 'RAZORPAY_NETBANKING', 'CASH');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'RAZORPAY');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'REJECTED', 'SETTLED');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'SMS', 'IN_APP');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "addresses" (
    "id" UUID NOT NULL,
    "line1" TEXT NOT NULL,
    "line2" TEXT,
    "city" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "postalCode" TEXT NOT NULL,
    "country" CHAR(2) NOT NULL DEFAULT 'IN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "hospitalId" UUID NOT NULL,

    CONSTRAINT "addresses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "hospitals" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "status" "HospitalStatus" NOT NULL DEFAULT 'PENDING',
    "verifiedAt" TIMESTAMPTZ(3),
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "currency" CHAR(3) NOT NULL DEFAULT 'INR',
    "defaultSlotMinutes" INTEGER NOT NULL DEFAULT 30,
    "subscriptionPlan" TEXT,
    "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIAL',
    "addressId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "taxRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "invoicePrefix" TEXT NOT NULL DEFAULT 'INV',

    CONSTRAINT "hospitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "hospitalId" UUID,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "phoneVerifiedAt" TIMESTAMPTZ(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMPTZ(3),
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_profiles" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "departmentId" UUID,
    "employeeCode" TEXT,
    "designation" TEXT,
    "isSeniorLabTechnician" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "staff_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "departmentId" UUID,
    "number" TEXT NOT NULL,
    "type" "RoomType" NOT NULL,
    "floor" TEXT,
    "dailyCharge" DECIMAL(12,2),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beds" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "roomId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "status" "BedStatus" NOT NULL DEFAULT 'AVAILABLE',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "beds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctors" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "specialisation" TEXT NOT NULL,
    "qualification" TEXT,
    "consultationFee" DECIMAL(12,2) NOT NULL,
    "bio" TEXT,
    "signatureFileId" UUID,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "doctors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_departments" (
    "hospitalId" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doctor_departments_pkey" PRIMARY KEY ("doctorId","departmentId")
);

-- CreateTable
CREATE TABLE "patients" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "mrn" TEXT NOT NULL,
    "dateOfBirth" DATE NOT NULL,
    "gender" "Gender" NOT NULL,
    "bloodGroup" "BloodGroup",
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "addressId" UUID,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doctor_schedules" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "weekday" "Weekday" NOT NULL,
    "startTime" TIME(0) NOT NULL,
    "endTime" TIME(0) NOT NULL,
    "slotMinutes" INTEGER NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "doctor_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "schedule_exceptions" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "type" "ScheduleExceptionType" NOT NULL,
    "startTime" TIME(0),
    "endTime" TIME(0),
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "schedule_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "appointments" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "doctorId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "scheduledAt" TIMESTAMPTZ(3) NOT NULL,
    "endAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'PENDING',
    "type" "AppointmentType" NOT NULL DEFAULT 'REGULAR',
    "reason" TEXT,
    "cancellationReason" TEXT,
    "createdById" UUID NOT NULL,
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "appointments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_records" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "chiefComplaint" TEXT NOT NULL,
    "presentingSymptoms" TEXT,
    "treatmentPlanEnc" BYTEA,
    "status" "MedicalRecordStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "medical_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "record_entries" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "medicalRecordId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "kind" "RecordEntryKind" NOT NULL,
    "bodyEnc" BYTEA NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "amendsEntryId" UUID,
    "correctionReason" TEXT,

    CONSTRAINT "record_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "administration_notes" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "medicalRecordId" UUID NOT NULL,
    "nurseId" UUID NOT NULL,
    "medicationGiven" TEXT NOT NULL,
    "dose" TEXT,
    "route" TEXT,
    "noteEnc" BYTEA,
    "administeredAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedesId" UUID,
    "correctionReason" TEXT,

    CONSTRAINT "administration_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vitals" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "medicalRecordId" UUID NOT NULL,
    "recordedById" UUID NOT NULL,
    "systolicBp" INTEGER,
    "diastolicBp" INTEGER,
    "pulse" INTEGER,
    "temperatureC" DECIMAL(4,1),
    "spo2" INTEGER,
    "heightCm" DECIMAL(5,1),
    "weightKg" DECIMAL(5,1),
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedesId" UUID,
    "correctionReason" TEXT,

    CONSTRAINT "vitals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "icd10_codes" (
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,

    CONSTRAINT "icd10_codes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "diagnoses" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "medicalRecordId" UUID NOT NULL,
    "icd10Code" TEXT,
    "descriptionEnc" BYTEA NOT NULL,
    "type" "DiagnosisType" NOT NULL,
    "recordedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedesId" UUID,
    "correctionReason" TEXT,

    CONSTRAINT "diagnoses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allergies" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "kind" "AllergyKind" NOT NULL,
    "substance" TEXT NOT NULL,
    "reaction" TEXT,
    "severity" "Severity",
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedesId" UUID,
    "correctionReason" TEXT,
    "status" "ClinicalEntryStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "statusChangedById" UUID,
    "statusChangedAt" TIMESTAMPTZ(3),

    CONSTRAINT "allergies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medication_history" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "medicineName" TEXT NOT NULL,
    "dosage" TEXT,
    "frequency" TEXT,
    "startedOn" DATE,
    "endedOn" DATE,
    "notes" TEXT,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedesId" UUID,
    "correctionReason" TEXT,
    "status" "ClinicalEntryStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "statusChangedById" UUID,
    "statusChangedAt" TIMESTAMPTZ(3),

    CONSTRAINT "medication_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vaccinations" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "vaccineName" TEXT NOT NULL,
    "administeredOn" DATE NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "nextDueOn" DATE,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedesId" UUID,
    "correctionReason" TEXT,
    "status" "ClinicalEntryStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "statusChangedById" UUID,
    "statusChangedAt" TIMESTAMPTZ(3),

    CONSTRAINT "vaccinations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "family_history" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "condition" "FamilyCondition" NOT NULL,
    "present" BOOLEAN NOT NULL,
    "relation" TEXT,
    "notes" TEXT,
    "recordedById" UUID NOT NULL,
    "recordedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersedesId" UUID,
    "correctionReason" TEXT,
    "status" "ClinicalEntryStatus" NOT NULL DEFAULT 'ACTIVE',
    "statusReason" TEXT,
    "statusChangedById" UUID,
    "statusChangedAt" TIMESTAMPTZ(3),

    CONSTRAINT "family_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_attachments" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "patientId" UUID,
    "medicalRecordId" UUID,
    "purpose" "FilePurpose" NOT NULL,
    "storageKey" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "uploadedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicines" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "genericName" TEXT,
    "form" "MedicineForm" NOT NULL,
    "strength" TEXT NOT NULL,
    "reorderLevel" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "medicines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppliers" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "addressId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medicine_batches" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "medicineId" UUID NOT NULL,
    "supplierId" UUID,
    "batchNumber" TEXT NOT NULL,
    "manufacturedOn" DATE NOT NULL,
    "expiresOn" DATE NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL,
    "mrp" DECIMAL(12,2) NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "medicine_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "type" "StockMovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT,
    "dispenseId" UUID,
    "performedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescriptions" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "medicalRecordId" UUID NOT NULL,
    "status" "PrescriptionStatus" NOT NULL DEFAULT 'ISSUED',
    "notes" TEXT,
    "pdfFileId" UUID,
    "issuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "verifiedById" UUID,
    "verifiedAt" TIMESTAMPTZ(3),

    CONSTRAINT "prescriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "prescription_items" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "prescriptionId" UUID NOT NULL,
    "medicineId" UUID NOT NULL,
    "dosage" TEXT NOT NULL,
    "frequency" "DoseFrequency" NOT NULL,
    "durationDays" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "instructions" TEXT,

    CONSTRAINT "prescription_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dispenses" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "prescriptionItemId" UUID NOT NULL,
    "batchId" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "dispensedById" UUID NOT NULL,
    "dispensedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dispenses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_tests" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "LabTestCategory" NOT NULL DEFAULT 'LABORATORY',
    "unit" TEXT,
    "sampleType" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "lab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_test_ranges" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "labTestId" UUID NOT NULL,
    "gender" "Gender",
    "ageMinYears" INTEGER,
    "ageMaxYears" INTEGER,
    "low" DECIMAL(12,4) NOT NULL,
    "high" DECIMAL(12,4) NOT NULL,

    CONSTRAINT "lab_test_ranges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_orders" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "medicalRecordId" UUID NOT NULL,
    "orderedById" UUID NOT NULL,
    "status" "LabOrderStatus" NOT NULL DEFAULT 'ORDERED',
    "priority" "LabPriority" NOT NULL DEFAULT 'ROUTINE',
    "sampleCollectedAt" TIMESTAMPTZ(3),
    "sampleCollectedById" UUID,
    "approvedAt" TIMESTAMPTZ(3),
    "approvedById" UUID,
    "rejectionReason" TEXT,
    "reportFileId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "amendsLabOrderId" UUID,
    "amendmentReason" TEXT,

    CONSTRAINT "lab_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_order_items" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "labOrderId" UUID NOT NULL,
    "labTestId" UUID NOT NULL,

    CONSTRAINT "lab_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_results" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "labOrderItemId" UUID NOT NULL,
    "valueNumeric" DECIMAL(12,4),
    "valueText" TEXT,
    "flag" "ResultFlag",
    "enteredById" UUID NOT NULL,
    "enteredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "appointmentId" UUID NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotal" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "finalisedAt" TIMESTAMPTZ(3),
    "finalisedById" UUID,
    "receiptFileId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "kind" "InvoiceItemKind" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "labOrderItemId" UUID,
    "dispenseId" UUID,
    "roomId" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "provider" "PaymentProvider",
    "providerReference" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMPTZ(3),
    "receivedById" UUID,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "reconciledAt" TIMESTAMPTZ(3),
    "reconciledById" UUID,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "eventId" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_claims" (
    "id" UUID NOT NULL,
    "hospitalId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "tpaName" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "claimAmount" DECIMAL(12,2) NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'SUBMITTED',
    "settledAmount" DECIMAL(12,2),
    "notes" TEXT,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMPTZ(3),
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "insurance_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "hospitalId" UUID,
    "recipientId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" UUID,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" UUID NOT NULL,
    "notificationId" UUID NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "sentAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "hospitalId" UUID,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "hospitalId" UUID,
    "actorId" UUID,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "changes" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "addresses_hospitalId_idx" ON "addresses"("hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "addresses_id_hospitalId_key" ON "addresses"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "hospitals_code_key" ON "hospitals"("code");

-- CreateIndex
CREATE UNIQUE INDEX "hospitals_addressId_key" ON "hospitals"("addressId");

-- CreateIndex
CREATE INDEX "hospitals_status_idx" ON "hospitals"("status");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_hospitalId_role_idx" ON "users"("hospitalId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "users_id_hospitalId_key" ON "users"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_userId_key" ON "staff_profiles"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_userId_hospitalId_key" ON "staff_profiles"("userId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "staff_profiles_hospitalId_employeeCode_key" ON "staff_profiles"("hospitalId", "employeeCode");

-- CreateIndex
CREATE UNIQUE INDEX "departments_id_hospitalId_key" ON "departments"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "departments_hospitalId_name_key" ON "departments"("hospitalId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_id_hospitalId_key" ON "rooms"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_hospitalId_number_key" ON "rooms"("hospitalId", "number");

-- CreateIndex
CREATE INDEX "beds_hospitalId_status_idx" ON "beds"("hospitalId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "beds_roomId_label_key" ON "beds"("roomId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_userId_key" ON "doctors"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_signatureFileId_key" ON "doctors"("signatureFileId");

-- CreateIndex
CREATE INDEX "doctors_hospitalId_specialisation_idx" ON "doctors"("hospitalId", "specialisation");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_userId_hospitalId_key" ON "doctors"("userId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_signatureFileId_hospitalId_key" ON "doctors"("signatureFileId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_id_hospitalId_key" ON "doctors"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "doctors_hospitalId_registrationNumber_key" ON "doctors"("hospitalId", "registrationNumber");

-- CreateIndex
CREATE INDEX "doctor_departments_hospitalId_idx" ON "doctor_departments"("hospitalId");

-- CreateIndex
CREATE INDEX "doctor_departments_departmentId_idx" ON "doctor_departments"("departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "patients_userId_key" ON "patients"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "patients_userId_hospitalId_key" ON "patients"("userId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "patients_id_hospitalId_key" ON "patients"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "patients_hospitalId_mrn_key" ON "patients"("hospitalId", "mrn");

-- CreateIndex
CREATE INDEX "doctor_schedules_hospitalId_idx" ON "doctor_schedules"("hospitalId");

-- CreateIndex
CREATE INDEX "doctor_schedules_doctorId_weekday_idx" ON "doctor_schedules"("doctorId", "weekday");

-- CreateIndex
CREATE INDEX "schedule_exceptions_hospitalId_idx" ON "schedule_exceptions"("hospitalId");

-- CreateIndex
CREATE INDEX "schedule_exceptions_doctorId_date_idx" ON "schedule_exceptions"("doctorId", "date");

-- CreateIndex
CREATE INDEX "appointments_hospitalId_scheduledAt_idx" ON "appointments"("hospitalId", "scheduledAt");

-- CreateIndex
CREATE INDEX "appointments_hospitalId_status_idx" ON "appointments"("hospitalId", "status");

-- CreateIndex
CREATE INDEX "appointments_doctorId_scheduledAt_idx" ON "appointments"("doctorId", "scheduledAt");

-- CreateIndex
CREATE INDEX "appointments_patientId_scheduledAt_idx" ON "appointments"("patientId", "scheduledAt");

-- CreateIndex
CREATE UNIQUE INDEX "appointments_id_hospitalId_key" ON "appointments"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "medical_records_appointmentId_key" ON "medical_records"("appointmentId");

-- CreateIndex
CREATE INDEX "medical_records_hospitalId_createdAt_idx" ON "medical_records"("hospitalId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "medical_records_appointmentId_hospitalId_key" ON "medical_records"("appointmentId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "medical_records_id_hospitalId_key" ON "medical_records"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "record_entries_amendsEntryId_key" ON "record_entries"("amendsEntryId");

-- CreateIndex
CREATE INDEX "record_entries_medicalRecordId_createdAt_idx" ON "record_entries"("medicalRecordId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "record_entries_amendsEntryId_hospitalId_key" ON "record_entries"("amendsEntryId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "record_entries_id_hospitalId_key" ON "record_entries"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "administration_notes_supersedesId_key" ON "administration_notes"("supersedesId");

-- CreateIndex
CREATE INDEX "administration_notes_medicalRecordId_idx" ON "administration_notes"("medicalRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "administration_notes_supersedesId_hospitalId_key" ON "administration_notes"("supersedesId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "administration_notes_id_hospitalId_key" ON "administration_notes"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "vitals_supersedesId_key" ON "vitals"("supersedesId");

-- CreateIndex
CREATE INDEX "vitals_medicalRecordId_idx" ON "vitals"("medicalRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "vitals_supersedesId_hospitalId_key" ON "vitals"("supersedesId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "vitals_id_hospitalId_key" ON "vitals"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "diagnoses_supersedesId_key" ON "diagnoses"("supersedesId");

-- CreateIndex
CREATE INDEX "diagnoses_medicalRecordId_idx" ON "diagnoses"("medicalRecordId");

-- CreateIndex
CREATE INDEX "diagnoses_icd10Code_idx" ON "diagnoses"("icd10Code");

-- CreateIndex
CREATE UNIQUE INDEX "diagnoses_supersedesId_hospitalId_key" ON "diagnoses"("supersedesId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "diagnoses_id_hospitalId_key" ON "diagnoses"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "allergies_supersedesId_key" ON "allergies"("supersedesId");

-- CreateIndex
CREATE INDEX "allergies_patientId_idx" ON "allergies"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "allergies_supersedesId_hospitalId_key" ON "allergies"("supersedesId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "allergies_id_hospitalId_key" ON "allergies"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "medication_history_supersedesId_key" ON "medication_history"("supersedesId");

-- CreateIndex
CREATE INDEX "medication_history_patientId_idx" ON "medication_history"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "medication_history_supersedesId_hospitalId_key" ON "medication_history"("supersedesId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "medication_history_id_hospitalId_key" ON "medication_history"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "vaccinations_supersedesId_key" ON "vaccinations"("supersedesId");

-- CreateIndex
CREATE INDEX "vaccinations_patientId_idx" ON "vaccinations"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "vaccinations_supersedesId_hospitalId_key" ON "vaccinations"("supersedesId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "vaccinations_id_hospitalId_key" ON "vaccinations"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "family_history_supersedesId_key" ON "family_history"("supersedesId");

-- CreateIndex
CREATE INDEX "family_history_patientId_idx" ON "family_history"("patientId");

-- CreateIndex
CREATE UNIQUE INDEX "family_history_supersedesId_hospitalId_key" ON "family_history"("supersedesId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "family_history_id_hospitalId_key" ON "family_history"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "file_attachments_storageKey_key" ON "file_attachments"("storageKey");

-- CreateIndex
CREATE INDEX "file_attachments_hospitalId_purpose_idx" ON "file_attachments"("hospitalId", "purpose");

-- CreateIndex
CREATE INDEX "file_attachments_patientId_idx" ON "file_attachments"("patientId");

-- CreateIndex
CREATE INDEX "file_attachments_medicalRecordId_idx" ON "file_attachments"("medicalRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "file_attachments_id_hospitalId_key" ON "file_attachments"("id", "hospitalId");

-- CreateIndex
CREATE INDEX "medicines_hospitalId_name_idx" ON "medicines"("hospitalId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "medicines_id_hospitalId_key" ON "medicines"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "medicines_hospitalId_name_strength_form_key" ON "medicines"("hospitalId", "name", "strength", "form");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_id_hospitalId_key" ON "suppliers"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_hospitalId_name_key" ON "suppliers"("hospitalId", "name");

-- CreateIndex
CREATE INDEX "medicine_batches_medicineId_status_expiresOn_idx" ON "medicine_batches"("medicineId", "status", "expiresOn");

-- CreateIndex
CREATE INDEX "medicine_batches_hospitalId_expiresOn_idx" ON "medicine_batches"("hospitalId", "expiresOn");

-- CreateIndex
CREATE UNIQUE INDEX "medicine_batches_id_hospitalId_key" ON "medicine_batches"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "medicine_batches_medicineId_batchNumber_key" ON "medicine_batches"("medicineId", "batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_dispenseId_key" ON "stock_movements"("dispenseId");

-- CreateIndex
CREATE INDEX "stock_movements_batchId_createdAt_idx" ON "stock_movements"("batchId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "stock_movements_dispenseId_hospitalId_key" ON "stock_movements"("dispenseId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "prescriptions_pdfFileId_key" ON "prescriptions"("pdfFileId");

-- CreateIndex
CREATE INDEX "prescriptions_hospitalId_status_idx" ON "prescriptions"("hospitalId", "status");

-- CreateIndex
CREATE INDEX "prescriptions_medicalRecordId_idx" ON "prescriptions"("medicalRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "prescriptions_pdfFileId_hospitalId_key" ON "prescriptions"("pdfFileId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "prescriptions_id_hospitalId_key" ON "prescriptions"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "prescription_items_id_hospitalId_key" ON "prescription_items"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "prescription_items_prescriptionId_medicineId_key" ON "prescription_items"("prescriptionId", "medicineId");

-- CreateIndex
CREATE INDEX "dispenses_prescriptionItemId_idx" ON "dispenses"("prescriptionItemId");

-- CreateIndex
CREATE UNIQUE INDEX "dispenses_id_hospitalId_key" ON "dispenses"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "lab_tests_id_hospitalId_key" ON "lab_tests"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "lab_tests_hospitalId_code_key" ON "lab_tests"("hospitalId", "code");

-- CreateIndex
CREATE INDEX "lab_test_ranges_labTestId_idx" ON "lab_test_ranges"("labTestId");

-- CreateIndex
CREATE UNIQUE INDEX "lab_orders_reportFileId_key" ON "lab_orders"("reportFileId");

-- CreateIndex
CREATE UNIQUE INDEX "lab_orders_amendsLabOrderId_key" ON "lab_orders"("amendsLabOrderId");

-- CreateIndex
CREATE INDEX "lab_orders_hospitalId_status_idx" ON "lab_orders"("hospitalId", "status");

-- CreateIndex
CREATE INDEX "lab_orders_medicalRecordId_idx" ON "lab_orders"("medicalRecordId");

-- CreateIndex
CREATE UNIQUE INDEX "lab_orders_reportFileId_hospitalId_key" ON "lab_orders"("reportFileId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "lab_orders_amendsLabOrderId_hospitalId_key" ON "lab_orders"("amendsLabOrderId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "lab_orders_id_hospitalId_key" ON "lab_orders"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "lab_order_items_id_hospitalId_key" ON "lab_order_items"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "lab_order_items_labOrderId_labTestId_key" ON "lab_order_items"("labOrderId", "labTestId");

-- CreateIndex
CREATE UNIQUE INDEX "lab_results_labOrderItemId_key" ON "lab_results"("labOrderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "lab_results_labOrderItemId_hospitalId_key" ON "lab_results"("labOrderItemId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_appointmentId_key" ON "invoices"("appointmentId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_receiptFileId_key" ON "invoices"("receiptFileId");

-- CreateIndex
CREATE INDEX "invoices_hospitalId_status_idx" ON "invoices"("hospitalId", "status");

-- CreateIndex
CREATE INDEX "invoices_hospitalId_createdAt_idx" ON "invoices"("hospitalId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_receiptFileId_hospitalId_key" ON "invoices"("receiptFileId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_appointmentId_hospitalId_key" ON "invoices"("appointmentId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_id_hospitalId_key" ON "invoices"("id", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_hospitalId_invoiceNumber_key" ON "invoices"("hospitalId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_items_labOrderItemId_key" ON "invoice_items"("labOrderItemId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_items_dispenseId_key" ON "invoice_items"("dispenseId");

-- CreateIndex
CREATE INDEX "invoice_items_invoiceId_idx" ON "invoice_items"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_items_labOrderItemId_hospitalId_key" ON "invoice_items"("labOrderItemId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_items_dispenseId_hospitalId_key" ON "invoice_items"("dispenseId", "hospitalId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerReference_key" ON "payments"("providerReference");

-- CreateIndex
CREATE INDEX "payments_invoiceId_idx" ON "payments"("invoiceId");

-- CreateIndex
CREATE INDEX "payments_hospitalId_paidAt_idx" ON "payments"("hospitalId", "paidAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_eventId_key" ON "webhook_events"("provider", "eventId");

-- CreateIndex
CREATE INDEX "insurance_claims_hospitalId_status_idx" ON "insurance_claims"("hospitalId", "status");

-- CreateIndex
CREATE INDEX "notifications_recipientId_readAt_idx" ON "notifications"("recipientId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_recipientId_createdAt_idx" ON "notifications"("recipientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notification_deliveries_notificationId_channel_key" ON "notification_deliveries"("notificationId", "channel");

-- CreateIndex
CREATE INDEX "audit_logs_hospitalId_createdAt_idx" ON "audit_logs"("hospitalId", "createdAt");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_actorId_createdAt_idx" ON "audit_logs"("actorId", "createdAt");

-- AddForeignKey
ALTER TABLE "addresses" ADD CONSTRAINT "addresses_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "hospitals" ADD CONSTRAINT "hospitals_addressId_fkey" FOREIGN KEY ("addressId") REFERENCES "addresses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_userId_hospitalId_fkey" FOREIGN KEY ("userId", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_profiles" ADD CONSTRAINT "staff_profiles_departmentId_hospitalId_fkey" FOREIGN KEY ("departmentId", "hospitalId") REFERENCES "departments"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "departments" ADD CONSTRAINT "departments_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_departmentId_hospitalId_fkey" FOREIGN KEY ("departmentId", "hospitalId") REFERENCES "departments"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beds" ADD CONSTRAINT "beds_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beds" ADD CONSTRAINT "beds_roomId_hospitalId_fkey" FOREIGN KEY ("roomId", "hospitalId") REFERENCES "rooms"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_userId_hospitalId_fkey" FOREIGN KEY ("userId", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctors" ADD CONSTRAINT "doctors_signatureFileId_hospitalId_fkey" FOREIGN KEY ("signatureFileId", "hospitalId") REFERENCES "file_attachments"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_departments" ADD CONSTRAINT "doctor_departments_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_departments" ADD CONSTRAINT "doctor_departments_doctorId_hospitalId_fkey" FOREIGN KEY ("doctorId", "hospitalId") REFERENCES "doctors"("id", "hospitalId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_departments" ADD CONSTRAINT "doctor_departments_departmentId_hospitalId_fkey" FOREIGN KEY ("departmentId", "hospitalId") REFERENCES "departments"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_userId_hospitalId_fkey" FOREIGN KEY ("userId", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_addressId_hospitalId_fkey" FOREIGN KEY ("addressId", "hospitalId") REFERENCES "addresses"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_schedules" ADD CONSTRAINT "doctor_schedules_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_schedules" ADD CONSTRAINT "doctor_schedules_doctorId_hospitalId_fkey" FOREIGN KEY ("doctorId", "hospitalId") REFERENCES "doctors"("id", "hospitalId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doctor_schedules" ADD CONSTRAINT "doctor_schedules_departmentId_hospitalId_fkey" FOREIGN KEY ("departmentId", "hospitalId") REFERENCES "departments"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "schedule_exceptions" ADD CONSTRAINT "schedule_exceptions_doctorId_hospitalId_fkey" FOREIGN KEY ("doctorId", "hospitalId") REFERENCES "doctors"("id", "hospitalId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_doctorId_hospitalId_fkey" FOREIGN KEY ("doctorId", "hospitalId") REFERENCES "doctors"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_patientId_hospitalId_fkey" FOREIGN KEY ("patientId", "hospitalId") REFERENCES "patients"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_departmentId_hospitalId_fkey" FOREIGN KEY ("departmentId", "hospitalId") REFERENCES "departments"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_createdById_hospitalId_fkey" FOREIGN KEY ("createdById", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_records" ADD CONSTRAINT "medical_records_appointmentId_hospitalId_fkey" FOREIGN KEY ("appointmentId", "hospitalId") REFERENCES "appointments"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_entries" ADD CONSTRAINT "record_entries_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_entries" ADD CONSTRAINT "record_entries_medicalRecordId_hospitalId_fkey" FOREIGN KEY ("medicalRecordId", "hospitalId") REFERENCES "medical_records"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_entries" ADD CONSTRAINT "record_entries_authorId_hospitalId_fkey" FOREIGN KEY ("authorId", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "record_entries" ADD CONSTRAINT "record_entries_amendsEntryId_hospitalId_fkey" FOREIGN KEY ("amendsEntryId", "hospitalId") REFERENCES "record_entries"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administration_notes" ADD CONSTRAINT "administration_notes_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administration_notes" ADD CONSTRAINT "administration_notes_medicalRecordId_hospitalId_fkey" FOREIGN KEY ("medicalRecordId", "hospitalId") REFERENCES "medical_records"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administration_notes" ADD CONSTRAINT "administration_notes_nurseId_hospitalId_fkey" FOREIGN KEY ("nurseId", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "administration_notes" ADD CONSTRAINT "administration_notes_supersedesId_hospitalId_fkey" FOREIGN KEY ("supersedesId", "hospitalId") REFERENCES "administration_notes"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vitals" ADD CONSTRAINT "vitals_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vitals" ADD CONSTRAINT "vitals_medicalRecordId_hospitalId_fkey" FOREIGN KEY ("medicalRecordId", "hospitalId") REFERENCES "medical_records"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vitals" ADD CONSTRAINT "vitals_recordedById_hospitalId_fkey" FOREIGN KEY ("recordedById", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vitals" ADD CONSTRAINT "vitals_supersedesId_hospitalId_fkey" FOREIGN KEY ("supersedesId", "hospitalId") REFERENCES "vitals"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_medicalRecordId_hospitalId_fkey" FOREIGN KEY ("medicalRecordId", "hospitalId") REFERENCES "medical_records"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_icd10Code_fkey" FOREIGN KEY ("icd10Code") REFERENCES "icd10_codes"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_recordedById_hospitalId_fkey" FOREIGN KEY ("recordedById", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnoses" ADD CONSTRAINT "diagnoses_supersedesId_hospitalId_fkey" FOREIGN KEY ("supersedesId", "hospitalId") REFERENCES "diagnoses"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergies" ADD CONSTRAINT "allergies_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergies" ADD CONSTRAINT "allergies_patientId_hospitalId_fkey" FOREIGN KEY ("patientId", "hospitalId") REFERENCES "patients"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergies" ADD CONSTRAINT "allergies_recordedById_hospitalId_fkey" FOREIGN KEY ("recordedById", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergies" ADD CONSTRAINT "allergies_statusChangedById_hospitalId_fkey" FOREIGN KEY ("statusChangedById", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergies" ADD CONSTRAINT "allergies_supersedesId_hospitalId_fkey" FOREIGN KEY ("supersedesId", "hospitalId") REFERENCES "allergies"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_history" ADD CONSTRAINT "medication_history_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_history" ADD CONSTRAINT "medication_history_patientId_hospitalId_fkey" FOREIGN KEY ("patientId", "hospitalId") REFERENCES "patients"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_history" ADD CONSTRAINT "medication_history_recordedById_hospitalId_fkey" FOREIGN KEY ("recordedById", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_history" ADD CONSTRAINT "medication_history_statusChangedById_hospitalId_fkey" FOREIGN KEY ("statusChangedById", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medication_history" ADD CONSTRAINT "medication_history_supersedesId_hospitalId_fkey" FOREIGN KEY ("supersedesId", "hospitalId") REFERENCES "medication_history"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccinations" ADD CONSTRAINT "vaccinations_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccinations" ADD CONSTRAINT "vaccinations_patientId_hospitalId_fkey" FOREIGN KEY ("patientId", "hospitalId") REFERENCES "patients"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccinations" ADD CONSTRAINT "vaccinations_recordedById_hospitalId_fkey" FOREIGN KEY ("recordedById", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccinations" ADD CONSTRAINT "vaccinations_statusChangedById_hospitalId_fkey" FOREIGN KEY ("statusChangedById", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vaccinations" ADD CONSTRAINT "vaccinations_supersedesId_hospitalId_fkey" FOREIGN KEY ("supersedesId", "hospitalId") REFERENCES "vaccinations"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_history" ADD CONSTRAINT "family_history_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_history" ADD CONSTRAINT "family_history_patientId_hospitalId_fkey" FOREIGN KEY ("patientId", "hospitalId") REFERENCES "patients"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_history" ADD CONSTRAINT "family_history_recordedById_hospitalId_fkey" FOREIGN KEY ("recordedById", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_history" ADD CONSTRAINT "family_history_statusChangedById_hospitalId_fkey" FOREIGN KEY ("statusChangedById", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "family_history" ADD CONSTRAINT "family_history_supersedesId_hospitalId_fkey" FOREIGN KEY ("supersedesId", "hospitalId") REFERENCES "family_history"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_patientId_hospitalId_fkey" FOREIGN KEY ("patientId", "hospitalId") REFERENCES "patients"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_medicalRecordId_hospitalId_fkey" FOREIGN KEY ("medicalRecordId", "hospitalId") REFERENCES "medical_records"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_attachments" ADD CONSTRAINT "file_attachments_uploadedById_hospitalId_fkey" FOREIGN KEY ("uploadedById", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicines" ADD CONSTRAINT "medicines_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "suppliers" ADD CONSTRAINT "suppliers_addressId_hospitalId_fkey" FOREIGN KEY ("addressId", "hospitalId") REFERENCES "addresses"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicine_batches" ADD CONSTRAINT "medicine_batches_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicine_batches" ADD CONSTRAINT "medicine_batches_medicineId_hospitalId_fkey" FOREIGN KEY ("medicineId", "hospitalId") REFERENCES "medicines"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medicine_batches" ADD CONSTRAINT "medicine_batches_supplierId_hospitalId_fkey" FOREIGN KEY ("supplierId", "hospitalId") REFERENCES "suppliers"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_batchId_hospitalId_fkey" FOREIGN KEY ("batchId", "hospitalId") REFERENCES "medicine_batches"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_dispenseId_hospitalId_fkey" FOREIGN KEY ("dispenseId", "hospitalId") REFERENCES "dispenses"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "stock_movements" ADD CONSTRAINT "stock_movements_performedById_hospitalId_fkey" FOREIGN KEY ("performedById", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_medicalRecordId_hospitalId_fkey" FOREIGN KEY ("medicalRecordId", "hospitalId") REFERENCES "medical_records"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_pdfFileId_hospitalId_fkey" FOREIGN KEY ("pdfFileId", "hospitalId") REFERENCES "file_attachments"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescriptions" ADD CONSTRAINT "prescriptions_verifiedById_hospitalId_fkey" FOREIGN KEY ("verifiedById", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_prescriptionId_hospitalId_fkey" FOREIGN KEY ("prescriptionId", "hospitalId") REFERENCES "prescriptions"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "prescription_items" ADD CONSTRAINT "prescription_items_medicineId_hospitalId_fkey" FOREIGN KEY ("medicineId", "hospitalId") REFERENCES "medicines"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispenses" ADD CONSTRAINT "dispenses_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispenses" ADD CONSTRAINT "dispenses_prescriptionItemId_hospitalId_fkey" FOREIGN KEY ("prescriptionItemId", "hospitalId") REFERENCES "prescription_items"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispenses" ADD CONSTRAINT "dispenses_batchId_hospitalId_fkey" FOREIGN KEY ("batchId", "hospitalId") REFERENCES "medicine_batches"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dispenses" ADD CONSTRAINT "dispenses_dispensedById_hospitalId_fkey" FOREIGN KEY ("dispensedById", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_test_ranges" ADD CONSTRAINT "lab_test_ranges_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_test_ranges" ADD CONSTRAINT "lab_test_ranges_labTestId_hospitalId_fkey" FOREIGN KEY ("labTestId", "hospitalId") REFERENCES "lab_tests"("id", "hospitalId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_medicalRecordId_hospitalId_fkey" FOREIGN KEY ("medicalRecordId", "hospitalId") REFERENCES "medical_records"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_orderedById_hospitalId_fkey" FOREIGN KEY ("orderedById", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_sampleCollectedById_hospitalId_fkey" FOREIGN KEY ("sampleCollectedById", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_approvedById_hospitalId_fkey" FOREIGN KEY ("approvedById", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_reportFileId_hospitalId_fkey" FOREIGN KEY ("reportFileId", "hospitalId") REFERENCES "file_attachments"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_amendsLabOrderId_hospitalId_fkey" FOREIGN KEY ("amendsLabOrderId", "hospitalId") REFERENCES "lab_orders"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_order_items" ADD CONSTRAINT "lab_order_items_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_order_items" ADD CONSTRAINT "lab_order_items_labOrderId_hospitalId_fkey" FOREIGN KEY ("labOrderId", "hospitalId") REFERENCES "lab_orders"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_order_items" ADD CONSTRAINT "lab_order_items_labTestId_hospitalId_fkey" FOREIGN KEY ("labTestId", "hospitalId") REFERENCES "lab_tests"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_labOrderItemId_hospitalId_fkey" FOREIGN KEY ("labOrderItemId", "hospitalId") REFERENCES "lab_order_items"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_enteredById_hospitalId_fkey" FOREIGN KEY ("enteredById", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_appointmentId_hospitalId_fkey" FOREIGN KEY ("appointmentId", "hospitalId") REFERENCES "appointments"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_finalisedById_hospitalId_fkey" FOREIGN KEY ("finalisedById", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_receiptFileId_hospitalId_fkey" FOREIGN KEY ("receiptFileId", "hospitalId") REFERENCES "file_attachments"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoiceId_hospitalId_fkey" FOREIGN KEY ("invoiceId", "hospitalId") REFERENCES "invoices"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_labOrderItemId_hospitalId_fkey" FOREIGN KEY ("labOrderItemId", "hospitalId") REFERENCES "lab_order_items"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_dispenseId_hospitalId_fkey" FOREIGN KEY ("dispenseId", "hospitalId") REFERENCES "dispenses"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_roomId_hospitalId_fkey" FOREIGN KEY ("roomId", "hospitalId") REFERENCES "rooms"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_hospitalId_fkey" FOREIGN KEY ("invoiceId", "hospitalId") REFERENCES "invoices"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_receivedById_hospitalId_fkey" FOREIGN KEY ("receivedById", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reconciledById_hospitalId_fkey" FOREIGN KEY ("reconciledById", "hospitalId") REFERENCES "users"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_invoiceId_hospitalId_fkey" FOREIGN KEY ("invoiceId", "hospitalId") REFERENCES "invoices"("id", "hospitalId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_hospitalId_fkey" FOREIGN KEY ("hospitalId") REFERENCES "hospitals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
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
