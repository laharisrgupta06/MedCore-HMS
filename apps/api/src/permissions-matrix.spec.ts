/**
 * ROLE-011: the permissions matrix (docs/permissions-matrix.csv) is the test specification.
 * Every route registered in the application must appear in the matrix, and every cell is checked
 * against the real guard pipeline with a signed-in user of that role:
 *   PUBLIC → no guard rejects an anonymous caller     ALLOW → never 401/403 for that role
 *   OWN    → allowed on the caller's own record, 403/404 on someone else's     DENY → 403
 */
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ALL_ROLES, AUTH_COOKIES, CSRF_HEADER, type Role } from '@medcore/types';
import type { User } from '@prisma/client';
import request from 'supertest';
import { DevSmsInboxAdapter } from './infra/messaging/dev-sms-inbox.adapter';
import { DevSmsInboxController } from './infra/messaging/dev-sms-inbox.controller';
import { HealthController } from './modules/health/health.controller';
import { HealthService } from './modules/health/health.service';
import { UsersModule } from './modules/users/users.module';
import { DepartmentsModule } from './modules/departments/departments.module';
import { DoctorsModule } from './modules/doctors/doctors.module';
import { FacilitiesModule } from './modules/facilities/facilities.module';
import { HospitalsModule } from './modules/hospitals/hospitals.module';
import { PatientsModule } from './modules/patients/patients.module';
import { StaffModule } from './modules/staff/staff.module';
import { SchedulingModule } from './modules/appointments/appointments.module';
import { EmrModule } from './modules/emr/emr.module';
import { MedicinesModule } from './modules/medicines/medicines.module';
import { TaxModule } from './modules/tax/tax.module';
import { BillingModule } from './modules/billing/billing.module';
import { PharmacyModule } from './modules/pharmacy/pharmacy.module';
import { PrescriptionsModule } from './modules/prescriptions/prescriptions.module';
import { LabModule } from './modules/lab/lab.module';
import { StorageService } from './infra/storage/storage.service';
import { createAuthTestApp, type AuthTestApp } from './testing/auth-test-app';

type Cell = 'PUBLIC' | 'ALLOW' | 'OWN' | 'DENY';
interface Row {
  method: string;
  path: string;
  cells: Record<Role, Cell>;
}

const CSV = resolve(__dirname, '../../../docs/permissions-matrix.csv');
const CSRF = 'm'.repeat(43);

function readMatrix(): Row[] {
  const [header, ...lines] = readFileSync(CSV, 'utf8').trim().split('\n');
  const cols = header!.split(',');
  return lines.map((line) => {
    const v = line.split(',');
    const cells = Object.fromEntries(
      ALL_ROLES.map((r) => [r, v[cols.indexOf(r)] as Cell]),
    ) as Record<Role, Cell>;
    return { method: v[0]!, path: v[1]!, cells };
  });
}

describe('Permissions matrix (ROLE-011)', () => {
  const matrix = readMatrix();
  let t: AuthTestApp;
  const users = {} as Record<Role, User>;
  const peers = {} as Record<Role, User>;

  beforeAll(async () => {
    t = await createAuthTestApp(
      { AUTH_THROTTLE_LIMIT: '100000' },
      {
        modules: [
          UsersModule,
          HospitalsModule,
          DepartmentsModule,
          StaffModule,
          DoctorsModule,
          PatientsModule,
          FacilitiesModule,
          SchedulingModule,
          EmrModule,
          MedicinesModule,
          TaxModule,
          BillingModule,
          PrescriptionsModule,
          LabModule,
          PharmacyModule,
        ],
        controllers: [HealthController, DevSmsInboxController],
        providers: [
          { provide: HealthService, useValue: { check: () => Promise.resolve({ status: 'ok' }) } },
          DevSmsInboxAdapter,
        ],
      },
    );
    const h = t.prisma.addHospital({ code: 'MATRIXA' });
    const other = t.prisma.addHospital({ code: 'MATRIXB' });
    ids.hospital = [h.id, other.id];
    const push = (model: string, row: Record<string, unknown>) => {
      const r = {
        id: randomUUID(),
        hospitalId: h.id,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...row,
      };
      t.prisma.rows(model).push(r);
      return r.id as string;
    };
    const dept = push('Department', { name: 'Matrix', description: null });
    ids.department = [
      dept,
      push('Department', { name: 'Other', description: null, hospitalId: other.id }),
    ];
    const room = push('Room', {
      number: '1',
      type: 'WARD',
      floor: null,
      dailyCharge: null,
      departmentId: null,
    });
    ids.room = [room, room];
    const bed = push('Bed', { roomId: room, label: 'A', status: 'AVAILABLE' });
    ids.bed = [bed, bed];
    for (const role of ALL_ROLES) {
      const hospitalId = role === 'SUPER_ADMIN' ? null : h.id;
      users[role] = t.prisma.addUser({ role, hospitalId, firstName: role });
      // A second account per role in the same hospital: the "someone else" for OWN checks.
      peers[role] = t.prisma.addUser({ role, hospitalId, firstName: `${role}-peer` });
      for (const u of [users[role], peers[role]]) {
        if (role === 'DOCTOR')
          profile.set(
            u.id,
            push('Doctor', {
              userId: u.id,
              registrationNumber: 'R',
              specialisation: 'General',
              qualification: null,
              consultationFee: 500,
              bio: null,
              signatureFileId: null,
              deletedAt: null,
            }),
          );
        else if (role === 'PATIENT')
          profile.set(
            u.id,
            push('Patient', {
              userId: u.id,
              mrn: `MRN-${u.id.slice(0, 6)}`,
              dateOfBirth: new Date('1990-01-01'),
              gender: 'OTHER',
              bloodGroup: null,
              emergencyContactName: null,
              emergencyContactPhone: null,
              deletedAt: null,
            }),
          );
        else if (role !== 'SUPER_ADMIN')
          push('StaffProfile', {
            userId: u.id,
            departmentId: null,
            employeeCode: null,
            designation: null,
            // The primary lab technician is senior, so approval routes test the role, not seniority.
            isSeniorLabTechnician: u === users.LAB_TECHNICIAN,
          });
      }
    }
    const later = new Date(Date.now() + 7 * 86_400_000);
    const docOf = (u: User) => profile.get(u.id)!;
    for (const [key, d] of [
      ['own', users.DOCTOR],
      ['peer', peers.DOCTOR],
    ] as const) {
      sched.set(
        key,
        push('DoctorSchedule', {
          doctorId: docOf(d),
          departmentId: dept,
          weekday: 'MONDAY',
          startTime: new Date('1970-01-01T09:00:00Z'),
          endTime: new Date('1970-01-01T12:00:00Z'),
          slotMinutes: 30,
          validFrom: new Date('2020-01-01'),
          validTo: null,
          isActive: true,
        }),
      );
      exc.set(
        key,
        push('ScheduleException', {
          doctorId: docOf(d),
          date: later,
          type: 'LEAVE',
          startTime: null,
          endTime: null,
          reason: null,
        }),
      );
    }
    const appt = (doctor: User, patient: User, hours: number) =>
      push('Appointment', {
        doctorId: docOf(doctor),
        patientId: profile.get(patient.id)!,
        departmentId: dept,
        scheduledAt: new Date(later.getTime() + hours * 3_600_000),
        endAt: new Date(later.getTime() + (hours + 0.5) * 3_600_000),
        status: 'PENDING',
        type: 'REGULAR',
        reason: null,
        cancellationReason: null,
        createdById: patient.id,
        deletedAt: null,
      });
    appts.set('own', appt(users.DOCTOR, users.PATIENT, 1));
    appts.set('peer', appt(peers.DOCTOR, peers.PATIENT, 2));
    // Phase 4: one record per appointment above (own = users.DOCTOR treating users.PATIENT).
    const storage = t.app.get(StorageService);
    for (const key of ['own', 'peer'] as const) {
      const a = t.prisma.rows('Appointment').find((r) => r.id === appts.get(key))!;
      a.status = 'IN_PROGRESS';
      const rec = push('MedicalRecord', {
        appointmentId: a.id,
        chiefComplaint: 'Matrix',
        presentingSymptoms: null,
        treatmentPlanEnc: null,
        status: 'OPEN',
        closedAt: null,
      });
      records.set(key, rec);
      labOrders.set(
        key,
        push('LabOrder', {
          medicalRecordId: rec,
          orderedById: key === 'own' ? users.DOCTOR.id : peers.DOCTOR.id,
          status: 'APPROVED',
          priority: 'ROUTINE',
          reportFileId: null,
          amendsLabOrderId: null,
        }),
      );
      rxs.set(
        key,
        push('Prescription', {
          medicalRecordId: rec,
          status: 'ISSUED',
          notes: null,
          pdfFileId: null,
          issuedAt: new Date(),
        }),
      );
      const storageKey = `${h.id}/records/${rec}/matrix-${key}.pdf`;
      await storage.put(storageKey, Buffer.from('%PDF-1.4 matrix'));
      files.set(
        key,
        push('FileAttachment', {
          patientId: a.patientId,
          medicalRecordId: rec,
          purpose: 'MEDICAL_ATTACHMENT',
          storageKey,
          originalName: 'scan.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 15,
          sha256: '0'.repeat(64),
          uploadedById: users.DOCTOR.id,
        }),
      );
    }
    labTestId = push('LabTest', {
      code: 'MX',
      name: 'Matrix test',
      category: 'LABORATORY',
      unit: null,
      sampleType: null,
      price: 1,
      isActive: true,
    });
    medicineId = push('Medicine', {
      name: 'Matrixol',
      genericName: null,
      form: 'TABLET',
      strength: '10 mg',
      reorderLevel: 5,
      isActive: true,
      lowStockSince: null,
    });
    batchId = push('MedicineBatch', {
      medicineId,
      batchNumber: 'MX-B1',
      manufacturedOn: new Date('2026-01-01'),
      expiresOn: new Date('2035-01-01'),
      quantity: 100,
      unitCost: 1,
      mrp: 2,
      status: 'ACTIVE',
      supplierId: null,
      receivedAt: new Date(),
    });
    for (const u of [users.PATIENT, peers.PATIENT])
      allergyOf.set(
        profile.get(u.id)!,
        push('Allergy', {
          patientId: profile.get(u.id)!,
          kind: 'ALLERGY',
          substance: 'Peanut',
          reaction: null,
          severity: null,
          recordedById: users.DOCTOR.id,
          recordedAt: new Date(),
          supersedesId: null,
          correctionReason: null,
          status: 'ACTIVE',
          statusReason: null,
          statusChangedById: null,
          statusChangedAt: null,
        }),
      );
  });
  const records = new Map<string, string>();
  const rxs = new Map<string, string>();
  const labOrders = new Map<string, string>();
  let labTestId = '';
  let medicineId = '';
  let batchId = '';
  const files = new Map<string, string>();
  const allergyOf = new Map<string, string>();
  const sched = new Map<string, string>();
  const exc = new Map<string, string>();
  const appts = new Map<string, string>();

  /** Path parameters: [the caller's own or a same-hospital record, someone else's record]. */
  const ids: Record<string, [string, string]> = {};
  const profile = new Map<string, string>();
  function params(role: Role, path: string): [string, string] {
    const admin = role === 'SUPER_ADMIN' || role === 'HOSPITAL_ADMIN';
    if (path.startsWith('/api/hospitals/:id')) return ids.hospital!;
    if (path.startsWith('/api/departments/')) return ids.department!;
    if (path.startsWith('/api/rooms/')) return ids.room!;
    if (path.startsWith('/api/beds/')) return ids.bed!;
    if (path.startsWith('/api/staff/')) return [peers.NURSE.id, peers.RECEPTIONIST.id];
    const pair = (m: Map<string, string>, mine: boolean): [string, string] =>
      mine ? [m.get('own')!, m.get('peer')!] : [m.get('own')!, m.get('peer')!];
    if (path.startsWith('/api/schedules/')) return pair(sched, true);
    if (path.startsWith('/api/exceptions/')) return pair(exc, true);
    if (path.startsWith('/api/appointments/')) return pair(appts, true);
    if (path.startsWith('/api/medical-records/record/')) return pair(records, true);
    if (path.startsWith('/api/files/')) return pair(files, true);
    if (path.startsWith('/api/prescriptions/')) return pair(rxs, true);
    if (path.startsWith('/api/pharmacy/prescriptions/')) return pair(rxs, true);
    if (path.startsWith('/api/batches/')) return [batchId, batchId];
    if (path.startsWith('/api/lab-orders/')) return pair(labOrders, true);
    if (path.startsWith('/api/lab-tests/')) return [labTestId, labTestId];
    if (path.startsWith('/api/medicines/')) return [medicineId, medicineId];
    if (path.startsWith('/api/medical-records/:patientId')) {
      const own = role === 'PATIENT' ? users.PATIENT.id : peers.PATIENT.id;
      return [profile.get(own)!, profile.get(peers.PATIENT.id)!];
    }
    if (path.startsWith('/api/doctors/')) {
      const own = role === 'DOCTOR' ? users.DOCTOR.id : peers.DOCTOR.id;
      return [
        profile.get(own)!,
        profile.get(role === 'DOCTOR' ? peers.DOCTOR.id : users.DOCTOR.id)!,
      ];
    }
    if (path.startsWith('/api/patients/')) {
      const own = role === 'PATIENT' ? users.PATIENT.id : peers.PATIENT.id;
      return [profile.get(own)!, profile.get(peers.PATIENT.id)!];
    }
    return [admin ? peers.NURSE.id : users[role].id, peers[role].id];
  }
  const fill = (path: string, id: string) =>
    path
      .replace(/:(id|userId|patientId)\b/, id)
      .replace(':kind', 'allergies')
      .replace(':entryId', allergyOf.get(id) ?? id);
  afterAll(() => t.app.close());

  it('is a complete, well-formed specification of every registered route', () => {
    const allowed: Cell[] = ['PUBLIC', 'ALLOW', 'OWN', 'DENY'];
    for (const row of matrix)
      for (const role of ALL_ROLES) expect(allowed).toContain(row.cells[role]);

    const stack = (
      t.app.getHttpAdapter().getInstance() as {
        router: { stack: { route?: { path: string; methods: Record<string, boolean> } }[] };
      }
    ).router.stack;
    const registered = stack
      .filter((l) => l.route)
      .flatMap((l) =>
        Object.keys(l.route!.methods)
          .filter((m) => m !== '_all')
          .map((m) => `${m.toUpperCase()} ${l.route!.path}`),
      )
      .sort();
    const specified = matrix.map((r) => `${r.method} ${r.path}`).sort();
    expect(registered).toEqual(specified);
  });

  const call = (row: Row, path: string, token?: string) => {
    const r = request(t.app.getHttpServer())[row.method.toLowerCase() as 'get'](path);
    if (token) r.set('Authorization', `Bearer ${token}`);
    if (row.method !== 'GET')
      r.set('Cookie', `${AUTH_COOKIES.csrf}=${CSRF}`).set(CSRF_HEADER, CSRF);
    // Valid bodies where the route has required fields, so ownership (not validation) is what is tested.
    const BODIES: Record<string, object> = {
      'POST /api/doctors/:id/schedules': {
        departmentId: ids.department![0],
        weekday: 'TUESDAY',
        startTime: '14:00',
        endTime: '15:00',
        slotMinutes: 30,
        validFrom: '2030-01-01',
      },
      'POST /api/doctors/:id/exceptions': { date: '2030-01-02', type: 'LEAVE' },
      'PATCH /api/appointments/:id/status': { status: 'CANCELLED', reason: 'Matrix check' },
      'POST /api/appointments/:id/reschedule': { scheduledAt: '2030-01-07T03:30:00.000Z' },
      'POST /api/medical-records': { appointmentId: appts.get('own'), chiefComplaint: 'Matrix' },
      'PATCH /api/medical-records/record/:id': { chiefComplaint: 'Matrix check' },
      'POST /api/medical-records/record/:id/entries': { body: 'Matrix note' },
      'POST /api/medical-records/record/:id/vitals': { pulse: 80 },
      'POST /api/medical-records/record/:id/diagnoses': {
        description: 'Matrix',
        type: 'DIFFERENTIAL',
      },
      'POST /api/patients/:patientId/allergies': { kind: 'ALLERGY', substance: 'Dust' },
      'POST /api/patients/:patientId/medications': { medicineName: 'Matrix' },
      'POST /api/patients/:patientId/vaccinations': {
        vaccineName: 'Matrix',
        administeredOn: '2020-01-01',
        batchNumber: 'B1',
      },
      'POST /api/patients/:patientId/family-history': { condition: 'CARDIAC', present: true },
      'PATCH /api/patients/:patientId/:kind/:entryId/status': { status: 'RESOLVED' },
      'POST /api/medicines': { name: 'Matrix', form: 'SYRUP', strength: '5 ml', reorderLevel: 1 },
      'PATCH /api/medicines/:id': { reorderLevel: 7 },
      'POST /api/medicines/:id/batches': {
        batchNumber: 'MX-B2',
        manufacturedOn: '2026-01-01',
        expiresOn: '2035-01-01',
        quantity: 5,
        unitCost: 1,
        mrp: 2,
      },
      'PATCH /api/batches/:id/quarantine': { reason: 'Matrix check' },
      'POST /api/batches/:id/adjustments': { quantity: 1, reason: 'Matrix check' },
      'POST /api/pharmacy/prescriptions/:id/dispense': {
        items: [{ itemId: '00000000-0000-4000-8000-000000000000', quantity: 1 }],
      },
      'POST /api/prescriptions': {
        medicalRecordId: records.get('own'),
        items: [{ medicineId, dosage: '10 mg', frequency: 'OD', durationDays: 1, quantity: 1 }],
      },
      'PATCH /api/prescriptions/:id/cancel': { reason: 'Matrix check' },
      'POST /api/lab-tests': { code: 'MX2', name: 'Matrix two', category: 'LABORATORY', price: 1 },
      'PATCH /api/lab-tests/:id': { price: 2 },
      'POST /api/lab-orders': { medicalRecordId: records.get('own'), testIds: [labTestId] },
      'PATCH /api/lab-orders/:id/cancel': { reason: 'Matrix check' },
      'PATCH /api/lab-orders/:id/result': { results: [] },
      'PATCH /api/lab-orders/:id/reject': { reason: 'Matrix check' },
      'POST /api/lab-orders/:id/amend': { reason: 'Matrix check' },
    };
    return row.method === 'GET' ? r : r.send(BODIES[`${row.method} ${row.path}`] ?? {});
  };

  for (const row of readMatrix()) {
    for (const role of ALL_ROLES) {
      const cell = row.cells[role];
      it(`${row.method} ${row.path} as ${role}: ${cell}`, async () => {
        const self = users[role];
        const [own, others] = params(role, row.path);
        const path = fill(row.path, own);
        if (cell === 'PUBLIC') {
          // Guards let anonymous callers through; the endpoint may still answer with its own
          // error (refresh without a cookie is REFRESH_TOKEN_INVALID), never a guard rejection.
          const res = await call(row, path);
          expect(['UNAUTHENTICATED', 'FORBIDDEN', 'CSRF_TOKEN_INVALID']).not.toContain(
            res.body.error?.code,
          );
          return;
        }
        const token = await t.tokenFor(self);
        if (cell === 'DENY') {
          const res = await call(row, path, token);
          expect(res.status).toBe(403);
          expect(res.body.error.code).toBe('FORBIDDEN');
          return;
        }
        // ALLOW and OWN: the guard pipeline lets the request through.
        const res = await call(row, path, token);
        expect([401, 403]).not.toContain(res.status);
        // Anonymous callers are always rejected on non-public routes.
        expect((await call(row, path)).status).toBe(401);
        if (cell === 'OWN') {
          const other = await call(row, fill(row.path, others), token);
          expect([403, 404]).toContain(other.status);
        }
      });
    }
  }
});
