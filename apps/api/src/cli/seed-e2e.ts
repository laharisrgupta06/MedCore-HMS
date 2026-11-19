/**
 * Seeds the disposable E2E database (DEC-061). Run through `pnpm e2e:db:prepare`, which recreates
 * medcore_e2e first; it can also be run again on its own and then changes nothing.
 *
 * Creates two verified hospitals, one signed-in-ready account per role, a senior lab technician,
 * a doctor with a weekly schedule, and patients in both hospitals (two in hospital A, so patient
 * isolation can be tested). Clinical and billing scenarios are created through the real API by
 * the tests themselves, so business rules are exercised, not bypassed.
 *
 * Safety: refuses to run unless DATABASE_URL names exactly medcore_e2e, MEDCORE_E2E=1 and
 * NODE_ENV is not production. The shared password comes from E2E_PASSWORD (set by the owner in
 * .env) and is never printed or stored in the repository.
 */
import { checkPassword } from '@medcore/types';
import { Prisma, PrismaClient } from '@prisma/client';
import { hash } from 'bcryptjs';
import { BCRYPT_COST } from '../modules/auth/password.service';
import { formatMrn } from '../modules/auth/mrn';

export const E2E_DATABASE = 'medcore_e2e';

/** Throws unless every safety condition holds. Exported for tests. */
export function assertSafeE2eTarget(env: NodeJS.ProcessEnv): void {
  const url = env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set.');
  const name = decodeURIComponent(new URL(url).pathname.replace(/^\//, ''));
  if (name !== E2E_DATABASE) {
    throw new Error(`Refusing to seed: the database is "${name}", not "${E2E_DATABASE}".`);
  }
  if (env.MEDCORE_E2E !== '1') throw new Error('Refusing to seed: MEDCORE_E2E is not set.');
  if (env.NODE_ENV === 'production') throw new Error('Refusing to seed in production.');
}

/** Account e-mail for a role in a hospital ("a" or "b"); the tests use the same function. */
export const e2eEmail = (role: string, hospital: 'a' | 'b', n = 1): string =>
  `e2e-${role.toLowerCase().replace(/_/g, '-')}${n > 1 ? `-${n}` : ''}-${hospital}@medcore.test`;

const ids = {
  hospital: {
    a: 'e2e00000-0000-4000-8000-00000000000a',
    b: 'e2e00000-0000-4000-8000-00000000000b',
  },
  department: {
    a: 'e2e00000-0000-4000-8000-0000000000da',
    b: 'e2e00000-0000-4000-8000-0000000000db',
  },
};

const STAFF_ROLES = [
  'HOSPITAL_ADMIN',
  'NURSE',
  'RECEPTIONIST',
  'LAB_TECHNICIAN',
  'PHARMACIST',
  'ACCOUNTANT',
] as const;
const WEEKDAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;
const time = (hhmm: string): Date => new Date(`1970-01-01T${hhmm}:00.000Z`);

export async function seedE2e(
  prisma: PrismaClient,
  password: string,
): Promise<'seeded' | 'already-seeded'> {
  if (await prisma.hospital.findUnique({ where: { id: ids.hospital.a }, select: { id: true } })) {
    return 'already-seeded';
  }
  const passwordHash = await hash(password, BCRYPT_COST);
  const now = new Date();
  const year = now.getUTCFullYear();
  const yesterday = new Date(Date.UTC(year, now.getUTCMonth(), now.getUTCDate() - 1));

  await prisma.user.create({
    data: {
      email: 'e2e-super-admin@medcore.test',
      passwordHash,
      role: 'SUPER_ADMIN',
      firstName: 'Esha',
      lastName: 'Admin',
      emailVerifiedAt: now,
    },
  });

  for (const h of ['a', 'b'] as const) {
    const hospitalId = ids.hospital[h];
    const departmentId = ids.department[h];
    await prisma.hospital.create({
      data: {
        id: hospitalId,
        name: `E2E ${h.toUpperCase()} General Hospital`,
        code: `E2E-${h.toUpperCase()}`,
        email: `e2e-hospital-${h}@medcore.test`,
        phone: '+910000000000',
        licenseNumber: `E2E-LIC-${h.toUpperCase()}`,
        status: 'VERIFIED',
        verifiedAt: now,
      },
    });
    await prisma.department.create({
      data: { id: departmentId, hospitalId, name: 'General Medicine' },
    });

    const user = (role: Prisma.UserCreateInput['role'], first: string, n = 1) => ({
      hospitalId,
      email: e2eEmail(role, h, n),
      passwordHash,
      role,
      firstName: first,
      lastName: `Test${h.toUpperCase()}`,
      emailVerifiedAt: now,
    });

    // Each account and its profile in one transaction: the role/profile trigger checks at commit.
    for (const role of STAFF_ROLES) {
      await prisma.$transaction(async (tx) => {
        const u = await tx.user.create({ data: user(role, 'Staff') });
        await tx.staffProfile.create({
          data: {
            hospitalId,
            userId: u.id,
            departmentId,
            isSeniorLabTechnician: role === 'LAB_TECHNICIAN',
          },
        });
      });
    }

    await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: user('DOCTOR', 'Dev') });
      const d = await tx.doctor.create({
        data: {
          hospitalId,
          userId: u.id,
          registrationNumber: `E2E-REG-${h.toUpperCase()}`,
          specialisation: 'General Medicine',
          consultationFee: new Prisma.Decimal('500.00'),
        },
      });
      await tx.doctorDepartment.create({ data: { hospitalId, doctorId: d.id, departmentId } });
      for (const weekday of WEEKDAYS) {
        await tx.doctorSchedule.create({
          data: {
            hospitalId,
            doctorId: d.id,
            departmentId,
            weekday,
            startTime: time('09:00'),
            endTime: time('17:00'),
            slotMinutes: 30,
            validFrom: yesterday,
          },
        });
      }
    });

    const patients = h === 'a' ? 2 : 1;
    for (let n = 1; n <= patients; n++) {
      await prisma.$transaction(async (tx) => {
        const u = await tx.user.create({
          data: {
            ...user('PATIENT', n === 1 ? 'Asha' : 'Ravi', n),
            phone: `+9190000000${h === 'a' ? 1 : 3}${n}`,
            phoneVerifiedAt: now,
          },
        });
        await tx.patient.create({
          data: {
            hospitalId,
            userId: u.id,
            mrn: formatMrn(year, n),
            dateOfBirth: new Date('1990-01-01'),
            gender: 'UNDISCLOSED',
          },
        });
      });
    }
  }
  return 'seeded';
}

async function main(): Promise<void> {
  assertSafeE2eTarget(process.env);
  const password = process.env.E2E_PASSWORD ?? '';
  const problem = checkPassword(password, 'e2e-super-admin@medcore.test');
  if (problem) throw new Error(`E2E_PASSWORD in .env is not usable: ${problem}`);
  const prisma = new PrismaClient();
  try {
    const result = await seedE2e(prisma, password);
    process.stdout.write(
      result === 'seeded' ? 'E2E seed created.\n' : 'E2E seed already present; nothing changed.\n',
    );
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e: Error) => {
    console.error(e.message);
    process.exit(1);
  });
}
