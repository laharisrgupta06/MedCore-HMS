-- M-11b scratch fixtures. Clinical source rows (visits, lab orders, dispenses) and the tax set-up are
-- fixture data inserted in replica mode (triggers off) so they can carry past dates; every M-11b test
-- then runs with all triggers on.
BEGIN;
SET LOCAL session_replication_role = replica;
INSERT INTO hospitals (id,name,code,email,phone,"licenseNumber","updatedAt",status,timezone) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','Hospital A','HA','a@x.test','1','L1',now(),'VERIFIED','Asia/Kolkata'),
 ('bbbbbbbb-0000-0000-0000-000000000001','Hospital B','HB','b@x.test','2','L2',now(),'VERIFIED','Asia/Kolkata');
INSERT INTO users (id,"hospitalId",email,"passwordHash",role,"firstName","lastName","updatedAt") VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','admin-a@x.test','x','HOSPITAL_ADMIN','A','Admin',now()),
 ('aaaaaaaa-0000-0000-0000-0000000000a2','aaaaaaaa-0000-0000-0000-000000000001','rc-a@x.test','x','RECEPTIONIST','A','Reception',now()),
 ('aaaaaaaa-0000-0000-0000-0000000000a3','aaaaaaaa-0000-0000-0000-000000000001','ac-a@x.test','x','ACCOUNTANT','A','Accounts',now()),
 ('aaaaaaaa-0000-0000-0000-0000000000a4','aaaaaaaa-0000-0000-0000-000000000001','dr-a@x.test','x','DOCTOR','A','Doctor',now()),
 ('aaaaaaaa-0000-0000-0000-0000000000a5','aaaaaaaa-0000-0000-0000-000000000001','ph-a@x.test','x','PHARMACIST','A','Pharmacy',now()),
 ('aaaaaaaa-0000-0000-0000-0000000000a6','aaaaaaaa-0000-0000-0000-000000000001','pt-a@x.test','x','PATIENT','A','Patient',now()),
 ('bbbbbbbb-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-000000000001','admin-b@x.test','x','HOSPITAL_ADMIN','B','Admin',now()),
 ('bbbbbbbb-0000-0000-0000-0000000000b2','bbbbbbbb-0000-0000-0000-000000000001','rc-b@x.test','x','RECEPTIONIST','B','Reception',now()),
 ('bbbbbbbb-0000-0000-0000-0000000000b3','bbbbbbbb-0000-0000-0000-000000000001','ac-b@x.test','x','ACCOUNTANT','B','Accounts',now()),
 ('bbbbbbbb-0000-0000-0000-0000000000b4','bbbbbbbb-0000-0000-0000-000000000001','dr-b@x.test','x','DOCTOR','B','Doctor',now()),
 ('bbbbbbbb-0000-0000-0000-0000000000b6','bbbbbbbb-0000-0000-0000-000000000001','pt-b@x.test','x','PATIENT','B','Patient',now());
INSERT INTO departments (id,"hospitalId",name,"updatedAt") VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000d0','aaaaaaaa-0000-0000-0000-000000000001','General',now()),
 ('bbbbbbbb-0000-0000-0000-0000000000d0','bbbbbbbb-0000-0000-0000-000000000001','General',now());
INSERT INTO doctors (id,"hospitalId","userId","registrationNumber",specialisation,"consultationFee","updatedAt") VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000c4','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000a4','R1','General',500,now()),
 ('bbbbbbbb-0000-0000-0000-0000000000c4','bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-0000000000b4','R2','General',400,now());
INSERT INTO patients (id,"hospitalId","userId",mrn,"dateOfBirth",gender,"updatedAt") VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000e6','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000a6','A-1','1990-01-01','FEMALE',now()),
 ('bbbbbbbb-0000-0000-0000-0000000000e6','bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-0000000000b6','B-1','1990-01-01','MALE',now());
-- Visits: A1 (consultation, lab, pharmacy), A2 (second visit), B1.
INSERT INTO appointments (id,"hospitalId","doctorId","patientId","departmentId","scheduledAt","endAt",status,"createdById","updatedAt") VALUES
 ('aaaaaaaa-0000-0000-0000-00000000a001','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000c4','aaaaaaaa-0000-0000-0000-0000000000e6','aaaaaaaa-0000-0000-0000-0000000000d0','2026-11-18 10:00+05:30','2026-11-18 10:15+05:30','COMPLETED','aaaaaaaa-0000-0000-0000-0000000000a2',now()),
 ('aaaaaaaa-0000-0000-0000-00000000a002','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000c4','aaaaaaaa-0000-0000-0000-0000000000e6','aaaaaaaa-0000-0000-0000-0000000000d0','2026-11-18 11:00+05:30','2026-11-18 11:15+05:30','COMPLETED','aaaaaaaa-0000-0000-0000-0000000000a2',now()),
 ('bbbbbbbb-0000-0000-0000-00000000a001','bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-0000000000c4','bbbbbbbb-0000-0000-0000-0000000000e6','bbbbbbbb-0000-0000-0000-0000000000d0','2026-11-18 10:00+05:30','2026-11-18 10:15+05:30','COMPLETED','bbbbbbbb-0000-0000-0000-0000000000b2',now());
INSERT INTO medical_records (id,"hospitalId","appointmentId","chiefComplaint","updatedAt") VALUES
 ('aaaaaaaa-0000-0000-0000-00000000b001','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000a001','Fever',now()),
 ('aaaaaaaa-0000-0000-0000-00000000b002','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000a002','Cough',now());
INSERT INTO lab_tests (id,"hospitalId",code,name,price,"updatedAt") VALUES
 ('aaaaaaaa-0000-0000-0000-00000000c001','aaaaaaaa-0000-0000-0000-000000000001','CBC','Complete blood count',350,now());
INSERT INTO lab_orders (id,"hospitalId","medicalRecordId","orderedById","updatedAt") VALUES
 ('aaaaaaaa-0000-0000-0000-00000000c101','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000b001','aaaaaaaa-0000-0000-0000-0000000000a4',now()),
 ('aaaaaaaa-0000-0000-0000-00000000c102','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000b002','aaaaaaaa-0000-0000-0000-0000000000a4',now());
INSERT INTO lab_order_items (id,"hospitalId","labOrderId","labTestId") VALUES
 ('aaaaaaaa-0000-0000-0000-00000000c201','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000c101','aaaaaaaa-0000-0000-0000-00000000c001'),
 ('aaaaaaaa-0000-0000-0000-00000000c202','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000c102','aaaaaaaa-0000-0000-0000-00000000c001');
INSERT INTO medicines (id,"hospitalId",name,form,strength,"reorderLevel","updatedAt") VALUES
 ('aaaaaaaa-0000-0000-0000-00000000d001','aaaaaaaa-0000-0000-0000-000000000001','Paracetamol','TABLET','500 mg',50,now()),
 ('aaaaaaaa-0000-0000-0000-00000000d002','aaaaaaaa-0000-0000-0000-000000000001','Unclassified syrup','SYRUP','100 ml',5,now());
INSERT INTO medicine_batches (id,"hospitalId","medicineId","batchNumber","manufacturedOn","expiresOn",quantity,"unitCost",mrp,"updatedAt") VALUES
 ('aaaaaaaa-0000-0000-0000-00000000d101','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000d001','P1','2026-01-01','2028-01-01',100,8,12,now()),
 ('aaaaaaaa-0000-0000-0000-00000000d102','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000d002','S1','2026-01-01','2028-01-01',100,50,90,now());
INSERT INTO prescriptions (id,"hospitalId","medicalRecordId","updatedAt") VALUES
 ('aaaaaaaa-0000-0000-0000-00000000d201','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000b001',now()),
 ('aaaaaaaa-0000-0000-0000-00000000d202','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000b002',now());
INSERT INTO prescription_items (id,"hospitalId","prescriptionId","medicineId",dosage,frequency,"durationDays",quantity) VALUES
 ('aaaaaaaa-0000-0000-0000-00000000d301','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000d201','aaaaaaaa-0000-0000-0000-00000000d001','1 tab','BD',5,10),
 ('aaaaaaaa-0000-0000-0000-00000000d302','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000d201','aaaaaaaa-0000-0000-0000-00000000d002','5 ml','BD',5,1),
 ('aaaaaaaa-0000-0000-0000-00000000d303','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000d202','aaaaaaaa-0000-0000-0000-00000000d001','1 tab','BD',5,10);
INSERT INTO dispenses (id,"hospitalId","prescriptionItemId","batchId",quantity,"dispensedById") VALUES
 ('aaaaaaaa-0000-0000-0000-00000000d401','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000d301','aaaaaaaa-0000-0000-0000-00000000d101',10,'aaaaaaaa-0000-0000-0000-0000000000a5'),
 ('aaaaaaaa-0000-0000-0000-00000000d402','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000d302','aaaaaaaa-0000-0000-0000-00000000d102',1,'aaaaaaaa-0000-0000-0000-0000000000a5'),
 ('aaaaaaaa-0000-0000-0000-00000000d403','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-00000000d303','aaaaaaaa-0000-0000-0000-00000000d101',10,'aaaaaaaa-0000-0000-0000-0000000000a5');
INSERT INTO rooms (id,"hospitalId",number,type,"dailyCharge","criticalCareUnit","updatedAt") VALUES
 ('aaaaaaaa-0000-0000-0000-00000000e001','aaaaaaaa-0000-0000-0000-000000000001','101','PRIVATE',6000,NULL,now()),
 ('aaaaaaaa-0000-0000-0000-00000000e002','aaaaaaaa-0000-0000-0000-000000000001','ICU-1','ICU',8000,NULL,now()),
 ('aaaaaaaa-0000-0000-0000-00000000e003','aaaaaaaa-0000-0000-0000-000000000001','W-1','WARD',5000,NULL,now()),
 ('aaaaaaaa-0000-0000-0000-00000000e004','aaaaaaaa-0000-0000-0000-000000000001','N-1','OTHER',9000,'NICU',now()),
 ('aaaaaaaa-0000-0000-0000-00000000e005','aaaaaaaa-0000-0000-0000-000000000001','X-1','OTHER',NULL,NULL,now());
-- Tax set-up of hospital A (regular, GSTIN 27AAPFU0939F1ZV from 1 April 2026) and of B (unregistered).
INSERT INTO tax_classifications (id,"hospitalId",name,"supplyType","hsnSac","createdById","updatedAt") VALUES
 ('11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','Healthcare services','SERVICE','999312','aaaaaaaa-0000-0000-0000-0000000000a1',now()),
 ('11111111-0000-0000-0000-000000000002','aaaaaaaa-0000-0000-0000-000000000001','Medicaments','GOODS','3004','aaaaaaaa-0000-0000-0000-0000000000a1',now()),
 ('11111111-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-000000000001','Diagnostics','SERVICE','999316','aaaaaaaa-0000-0000-0000-0000000000a1',now()),
 ('11111111-0000-0000-0000-000000000004','aaaaaaaa-0000-0000-0000-000000000001','Taxable service','SERVICE','998599','aaaaaaaa-0000-0000-0000-0000000000a1',now()),
 ('11111111-0000-0000-0000-000000000005','aaaaaaaa-0000-0000-0000-000000000001','Life-saving drugs','GOODS','3002','aaaaaaaa-0000-0000-0000-0000000000a1',now()),
 ('22222222-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-000000000001','Healthcare services','SERVICE','999312','bbbbbbbb-0000-0000-0000-0000000000b1',now());
INSERT INTO tax_classification_versions (id,"hospitalId","classificationId",treatment,"ratePercent","priceIncludesTax","effectiveFrom","createdById") VALUES
 ('11111111-0000-0000-0000-000000000101','aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000001','EXEMPT',0,false,'2026-04-01','aaaaaaaa-0000-0000-0000-0000000000a1'),
 ('11111111-0000-0000-0000-000000000102','aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000002','TAXABLE',12,true,'2026-04-01','aaaaaaaa-0000-0000-0000-0000000000a1'),
 ('11111111-0000-0000-0000-000000000112','aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000002','TAXABLE',5,true,'2026-09-22','aaaaaaaa-0000-0000-0000-0000000000a1'),
 ('11111111-0000-0000-0000-000000000103','aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000003','EXEMPT',0,false,'2026-04-01','aaaaaaaa-0000-0000-0000-0000000000a1'),
 ('11111111-0000-0000-0000-000000000104','aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000004','TAXABLE',18,false,'2026-04-01','aaaaaaaa-0000-0000-0000-0000000000a1'),
 ('11111111-0000-0000-0000-000000000105','aaaaaaaa-0000-0000-0000-000000000001','11111111-0000-0000-0000-000000000005','NIL_RATED',0,false,'2026-04-01','aaaaaaaa-0000-0000-0000-0000000000a1'),
 ('22222222-0000-0000-0000-000000000101','bbbbbbbb-0000-0000-0000-000000000001','22222222-0000-0000-0000-000000000001','EXEMPT',0,false,'2026-04-01','bbbbbbbb-0000-0000-0000-0000000000b1');
INSERT INTO hospital_tax_defaults ("hospitalId",kind,"classificationId","updatedById","updatedAt") VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','CONSULTATION','11111111-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000a1',now()),
 ('aaaaaaaa-0000-0000-0000-000000000001','LAB','11111111-0000-0000-0000-000000000003','aaaaaaaa-0000-0000-0000-0000000000a1',now()),
 ('bbbbbbbb-0000-0000-0000-000000000001','CONSULTATION','22222222-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-0000000000b1',now());
UPDATE medicines SET "taxClassificationId" = '11111111-0000-0000-0000-000000000002' WHERE id = 'aaaaaaaa-0000-0000-0000-00000000d001';
INSERT INTO hospital_gst_registrations (id,"hospitalId","registrationType",gstin,"legalName","stateCode","effectiveFrom","attestedById") VALUES
 ('33333333-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-000000000001','REGULAR','27AAPFU0939F1ZV','Hospital A LLP','27','2026-04-01','aaaaaaaa-0000-0000-0000-0000000000a1');
UPDATE hospitals SET "taxTimezoneLockedAt" = '2026-04-01', "taxSetupConfirmedAt" = '2026-04-01',
       "taxSetupConfirmedById" = CASE id WHEN 'aaaaaaaa-0000-0000-0000-000000000001' THEN 'aaaaaaaa-0000-0000-0000-0000000000a1'::uuid ELSE 'bbbbbbbb-0000-0000-0000-0000000000b1'::uuid END;
COMMIT;
