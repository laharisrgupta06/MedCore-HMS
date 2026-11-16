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
            isSeniorLabTechnician: false,
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
  });
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
  const fill = (path: string, id: string) => path.replace(/:(id|userId)\b/, id);
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
