/**
 * In-memory stand-in for the subset of PrismaClient used by the auth module, for unit tests only.
 * It enforces the unique constraints the auth code relies on (users.email, patients(hospitalId, mrn)).
 * Real PostgreSQL behaviour is covered by the integration tests (T-MIG-*, T-AUTH-* on macOS).
 */
import { randomUUID } from 'node:crypto';
import { Prisma, type AuditLog, type Hospital, type Patient, type User } from '@prisma/client';

function unique(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

type Where = { id?: string; email?: string; code?: string };

export class FakePrisma {
  hospitals: Hospital[] = [];
  users: User[] = [];
  patients: Patient[] = [];
  audit: AuditLog[] = [];
  /** Forces the next N patient.create calls to fail with an MRN collision. */
  mrnCollisions = 0;

  addHospital(p: Partial<Hospital> = {}): Hospital {
    const h = {
      id: randomUUID(),
      name: 'City Care Hospital',
      code: 'CITYCARE',
      email: 'admin@citycare.test',
      phone: '+910000000000',
      licenseNumber: 'LIC-1',
      status: 'VERIFIED',
      verifiedAt: new Date(),
      timezone: 'Asia/Kolkata',
      currency: 'INR',
      defaultSlotMinutes: 30,
      subscriptionPlan: null,
      subscriptionStatus: 'TRIAL',
      addressId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      taxRatePercent: new Prisma.Decimal(0),
      invoicePrefix: 'INV',
      ...p,
    } as Hospital;
    this.hospitals.push(h);
    return h;
  }

  private find<T extends Record<string, unknown>>(rows: T[], where: Where): T | null {
    return (
      rows.find((r) =>
        Object.entries(where).every(([k, v]) => v === undefined || r[k as keyof T] === v),
      ) ?? null
    );
  }

  private withHospital(u: User | null, include?: { hospital?: boolean }) {
    if (!u) return null;
    return include?.hospital
      ? { ...u, hospital: this.hospitals.find((h) => h.id === u.hospitalId) ?? null }
      : { ...u };
  }

  hospital = {
    findUnique: ({ where }: { where: Where }) => Promise.resolve(this.find(this.hospitals, where)),
  };

  user = {
    findUnique: ({ where, include }: { where: Where; include?: { hospital?: boolean } }) =>
      Promise.resolve(this.withHospital(this.find(this.users, where), include)),
    findUniqueOrThrow: ({ where }: { where: Where }) => {
      const u = this.find(this.users, where);
      return u ? Promise.resolve({ ...u }) : Promise.reject(new Error('Not found'));
    },
    create: ({ data }: { data: Partial<User> }) => {
      if (this.users.some((u) => u.email === data.email)) return Promise.reject(unique(['email']));
      const u = {
        id: randomUUID(),
        hospitalId: null,
        phone: null,
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
        isActive: true,
        lastLoginAt: null,
        deletedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      } as User;
      this.users.push(u);
      return Promise.resolve({ ...u });
    },
    update: ({ where, data }: { where: Where; data: Partial<User> }) => {
      const u = this.find(this.users, where);
      if (!u) return Promise.reject(new Error('Not found'));
      Object.assign(u, data, { updatedAt: new Date() });
      return Promise.resolve({ ...u });
    },
  };

  patient = {
    count: ({ where }: { where: { hospitalId: string } }) =>
      Promise.resolve(this.patients.filter((p) => p.hospitalId === where.hospitalId).length),
    create: ({ data }: { data: Partial<Patient> }) => {
      if (this.mrnCollisions > 0) {
        this.mrnCollisions--;
        return Promise.reject(unique(['hospitalId', 'mrn']));
      }
      if (this.patients.some((p) => p.hospitalId === data.hospitalId && p.mrn === data.mrn))
        return Promise.reject(unique(['hospitalId', 'mrn']));
      const p = {
        id: randomUUID(),
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      } as Patient;
      this.patients.push(p);
      return Promise.resolve(p);
    },
  };

  auditLog = {
    create: ({ data }: { data: Partial<AuditLog> }) => {
      const a = { id: randomUUID(), createdAt: new Date(), ...data } as AuditLog;
      this.audit.push(a);
      return Promise.resolve(a);
    },
  };

  /** Rolls back users and patients created inside a failed transaction. */
  async $transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    const users = [...this.users];
    const patients = [...this.patients];
    try {
      return await fn(this);
    } catch (e) {
      this.users = users;
      this.patients = patients;
      throw e;
    }
  }

  actions(): string[] {
    return this.audit.map((a) => a.action);
  }
}
