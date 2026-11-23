BEGIN;
-- Two hospitals (A in Asia/Kolkata, B in Asia/Kolkata), admins, and Phase 2/6/7 rows.
INSERT INTO hospitals (id,name,code,email,phone,"licenseNumber","updatedAt",status) VALUES
 ('aaaaaaaa-0000-0000-0000-000000000001','Hospital A','HA','a@x.test','1','L1',now(),'VERIFIED'),
 ('bbbbbbbb-0000-0000-0000-000000000001','Hospital B','HB','b@x.test','2','L2',now(),'VERIFIED');
INSERT INTO users (id,"hospitalId",email,"passwordHash",role,"firstName","lastName","updatedAt") VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000a1','aaaaaaaa-0000-0000-0000-000000000001','admin-a@x.test','x','HOSPITAL_ADMIN','A','Admin',now()),
 ('bbbbbbbb-0000-0000-0000-0000000000b1','bbbbbbbb-0000-0000-0000-000000000001','admin-b@x.test','x','HOSPITAL_ADMIN','B','Admin',now());
INSERT INTO staff_profiles (id,"hospitalId","userId","updatedAt") VALUES
 ('aaaaaaaa-0000-0000-0000-0000000000f1','aaaaaaaa-0000-0000-0000-000000000001','aaaaaaaa-0000-0000-0000-0000000000a1',now()),
 ('bbbbbbbb-0000-0000-0000-0000000000f1','bbbbbbbb-0000-0000-0000-000000000001','bbbbbbbb-0000-0000-0000-0000000000b1',now());
INSERT INTO lab_tests (id,"hospitalId",code,name,price,"updatedAt") VALUES
 ('aaaaaaaa-0000-0000-0000-00000000c001','aaaaaaaa-0000-0000-0000-000000000001','CBC','Complete blood count',350,now());
INSERT INTO medicines (id,"hospitalId",name,form,strength,"reorderLevel","updatedAt") VALUES
 ('aaaaaaaa-0000-0000-0000-00000000d001','aaaaaaaa-0000-0000-0000-000000000001','Paracetamol','TABLET','500 mg',50,now());
INSERT INTO rooms (id,"hospitalId",number,type,"dailyCharge","updatedAt") VALUES
 ('aaaaaaaa-0000-0000-0000-00000000e001','aaaaaaaa-0000-0000-0000-000000000001','101','PRIVATE',6000,now()),
 ('aaaaaaaa-0000-0000-0000-00000000e002','aaaaaaaa-0000-0000-0000-000000000001','ICU-1','ICU',8000,now());
COMMIT;
