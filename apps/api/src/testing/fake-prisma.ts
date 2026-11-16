/**
 * In-memory stand-in for the subset of PrismaClient used by the auth and users modules, for unit
 * tests only. Supports equality / null / contains (insensitive) / in / OR / AND filters, ordering,
 * paging, the `include` relations the services use, query extensions ($extends with
 * $allModels.$allOperations, used by the tenant client) and the unique constraints the code relies
 * on (users.email, patients(hospitalId, mrn)). Real PostgreSQL behaviour is covered by the
 * integration tests (T-MIG-*, T-AUTH-INT-001 on macOS).
 */
import { randomUUID } from 'node:crypto';
import { Prisma, type AuditLog, type Hospital, type Patient, type User } from '@prisma/client';

type Row = Record<string, unknown>;
type Args = Record<string, unknown>;
type Hook = (p: {
  model: string;
  operation: string;
  args: Args;
  query: (a: Args) => Promise<unknown>;
}) => Promise<unknown>;

function unique(target: string[]): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: 'test',
    meta: { target },
  });
}

function notFound(): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Record not found', {
    code: 'P2025',
    clientVersion: 'test',
  });
}

function same(a: unknown, b: unknown): boolean {
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return a === b;
}

function isPlain(v: unknown): v is Row {
  return typeof v === 'object' && v !== null && !(v instanceof Date) && !Array.isArray(v);
}

export function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === 'AND') return (cond as Row[]).every((w) => matches(row, w));
    if (key === 'OR') return (cond as Row[]).some((w) => matches(row, w));
    if (key === 'NOT') return !matches(row, cond as Row);
    const value = row[key];
    if (isPlain(cond)) {
      if ('contains' in cond) {
        const needle = String(cond.contains);
        const hay = String(value ?? '');
        return cond.mode === 'insensitive'
          ? hay.toLowerCase().includes(needle.toLowerCase())
          : hay.includes(needle);
      }
      if ('in' in cond) return (cond.in as unknown[]).some((v) => same(v, value));
      if ('equals' in cond) return same(cond.equals, value);
      if ('not' in cond) return !same(cond.not, value);
      // Compound unique selector such as { id_hospitalId: { id, hospitalId } }.
      return matches(row, cond);
    }
    return same(cond, value);
  });
}

function sortRows(rows: Row[], orderBy: unknown): Row[] {
  const orders = (Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : []) as Record<
    string,
    'asc' | 'desc'
  >[];
  return [...rows].sort((a, b) => {
    for (const o of orders) {
      const [k, dir] = Object.entries(o)[0]!;
      const av = String(a[k] ?? '');
      const bv = String(b[k] ?? '');
      if (av !== bv) return (av < bv ? -1 : 1) * (dir === 'desc' ? -1 : 1);
    }
    return 0;
  });
}

const MODEL_OF: Record<string, string> = {
  hospital: 'Hospital',
  user: 'User',
  patient: 'Patient',
  auditLog: 'AuditLog',
};

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

  /** Inserts a user directly (test fixture), with sensible defaults. */
  addUser(p: Partial<User> & Pick<User, 'role'>): User {
    const u = {
      id: randomUUID(),
      hospitalId: null,
      email: `${randomUUID()}@example.test`,
      phone: null,
      passwordHash: 'x',
      firstName: 'Test',
      lastName: 'User',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: null,
      isActive: true,
      lastLoginAt: null,
      deletedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...p,
    } as User;
    this.users.push(u);
    return u;
  }

  private table(model: string): Row[] {
    switch (model) {
      case 'Hospital':
        return this.hospitals as unknown as Row[];
      case 'User':
        return this.users as unknown as Row[];
      case 'Patient':
        return this.patients as unknown as Row[];
      case 'AuditLog':
        return this.audit as unknown as Row[];
      default:
        throw new Error(`FakePrisma: unsupported model ${model}`);
    }
  }

  private include(model: string, row: Row, include?: Row): Row {
    const out = { ...row };
    if (model === 'User' && include?.hospital)
      out.hospital = this.hospitals.find((h) => h.id === row.hospitalId) ?? null;
    if (model === 'User' && include?.patient)
      out.patient = this.patients.find((p) => p.userId === row.id) ?? null;
    return out;
  }

  private project(row: Row, select?: Row): Row {
    if (!select) return row;
    return Object.fromEntries(
      Object.keys(select)
        .filter((k) => select[k])
        .map((k) => [k, row[k]]),
    );
  }

  private checkUnique(model: string, row: Row, ignore?: Row): void {
    const rows = this.table(model).filter((r) => r !== ignore);
    if (model === 'User' && rows.some((r) => r.email === row.email)) throw unique(['email']);
    if (model === 'Hospital' && rows.some((r) => r.code === row.code)) throw unique(['code']);
    if (model === 'Patient') {
      if (this.mrnCollisions > 0) {
        this.mrnCollisions--;
        throw unique(['hospitalId', 'mrn']);
      }
      if (rows.some((r) => r.hospitalId === row.hospitalId && r.mrn === row.mrn))
        throw unique(['hospitalId', 'mrn']);
    }
  }

  private defaults(model: string): Row {
    const base = { id: randomUUID(), createdAt: new Date() };
    if (model === 'User')
      return {
        ...base,
        hospitalId: null,
        phone: null,
        emailVerifiedAt: null,
        phoneVerifiedAt: null,
        isActive: true,
        lastLoginAt: null,
        deletedAt: null,
        updatedAt: new Date(),
      };
    if (model === 'Patient') return { ...base, updatedAt: new Date(), deletedAt: null };
    return base;
  }

  /** Executes one operation on the in-memory tables. */
  private exec(model: string, op: string, a: Args): Promise<unknown> {
    const rows = this.table(model);
    const where = a.where as Row | undefined;
    const found = () => rows.find((r) => matches(r, where));
    const shape = (r: Row) =>
      this.project(
        this.include(model, r, a.include as Row | undefined),
        a.select as Row | undefined,
      );
    try {
      switch (op) {
        case 'findUnique':
        case 'findFirst': {
          const r = found();
          return Promise.resolve(r ? shape(r) : null);
        }
        case 'findUniqueOrThrow':
        case 'findFirstOrThrow': {
          const r = found();
          if (!r) throw notFound();
          return Promise.resolve(shape(r));
        }
        case 'findMany': {
          const list = sortRows(
            rows.filter((r) => matches(r, where)),
            a.orderBy,
          );
          const skip = (a.skip as number | undefined) ?? 0;
          const take = (a.take as number | undefined) ?? list.length;
          return Promise.resolve(list.slice(skip, skip + take).map(shape));
        }
        case 'count':
          return Promise.resolve(rows.filter((r) => matches(r, where)).length);
        case 'create': {
          const row = { ...this.defaults(model), ...(a.data as Row) };
          this.checkUnique(model, row);
          rows.push(row);
          return Promise.resolve(shape(row));
        }
        case 'update': {
          const r = found();
          if (!r) throw notFound();
          const next = { ...r, ...(a.data as Row) };
          this.checkUnique(model, next, r);
          Object.assign(r, a.data as Row, model === 'User' ? { updatedAt: new Date() } : {});
          return Promise.resolve(shape(r));
        }
        default:
          throw new Error(`FakePrisma: unsupported operation ${model}.${op}`);
      }
    } catch (e) {
      return Promise.reject(e);
    }
  }

  private delegate(model: string, hook?: Hook) {
    const ops = [
      'findUnique',
      'findUniqueOrThrow',
      'findFirst',
      'findFirstOrThrow',
      'findMany',
      'count',
      'create',
      'update',
    ];
    return Object.fromEntries(
      ops.map((op) => [
        op,
        (args: Args = {}) =>
          hook
            ? hook({ model, operation: op, args, query: (x) => this.exec(model, op, x) })
            : this.exec(model, op, args),
      ]),
    );
  }

  hospital = this.delegate('Hospital');
  user = this.delegate('User');
  patient = this.delegate('Patient');
  auditLog = this.delegate('AuditLog');

  /** Query extensions, as used by TenantPrismaService. */
  $extends(ext: { query?: { $allModels?: { $allOperations?: Hook } } }): unknown {
    const hook = ext.query?.$allModels?.$allOperations;
    const client: Record<string, unknown> = {};
    for (const [key, model] of Object.entries(MODEL_OF)) client[key] = this.delegate(model, hook);
    return client;
  }

  /** Rolls back users and patients created inside a failed transaction. */
  async $transaction<T>(fn: (tx: this) => Promise<T>): Promise<T> {
    const users = [...this.users];
    const patients = [...this.patients];
    try {
      return await fn(this);
    } catch (e) {
      this.users = users;
      this.patients = patients;
      // Delegates read the arrays through table(), so reassignment is visible.
      throw e;
    }
  }

  actions(): string[] {
    return this.audit.map((a) => a.action);
  }
}
