/**
 * Evaluator demo hospital: "Sunrise Multispeciality Hospital (Demo)". Run with
 *   DEMO_CONFIRM_DB=<database name> pnpm --filter @medcore/api seed:demo
 *
 * Two stages, both idempotent and both limited to the demo hospital:
 * 1. Foundation, written directly (like the E2E seed): the hospital, its departments, the sign-in
 *    accounts with their profiles, and doctor schedules. Accounts need known passwords, which the
 *    invite flow (an emailed set-password link) cannot give. Each row is looked up by its fixed id
 *    or e-mail first and created only when missing; an existing row is never changed.
 * 2. The story, through the real HTTP API as each role (tax set-up, catalogues and stock, patient
 *    registration, bookings, consultations, prescriptions, laboratory, pharmacy, invoices,
 *    payments through the development test checkout, insurance claims). Business rules, database
 *    triggers, notifications, audit entries and analytics apply exactly as for any user. The
 *    story runs once: if the demo hospital already has appointments it is skipped.
 *
 * Safety: refuses production, refuses the E2E and integration databases, requires the database
 * name to be confirmed (DEMO_CONFIRM_DB), requires a local mail server (welcome e-mails go to the
 * development inbox; demo addresses use the reserved example domain), and never deletes or
 * updates rows it did not create in this run. The password comes from DEMO_PASSWORD (.env); it is
 * never printed or stored in the repository. API dates follow the hospital's time zone; the API
 * refuses back-dated bookings, so the demo history is dated on the day the seed runs.
 */
import { randomBytes } from 'node:crypto';
import { crc32, deflateSync } from 'node:zlib';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { checkPassword } from '@medcore/types';
import { Prisma, PrismaClient, type Role } from '@prisma/client';
import { hash } from 'bcryptjs';
import { AppModule } from '../app.module';
import { configureApp } from '../app.setup';
import { localDate } from '../common/time/zoned';
import { BCRYPT_COST } from '../modules/auth/password.service';
import { formatMrn } from '../modules/auth/mrn';

export const DEMO_DOMAIN = 'demo.medcore.example';
const TZ = 'Asia/Kolkata';
const REFUSED_DATABASES = ['medcore_e2e', 'medcore_int', 'medcore_ci'];
const LOCAL_MAIL_HOSTS = ['localhost', '127.0.0.1', '::1', 'mailpit'];

/** Fixed ids (valid v4 UUIDs) so every run finds the same rows. */
const id = (n: number) => `d3e00000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;
export const DEMO_IDS = {
  hospital: id(1),
  dept: { general: id(0x11), paediatrics: id(0x12), cardiology: id(0x13), lab: id(0x14) },
} as const;

/** Throws unless every safety condition holds. Exported for tests. */
export function assertSafeDemoTarget(env: NodeJS.ProcessEnv): string {
  if (env.NODE_ENV === 'production') throw new Error('Refusing to seed demo data in production.');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not set.');
  const name = decodeURIComponent(new URL(env.DATABASE_URL).pathname.replace(/^\//, ''));
  if (REFUSED_DATABASES.includes(name))
    throw new Error(`Refusing to seed demo data into the test database "${name}".`);
  if (env.DEMO_CONFIRM_DB !== name)
    throw new Error(
      `The target database is "${name}". Rerun with DEMO_CONFIRM_DB=${name} to confirm it is the one you mean.`,
    );
  const mail = (env.SMTP_HOST ?? 'localhost').toLowerCase();
  if (!LOCAL_MAIL_HOSTS.includes(mail))
    throw new Error(
      `Refusing to seed: SMTP_HOST is "${mail}". Demo registration sends welcome e-mails; use the local development mail server.`,
    );
  if (env.PAYMENT_PROVIDER && env.PAYMENT_PROVIDER !== 'fake')
    throw new Error('Refusing to seed: payments must use the development test provider.');
  return name;
}

export const demoEmail = (local: string) => `${local}@${DEMO_DOMAIN}`;

type Account = {
  email: string;
  role: Role;
  first: string;
  last: string;
  dept?: string;
  senior?: boolean;
  canSignIn?: boolean;
};
/** The accounts evaluators sign in with (canSignIn defaults to true). */
export const DEMO_ACCOUNTS: Account[] = [
  { email: demoEmail('admin'), role: 'HOSPITAL_ADMIN', first: 'Priya', last: 'Raman' },
  {
    email: demoEmail('nurse'),
    role: 'NURSE',
    first: 'Sneha',
    last: 'Thomas',
    dept: DEMO_IDS.dept.general,
  },
  {
    email: demoEmail('reception'),
    role: 'RECEPTIONIST',
    first: 'Karthik',
    last: 'Rao',
    dept: DEMO_IDS.dept.general,
  },
  {
    email: demoEmail('lab'),
    role: 'LAB_TECHNICIAN',
    first: 'Deepa',
    last: 'Joseph',
    dept: DEMO_IDS.dept.lab,
    senior: true,
  },
  {
    email: demoEmail('lab.assistant'),
    role: 'LAB_TECHNICIAN',
    first: 'Imran',
    last: 'Sheikh',
    dept: DEMO_IDS.dept.lab,
  },
  { email: demoEmail('pharmacy'), role: 'PHARMACIST', first: 'Anil', last: 'Kumar' },
  { email: demoEmail('accounts'), role: 'ACCOUNTANT', first: 'Neha', last: 'Kapoor' },
];
type DoctorSeed = Account & {
  key: 'meera' | 'arjun' | 'kavya';
  dept: string;
  specialisation: string;
  registration: string;
  fee: string;
  hours: [string, string];
  slotMinutes: number;
};
export const DEMO_DOCTORS: DoctorSeed[] = [
  {
    key: 'meera',
    email: demoEmail('dr.meera'),
    role: 'DOCTOR',
    first: 'Meera',
    last: 'Krishnan',
    dept: DEMO_IDS.dept.general,
    specialisation: 'General Medicine',
    registration: 'DEMO-REG-1001',
    fee: '500.00',
    hours: ['08:00', '21:00'],
    slotMinutes: 15,
  },
  {
    key: 'arjun',
    email: demoEmail('dr.arjun'),
    role: 'DOCTOR',
    first: 'Arjun',
    last: 'Menon',
    dept: DEMO_IDS.dept.paediatrics,
    specialisation: 'Paediatrics',
    registration: 'DEMO-REG-1002',
    fee: '600.00',
    hours: ['09:00', '20:00'],
    slotMinutes: 20,
  },
  {
    key: 'kavya',
    email: demoEmail('dr.kavya'),
    role: 'DOCTOR',
    first: 'Kavya',
    last: 'Iyer',
    dept: DEMO_IDS.dept.cardiology,
    specialisation: 'Cardiology',
    registration: 'DEMO-REG-1003',
    fee: '900.00',
    hours: ['10:00', '18:00'],
    slotMinutes: 30,
    canSignIn: false,
  },
];
/** Patients with portal accounts (fictional people). */
export const DEMO_PORTAL_PATIENTS = [
  {
    email: demoEmail('ananya'),
    first: 'Ananya',
    last: 'Sharma',
    dob: '1992-04-18',
    gender: 'FEMALE' as const,
    phone: '+919000010001',
  },
  {
    email: demoEmail('rahul'),
    first: 'Rahul',
    last: 'Verma',
    dob: '1985-09-02',
    gender: 'MALE' as const,
    phone: '+919000010002',
  },
];

const WEEKDAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;
const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);
const log = (s: string) => process.stdout.write(`${s}\n`);

// ---------------------------------------------------------------------------------------------
// Stage 1: foundation (direct, create-if-missing)
// ---------------------------------------------------------------------------------------------

export async function seedFoundation(prisma: PrismaClient, password: string) {
  const now = new Date();
  const created: string[] = [];
  const hospitalId = DEMO_IDS.hospital;

  const existing = await prisma.hospital.findUnique({ where: { id: hospitalId } });
  if (existing && existing.code !== 'DEMOSUN')
    throw new Error('The demo hospital id is used by another hospital. Nothing was changed.');
  if (!existing) {
    await prisma.hospital.create({
      data: {
        id: hospitalId,
        name: 'Sunrise Multispeciality Hospital (Demo)',
        code: 'DEMOSUN',
        email: demoEmail('contact'),
        phone: '+919000010000',
        licenseNumber: 'DEMO-LIC-0001',
        status: 'VERIFIED',
        verifiedAt: now,
        timezone: TZ,
      },
    });
    created.push('hospital');
  }
  const departments: [string, string, string][] = [
    [DEMO_IDS.dept.general, 'General Medicine', 'Adult outpatient care and follow-up'],
    [DEMO_IDS.dept.paediatrics, 'Paediatrics', 'Children up to 16 years'],
    [DEMO_IDS.dept.cardiology, 'Cardiology', 'Heart and blood-pressure clinic'],
    [DEMO_IDS.dept.lab, 'Laboratory', 'Pathology and radiology'],
  ];
  for (const [deptId, name, description] of departments) {
    if (!(await prisma.department.findUnique({ where: { id: deptId } }))) {
      await prisma.department.create({ data: { id: deptId, hospitalId, name, description } });
      created.push(`department ${name}`);
    }
  }

  const passwordHash = await hash(password, BCRYPT_COST);
  /** Returns the user if it is already the demo account; refuses an e-mail used elsewhere. */
  const mine = async (email: string, role: Role) => {
    const u = await prisma.user.findUnique({ where: { email } });
    if (u && (u.hospitalId !== hospitalId || u.role !== role))
      throw new Error(`${email} already belongs to another account. Nothing was changed.`);
    return u;
  };
  const userData = (a: Account) => ({
    hospitalId,
    email: a.email,
    passwordHash: a.canSignIn === false ? '!' : passwordHash,
    role: a.role,
    firstName: a.first,
    lastName: a.last,
    emailVerifiedAt: now,
  });

  for (const a of DEMO_ACCOUNTS) {
    if (await mine(a.email, a.role)) continue;
    await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: userData(a) });
      await tx.staffProfile.create({
        data: {
          hospitalId,
          userId: u.id,
          departmentId: a.dept ?? null,
          isSeniorLabTechnician: a.senior === true,
        },
      });
    });
    created.push(a.email);
  }

  const validFrom = new Date(`${localDate(now, TZ)}T00:00:00.000Z`);
  validFrom.setUTCDate(validFrom.getUTCDate() - 1);
  for (const d of DEMO_DOCTORS) {
    if (await mine(d.email, 'DOCTOR')) continue;
    await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({ data: userData(d) });
      const doc = await tx.doctor.create({
        data: {
          hospitalId,
          userId: u.id,
          registrationNumber: d.registration,
          specialisation: d.specialisation,
          qualification: d.key === 'kavya' ? 'MBBS, MD, DM (Cardiology)' : 'MBBS, MD',
          bio:
            d.key === 'kavya'
              ? 'Consultant cardiologist; hypertension and heart-failure clinic.'
              : d.key === 'arjun'
                ? 'Paediatrician; childhood infections, growth and vaccination.'
                : 'Family physician; diabetes, hypertension and adult outpatient care.',
          consultationFee: new Prisma.Decimal(d.fee),
        },
      });
      await tx.doctorDepartment.create({
        data: { hospitalId, doctorId: doc.id, departmentId: d.dept },
      });
      for (const weekday of WEEKDAYS)
        await tx.doctorSchedule.create({
          data: {
            hospitalId,
            doctorId: doc.id,
            departmentId: d.dept,
            weekday,
            startTime: time(d.hours[0]),
            endTime: time(d.hours[1]),
            slotMinutes: d.slotMinutes,
            validFrom,
          },
        });
    });
    created.push(d.email);
  }

  for (const p of DEMO_PORTAL_PATIENTS) {
    if (await mine(p.email, 'PATIENT')) continue;
    await prisma.$transaction(async (tx) => {
      const u = await tx.user.create({
        data: {
          ...userData({ email: p.email, role: 'PATIENT', first: p.first, last: p.last }),
          phone: p.phone,
          phoneVerifiedAt: now,
        },
      });
      const count = await tx.patient.count({ where: { hospitalId } });
      await tx.patient.create({
        data: {
          hospitalId,
          userId: u.id,
          mrn: formatMrn(now.getUTCFullYear(), count + 1),
          dateOfBirth: new Date(`${p.dob}T00:00:00.000Z`),
          gender: p.gender,
          bloodGroup: p.first === 'Ananya' ? 'B_POSITIVE' : 'O_POSITIVE',
          emergencyContactName: p.first === 'Ananya' ? 'Rohan Sharma' : 'Pooja Verma',
          emergencyContactPhone: p.first === 'Ananya' ? '+919000010101' : '+919000010102',
        },
      });
    });
    created.push(p.email);
  }
  return created;
}

/**
 * A small greyscale PNG of a pen stroke, drawn here (no image files, no dependency). Doctors
 * upload it as their prescription signature through the real upload endpoint.
 */
export function signaturePng(seed: number): Buffer {
  const w = 240;
  const h = 60;
  const px = Buffer.alloc((w + 1) * h, 255);
  for (let y = 0; y < h; y++) px[y * (w + 1)] = 0; // filter byte: none
  for (let x = 12; x < w - 12; x++) {
    const y = Math.round(
      30 + 13 * Math.sin((x + seed * 7) / 9) * Math.cos(x / (27 + seed)) - (x - 12) / 22,
    );
    for (let dy = -1; dy <= 1; dy++)
      if (y + dy >= 0 && y + dy < h) px[(y + dy) * (w + 1) + 1 + x] = 40;
  }
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 0; // greyscale
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(px)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------------------------
// Stage 2: the story, through the HTTP API
// ---------------------------------------------------------------------------------------------

type Data = Record<string, unknown> & { id: string };

class ApiError extends Error {}

/** A signed-in role: real login (CSRF double-submit), then Bearer requests, like the web app. */
async function signIn(base: string, email: string, password: string) {
  const csrf = randomBytes(32).toString('base64url');
  const headers = (token?: string): Record<string, string> => ({
    'content-type': 'application/json',
    cookie: `mc_csrf=${csrf}`,
    'x-csrf-token': csrf,
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  });
  const call = async <T = Data>(
    method: string,
    path: string,
    body?: unknown,
    token?: string,
  ): Promise<T> => {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: headers(token),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const json = text
      ? (JSON.parse(text) as { data?: T; error?: { code: string; message: string } })
      : {};
    if (!res.ok)
      throw new ApiError(
        `${method} ${path} as ${email}: ${res.status} ${json.error?.code ?? ''} ${json.error?.message ?? text.slice(0, 200)}`,
      );
    return json.data as T;
  };
  const session = await call<{ accessToken: string }>('POST', '/api/auth/login', {
    email,
    password,
  });
  /** Multipart upload of one file as the "file" field. */
  const upload = async (path: string, file: Buffer, name: string, type: string) => {
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(file)], { type }), name);
    const { 'content-type': _json, ...h } = headers(session.accessToken);
    const res = await fetch(`${base}${path}`, { method: 'POST', headers: h, body: form });
    if (!res.ok) throw new ApiError(`POST ${path} as ${email}: ${res.status} ${await res.text()}`);
  };
  return {
    upload,
    get: <T = Data>(p: string) => call<T>('GET', p, undefined, session.accessToken),
    post: <T = Data>(p: string, b: unknown = {}) => call<T>('POST', p, b, session.accessToken),
    patch: <T = Data>(p: string, b: unknown = {}) => call<T>('PATCH', p, b, session.accessToken),
    put: <T = Data>(p: string, b: unknown = {}) => call<T>('PUT', p, b, session.accessToken),
  };
}
type Client = Awaited<ReturnType<typeof signIn>>;

const addDays = (ymd: string, days: number) => {
  const d = new Date(`${ymd}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export async function runStory(prisma: PrismaClient, base: string, password: string) {
  const hospitalId = DEMO_IDS.hospital;
  const today = localDate(new Date(), TZ);
  const as = (local: string) => signIn(base, demoEmail(local), password);
  const [admin, reception, nurse, labSenior, labAssistant, pharmacy, accounts, drMeera, drArjun] = [
    await as('admin'),
    await as('reception'),
    await as('nurse'),
    await as('lab'),
    await as('lab.assistant'),
    await as('pharmacy'),
    await as('accounts'),
    await as('dr.meera'),
    await as('dr.arjun'),
  ];
  const doctorId = async (email: string) =>
    (
      await prisma.doctor.findFirstOrThrow({
        where: { hospitalId, user: { email } },
        select: { id: true },
      })
    ).id;
  const doc = {
    meera: await doctorId(demoEmail('dr.meera')),
    arjun: await doctorId(demoEmail('dr.arjun')),
    kavya: await doctorId(demoEmail('dr.kavya')),
  };

  // ---- Each doctor uploads a prescription signature (required before prescribing).
  log('Doctor signatures');
  await drMeera.upload(
    `/api/doctors/${doc.meera}/signature`,
    signaturePng(1),
    'signature.png',
    'image/png',
  );
  await drArjun.upload(
    `/api/doctors/${doc.arjun}/signature`,
    signaturePng(2),
    'signature.png',
    'image/png',
  );

  // ---- Tax set-up (admin). Unregistered: no GST number is invented for a fictional hospital.
  log('Tax set-up');
  const services = await admin.post('/api/tax/classifications', {
    name: 'Healthcare services',
    supplyType: 'SERVICE',
    hsnSac: '999312',
  });
  await admin.post(`/api/tax/classifications/${services.id}/versions`, {
    treatment: 'EXEMPT',
    ratePercent: '0',
    priceIncludesTax: false,
    effectiveFrom: today,
  });
  const medicinesTax = await admin.post('/api/tax/classifications', {
    name: 'Medicines (allopathic)',
    supplyType: 'GOODS',
    hsnSac: '3004',
  });
  await admin.post(`/api/tax/classifications/${medicinesTax.id}/versions`, {
    treatment: 'TAXABLE',
    ratePercent: '12',
    priceIncludesTax: true,
    effectiveFrom: today,
  });
  for (const kind of ['CONSULTATION', 'LAB'])
    await admin.put(`/api/tax/defaults/${kind}`, { classificationId: services.id });
  await admin.post('/api/tax/registrations', {
    registrationType: 'UNREGISTERED',
    effectiveFrom: today,
  });
  await admin.post('/api/tax/confirm');

  // ---- Rooms and beds (admin); two beds occupied for the occupancy figures.
  log('Rooms and beds');
  const rooms = [
    { number: '101', type: 'WARD', floor: '1', dailyCharge: 1500, beds: ['A', 'B', 'C', 'D'] },
    { number: '201', type: 'PRIVATE', floor: '2', dailyCharge: 4000, beds: ['A'] },
    { number: 'ICU-1', type: 'ICU', floor: '3', dailyCharge: 9000, beds: ['A'] },
  ];
  const beds: string[] = [];
  for (const r of rooms) {
    const room = await admin.post('/api/rooms', {
      number: r.number,
      type: r.type,
      floor: r.floor,
      dailyCharge: r.dailyCharge,
      departmentId: DEMO_IDS.dept.general,
    });
    for (const label of r.beds)
      beds.push((await admin.post(`/api/rooms/${room.id}/beds`, { label })).id);
  }
  for (const b of [beds[0], beds[4]]) await admin.patch(`/api/beds/${b}`, { status: 'OCCUPIED' });

  // ---- Laboratory catalogue (admin).
  log('Laboratory catalogue');
  const lab: Record<string, Data & { id: string }> = {};
  for (const t of [
    {
      key: 'hb',
      code: 'HB',
      name: 'Haemoglobin',
      unit: 'g/dL',
      price: 150,
      ranges: [
        { gender: 'FEMALE', low: 12, high: 15.5 },
        { gender: 'MALE', low: 13, high: 17 },
      ],
    },
    {
      key: 'fbs',
      code: 'FBS',
      name: 'Fasting blood glucose',
      unit: 'mg/dL',
      price: 120,
      ranges: [{ low: 70, high: 100 }],
    },
    {
      key: 'creat',
      code: 'CREAT',
      name: 'Serum creatinine',
      unit: 'mg/dL',
      price: 250,
      ranges: [{ low: 0.6, high: 1.2 }],
    },
    {
      key: 'tsh',
      code: 'TSH',
      name: 'Thyroid stimulating hormone',
      unit: 'mIU/L',
      price: 400,
      ranges: [{ low: 0.4, high: 4 }],
    },
    {
      key: 'ldl',
      code: 'LDL',
      name: 'LDL cholesterol',
      unit: 'mg/dL',
      price: 350,
      ranges: [{ low: 0, high: 100 }],
    },
    { key: 'cxr', code: 'CXR', name: 'Chest X-ray (PA view)', price: 600, category: 'RADIOLOGY' },
  ]) {
    const { key, category, ...body } = t;
    lab[key] = await admin.post('/api/lab-tests', { ...body, category: category ?? 'LABORATORY' });
  }

  // ---- Pharmacy catalogue and stock (pharmacist); medicines taxed as goods (admin).
  log('Pharmacy catalogue and stock');
  const med: Record<string, Data> = {};
  const medicines = [
    {
      key: 'para',
      name: 'Paracetamol',
      strength: '650 mg',
      form: 'TABLET',
      reorderLevel: 50,
      batches: [['PCM-2401', 400, 420]],
    },
    {
      key: 'amox',
      name: 'Amoxicillin',
      strength: '500 mg',
      form: 'CAPSULE',
      reorderLevel: 40,
      batches: [['AMX-2402', 120, 300]],
    },
    {
      key: 'cetz',
      name: 'Cetirizine',
      strength: '10 mg',
      form: 'TABLET',
      reorderLevel: 30,
      batches: [['CTZ-2403', 200, 360]],
    },
    {
      key: 'metf',
      name: 'Metformin',
      strength: '500 mg',
      form: 'TABLET',
      reorderLevel: 60,
      batches: [['MET-2404', 300, 500]],
    },
    {
      key: 'amlo',
      name: 'Amlodipine',
      strength: '5 mg',
      form: 'TABLET',
      reorderLevel: 40,
      batches: [['AML-2405', 25, 400]],
    },
    {
      key: 'ors',
      name: 'Oral rehydration salts',
      strength: '21 g sachet',
      form: 'TOPICAL',
      reorderLevel: 20,
      batches: [['ORS-2406', 60, 18]],
    },
    {
      key: 'salb',
      name: 'Salbutamol syrup',
      strength: '2 mg/5 mL',
      form: 'SYRUP',
      reorderLevel: 10,
      batches: [['SAL-2407', 30, 240]],
    },
    {
      key: 'panto',
      name: 'Pantoprazole',
      strength: '40 mg',
      form: 'TABLET',
      reorderLevel: 30,
      batches: [['PAN-2408', 150, 330]],
    },
  ] as const;
  for (const m of medicines) {
    const created = await pharmacy.post('/api/medicines', {
      name: m.name,
      form: m.form,
      strength: m.strength,
      reorderLevel: m.reorderLevel,
    });
    med[m.key] = created;
    for (const [batchNumber, quantity, days] of m.batches)
      await pharmacy.post(`/api/medicines/${created.id}/batches`, {
        batchNumber,
        manufacturedOn: addDays(today, -60),
        expiresOn: addDays(today, days),
        quantity,
        unitCost: 2,
        mrp: 5,
      });
    await admin.put(`/api/tax/assignments/medicines/${created.id}`, {
      classificationId: medicinesTax.id,
    });
  }

  // ---- Patients: two with portal accounts (foundation), four registered at the front desk.
  log('Patients');
  const patientId = async (email: string) =>
    (
      await prisma.patient.findFirstOrThrow({
        where: { hospitalId, user: { email } },
        select: { id: true },
      })
    ).id;
  const pt: Record<string, string> = {
    ananya: await patientId(demoEmail('ananya')),
    rahul: await patientId(demoEmail('rahul')),
  };
  for (const p of [
    {
      key: 'lakshmi',
      firstName: 'Lakshmi',
      lastName: 'Pillai',
      dateOfBirth: '1958-11-23',
      gender: 'FEMALE',
      phone: '+919000010003',
    },
    {
      key: 'vikram',
      firstName: 'Vikram',
      lastName: 'Desai',
      dateOfBirth: '1979-03-14',
      gender: 'MALE',
      phone: '+919000010004',
    },
    {
      key: 'fatima',
      firstName: 'Fatima',
      lastName: 'Khan',
      dateOfBirth: '2001-07-30',
      gender: 'FEMALE',
      phone: '+919000010005',
    },
    {
      key: 'aarav',
      firstName: 'Aarav',
      lastName: 'Gupta',
      dateOfBirth: '2017-02-11',
      gender: 'MALE',
      phone: '+919000010006',
    },
  ]) {
    const { key, ...body } = p;
    pt[key] = (
      await reception.post('/api/patients', {
        ...body,
        email: demoEmail(`${key}.patient`),
        emergencyContactName: key === 'aarav' ? 'Nidhi Gupta (mother)' : undefined,
        emergencyContactPhone: key === 'aarav' ? '+919000010106' : undefined,
      })
    ).id;
  }

  // ---- Medical history (doctor).
  log('Medical history');
  await drMeera.post(`/api/patients/${pt.ananya}/allergies`, {
    kind: 'ADVERSE_DRUG_REACTION',
    substance: 'Penicillin',
    reaction: 'Skin rash',
    severity: 'MODERATE',
  });
  await drMeera.post(`/api/patients/${pt.lakshmi}/medications`, {
    medicineName: 'Metformin 500 mg',
    dosage: '500 mg',
    frequency: 'Twice daily',
    startedOn: addDays(today, -900),
  });
  await drMeera.post(`/api/patients/${pt.lakshmi}/family-history`, {
    condition: 'DIABETES',
    present: true,
    relation: 'Mother',
  });
  await drArjun.post(`/api/patients/${pt.aarav}/allergies`, {
    kind: 'ALLERGY',
    substance: 'Peanuts',
    reaction: 'Hives',
    severity: 'SEVERE',
  });

  // ---- Bookings: the earliest open slots of each doctor, from today on.
  const takenSlots = new Set<string>();
  const nextSlot = async (doctor: string, minLeadMinutes = 5, fromDay = 0): Promise<string> => {
    for (let d = fromDay; d < fromDay + 10; d++) {
      const date = addDays(today, d);
      const slots = await reception.get<{ start: string; available: boolean }[]>(
        `/api/doctors/${doctor}/slots?date=${date}`,
      );
      const s = slots.find(
        (x) =>
          x.available &&
          !takenSlots.has(`${doctor}|${x.start}`) &&
          new Date(x.start).getTime() > Date.now() + minLeadMinutes * 60_000,
      );
      if (s) {
        takenSlots.add(`${doctor}|${s.start}`);
        return s.start;
      }
    }
    throw new Error('No free slot in the next 10 days.');
  };
  const book = async (
    by: Client,
    doctor: string,
    patient: string | undefined,
    reason: string,
    fromDay = 0,
    lead = 5,
  ) =>
    by.post('/api/appointments', {
      doctorId: doctor,
      ...(patient ? { patientId: patient } : {}),
      scheduledAt: await nextSlot(doctor, lead, fromDay),
      reason,
    });

  // ---- Completed consultations.
  type Visit = {
    patient: string;
    doctor: 'meera' | 'arjun';
    reason: string;
    complaint: string;
    vitals: Record<string, number>;
    diagnosis: { code?: string; description: string };
    note: string;
    plan: string;
    rx?: {
      med: string;
      dosage: string;
      frequency: string;
      durationDays: number;
      quantity: number;
    }[];
    labs?: string[];
  };
  const visits: Visit[] = [
    {
      patient: 'ananya',
      doctor: 'meera',
      reason: 'Fever for three days',
      complaint: 'Fever and body ache for three days',
      vitals: {
        systolicBp: 118,
        diastolicBp: 76,
        pulse: 96,
        temperatureC: 38.6,
        spo2: 98,
        weightKg: 58,
        heightCm: 162,
      },
      diagnosis: { code: 'J06.9', description: 'Acute upper respiratory infection' },
      note: 'Throat congested, no chest signs. Advised fluids and rest. Penicillin allergy noted: no amoxicillin.',
      plan: 'Paracetamol for fever, cetirizine at night, review in 5 days if fever persists.',
      rx: [
        { med: 'para', dosage: '650 mg', frequency: 'TDS', durationDays: 3, quantity: 9 },
        { med: 'cetz', dosage: '10 mg', frequency: 'OD', durationDays: 5, quantity: 5 },
      ],
      labs: ['hb'],
    },
    {
      patient: 'lakshmi',
      doctor: 'meera',
      reason: 'Diabetes review',
      complaint: 'Routine diabetes follow-up, occasional tiredness',
      vitals: {
        systolicBp: 142,
        diastolicBp: 88,
        pulse: 78,
        temperatureC: 36.8,
        spo2: 97,
        weightKg: 71,
        heightCm: 155,
      },
      diagnosis: { code: 'E11.9', description: 'Type 2 diabetes mellitus without complications' },
      note: 'Sugars poorly controlled by history. Blood pressure mildly raised today.',
      plan: 'Continue metformin; fasting glucose and creatinine today; diet counselling.',
      rx: [{ med: 'metf', dosage: '500 mg', frequency: 'BD', durationDays: 30, quantity: 60 }],
      labs: ['fbs', 'creat'],
    },
    {
      patient: 'vikram',
      doctor: 'meera',
      reason: 'High blood pressure readings at home',
      complaint: 'Home BP readings around 150/95 for two weeks',
      vitals: {
        systolicBp: 152,
        diastolicBp: 96,
        pulse: 82,
        temperatureC: 36.7,
        spo2: 98,
        weightKg: 84,
        heightCm: 176,
      },
      diagnosis: { code: 'I10', description: 'Essential (primary) hypertension' },
      note: 'No chest pain or breathlessness. Lifestyle factors discussed.',
      plan: 'Start amlodipine 5 mg; lipid profile; review in two weeks with home readings.',
      rx: [{ med: 'amlo', dosage: '5 mg', frequency: 'OD', durationDays: 14, quantity: 14 }],
      labs: ['ldl'],
    },
    {
      patient: 'aarav',
      doctor: 'arjun',
      reason: 'Loose stools since yesterday',
      complaint: 'Loose stools four times since yesterday, eating less',
      vitals: { pulse: 104, temperatureC: 37.4, spo2: 99, weightKg: 22, heightCm: 121 },
      diagnosis: { code: 'A09', description: 'Gastroenteritis, presumed infectious' },
      note: 'Mild dehydration, active and playful. Peanut allergy on record.',
      plan: 'Oral rehydration salts after each loose stool; return if vomiting or lethargy.',
      rx: [
        {
          med: 'ors',
          dosage: '1 sachet in 1 L water',
          frequency: 'SOS',
          durationDays: 3,
          quantity: 6,
        },
      ],
    },
    {
      patient: 'fatima',
      doctor: 'meera',
      reason: 'Tiredness and weight gain',
      complaint: 'Tiredness and weight gain over three months',
      vitals: {
        systolicBp: 110,
        diastolicBp: 70,
        pulse: 64,
        temperatureC: 36.5,
        spo2: 99,
        weightKg: 66,
        heightCm: 160,
      },
      diagnosis: { description: 'Fatigue, thyroid function to be checked' },
      note: 'No other complaints. Thyroid function and haemoglobin ordered.',
      plan: 'Review with results.',
      labs: ['tsh', 'hb'],
    },
    {
      patient: 'rahul',
      doctor: 'meera',
      reason: 'Cough for one week',
      complaint: 'Dry cough for one week, no fever',
      vitals: {
        systolicBp: 124,
        diastolicBp: 80,
        pulse: 76,
        temperatureC: 36.9,
        spo2: 97,
        weightKg: 78,
        heightCm: 174,
      },
      diagnosis: { code: 'R05', description: 'Cough' },
      note: 'Smoker, 10 cigarettes a day. Chest clear. Cessation advised.',
      plan: 'Chest X-ray; pantoprazole for reflux symptoms at night.',
      rx: [{ med: 'panto', dosage: '40 mg', frequency: 'OD', durationDays: 14, quantity: 14 }],
      labs: ['cxr'],
    },
  ];
  const doctors = { meera: drMeera, arjun: drArjun };
  const icdKnown = async (code?: string) => {
    if (!code) return undefined;
    const hits = await drMeera.get<{ code: string }[]>(
      `/api/icd10?search=${encodeURIComponent(code)}`,
    );
    return hits.some((h) => h.code === code) ? code : undefined;
  };
  const done: { visit: Visit; appointment: Data; record: Data; rx?: Data; order?: Data }[] = [];
  for (const v of visits) {
    log(`Consultation: ${v.patient}`);
    const d = doctors[v.doctor];
    const appt = await book(reception, doc[v.doctor], pt[v.patient], v.reason);
    await reception.patch(`/api/appointments/${appt.id}/status`, { status: 'CONFIRMED' });
    // Starting the encounter opens the medical record and puts the visit in progress.
    const record = await d.post('/api/medical-records', {
      appointmentId: appt.id,
      chiefComplaint: v.complaint,
    });
    await nurse.post(`/api/medical-records/record/${record.id}/vitals`, v.vitals);
    const code = await icdKnown(v.diagnosis.code);
    await d.post(`/api/medical-records/record/${record.id}/diagnoses`, {
      ...(code ? { icd10Code: code } : {}),
      description: v.diagnosis.description,
      type: code ? 'CONFIRMED' : 'DIFFERENTIAL',
    });
    await d.post(`/api/medical-records/record/${record.id}/entries`, { body: v.note });
    await d.patch(`/api/medical-records/record/${record.id}`, { treatmentPlan: v.plan });
    const entry: (typeof done)[number] = { visit: v, appointment: appt, record };
    if (v.rx)
      entry.rx = await d.post('/api/prescriptions', {
        medicalRecordId: record.id,
        items: v.rx.map((i) => ({
          medicineId: med[i.med]!.id,
          dosage: i.dosage,
          frequency: i.frequency,
          durationDays: i.durationDays,
          quantity: i.quantity,
        })),
      });
    if (v.labs)
      entry.order = await d.post('/api/lab-orders', {
        medicalRecordId: record.id,
        testIds: v.labs.map((k) => lab[k]!.id),
      });
    done.push(entry);
  }

  // ---- Laboratory: samples, results by the assistant, approval by the senior technician.
  log('Laboratory work');
  // By test code. Abnormal on purpose: fasting glucose, LDL and TSH (flagged HIGH by the ranges).
  const results: Record<string, number> = { HB: 12.6, FBS: 168, CREAT: 0.9, LDL: 142, TSH: 7.8 };
  type Order = Data & { items: { id: string; test: { code: string } }[] };
  for (const e of done.filter((x) => x.order)) {
    const order = e.order as Order;
    const patient = e.visit.patient;
    if (patient === 'rahul') continue; // chest X-ray: sample/visit not yet done
    await reception.patch(`/api/lab-orders/${order.id}/sample`);
    await labAssistant.patch(`/api/lab-orders/${order.id}/processing`);
    const full = await labAssistant.get<Order>(`/api/lab-orders/${order.id}`);
    await labAssistant.patch(`/api/lab-orders/${order.id}/result`, {
      results: full.items.map((it) => {
        const value = results[it.test.code];
        if (value === undefined) throw new Error(`No demo result for test ${it.test.code}.`);
        return { itemId: it.id, valueNumeric: value };
      }),
      submit: true,
    });
    if (patient !== 'fatima') await labSenior.patch(`/api/lab-orders/${order.id}/approve`); // Fatima's results await approval
  }

  // ---- Pharmacy: verify, dispense and hand over; Rahul's prescription is still waiting.
  log('Pharmacy');
  type Rx = Data & { items: { id: string; quantity: number }[] };
  for (const e of done.filter((x) => x.rx && x.visit.patient !== 'rahul')) {
    const rx = e.rx as Rx;
    await pharmacy.patch(`/api/pharmacy/prescriptions/${rx.id}/verify`);
    await pharmacy.post(`/api/pharmacy/prescriptions/${rx.id}/dispense`, {
      items: rx.items.map((i) => ({ itemId: i.id, quantity: i.quantity })),
    });
    await pharmacy.patch(`/api/pharmacy/prescriptions/${rx.id}/handover`);
  }

  // ---- Doctors complete the visits: the consultation is charged and a draft bill is opened.
  log('Completing consultations');
  for (const e of done)
    await doctors[e.visit.doctor].patch(`/api/appointments/${e.appointment.id}/status`, {
      status: 'COMPLETED',
    });

  // ---- Billing: issue the visit bills, then payments and claims.
  log('Billing');
  type Inv = Data & { status: string; total: string; patientId: string };
  const invoiceOf = async (patient: string) => {
    const list = await reception.get<Inv[]>(`/api/invoices?patientId=${pt[patient]}`);
    if (!list[0]) throw new Error(`No bill was opened for ${patient}.`);
    return list[0];
  };
  const issued: Record<string, Inv> = {};
  for (const e of done) {
    const draft = await invoiceOf(e.visit.patient);
    issued[e.visit.patient] = await reception.patch<Inv>(`/api/invoices/${draft.id}/finalise`);
  }
  const balance = async (invoiceId: string) =>
    (await reception.get<{ balance: string }>(`/api/invoices/${invoiceId}/payments`)).balance;
  // Ananya: paid in full in cash.
  await reception.post(`/api/invoices/${issued.ananya!.id}/payments/cash`, {
    amount: await balance(issued.ananya!.id),
  });
  // Lakshmi: part-paid in cash; the rest outstanding.
  await reception.post(`/api/invoices/${issued.lakshmi!.id}/payments/cash`, { amount: '300.00' });
  // Aarav: paid through the development test checkout (no real provider is contacted).
  const checkout = await reception.post<{ payment: Data }>(
    `/api/invoices/${issued.aarav!.id}/payments/checkout`,
    { method: 'RAZORPAY_UPI' },
  );
  await reception.post(`/api/payments/${checkout.payment.id}/simulate`, { outcome: 'SUCCEEDED' });
  // Vikram: insurance claim approved and settled by the insurer (TPA), posted to the bill.
  const vikramDue = await balance(issued.vikram!.id);
  const claimV = await reception.post(`/api/invoices/${issued.vikram!.id}/claims`, {
    tpaName: 'Medi Assist (demo)',
    policyNumber: 'DEMO-POL-44821',
    claimAmount: vikramDue,
  });
  await accounts.patch(`/api/claims/${claimV.id}/decision`, { decision: 'APPROVED' });
  await accounts.post(`/api/claims/${claimV.id}/settle`, {
    settledAmount: vikramDue,
    postToBalance: true,
  });
  // Fatima: claim submitted, awaiting the insurer.
  await reception.post(`/api/invoices/${issued.fatima!.id}/claims`, {
    tpaName: 'Star Health (demo)',
    policyNumber: 'DEMO-POL-90317',
    claimAmount: await balance(issued.fatima!.id),
  });
  // Rahul: claim rejected; his bill stays unpaid.
  const claimR = await reception.post(`/api/invoices/${issued.rahul!.id}/claims`, {
    tpaName: 'Medi Assist (demo)',
    policyNumber: 'DEMO-POL-11873',
    claimAmount: await balance(issued.rahul!.id),
    notes: 'Outpatient consultation; insurer to confirm OPD cover.',
  });
  await accounts.patch(`/api/claims/${claimR.id}/decision`, { decision: 'REJECTED' }); // no OPD cover
  // The accountant reconciles today's cash.
  const rec = await accounts.get<{ rows: { id: string; method: string }[] }>(
    `/api/reconciliation?from=${today}&to=${today}`,
  );
  const cash = rec.rows.filter((p) => p.method === 'CASH').map((p) => p.id);
  if (cash.length)
    await accounts.post('/api/reconciliation/mark', { paymentIds: cash.slice(0, 1) });

  // ---- Upcoming and cancelled appointments.
  log('Upcoming and cancelled appointments');
  const ananyaPortal = await as('ananya');
  await book(ananyaPortal, doc.meera, undefined, 'Follow-up for fever', 4, 180); // she books herself
  const vikramFollowUp = await book(
    reception,
    doc.meera,
    pt.vikram,
    'Blood pressure review',
    13,
    180,
  );
  await reception.patch(`/api/appointments/${vikramFollowUp.id}/status`, { status: 'CONFIRMED' });
  const kavyaRef = await book(
    reception,
    doc.kavya,
    pt.vikram,
    'Cardiology opinion: hypertension',
    2,
    180,
  );
  await reception.patch(`/api/appointments/${kavyaRef.id}/status`, { status: 'CONFIRMED' });
  await book(reception, doc.arjun, pt.aarav, 'Review after gastroenteritis', 3, 180);
  await book(reception, doc.meera, pt.fatima, 'Thyroid results review', 2, 180);
  const cancelledByDesk = await book(reception, doc.kavya, pt.lakshmi, 'ECG review', 1, 180);
  await reception.patch(`/api/appointments/${cancelledByDesk.id}/status`, {
    status: 'CANCELLED',
    reason: 'Patient asked to move to next month',
  });
  const rahulPortal = await as('rahul');
  const rahulBooking = await book(rahulPortal, doc.meera, undefined, 'Cough not better', 2, 180);
  await rahulPortal.patch(`/api/appointments/${rahulBooking.id}/status`, {
    status: 'CANCELLED',
    reason: 'Feeling better',
  });

  // ---- Notifications: Ananya has read her older ones; the newest stay unread.
  const notes = await ananyaPortal.get<{ id: string }[]>('/api/notifications?limit=50');
  for (const n of notes.slice(2)) await ananyaPortal.patch(`/api/notifications/${n.id}/read`);
}

// ---------------------------------------------------------------------------------------------

async function main(): Promise<void> {
  const db = assertSafeDemoTarget(process.env);
  const password = process.env.DEMO_PASSWORD ?? '';
  const problem = checkPassword(password, demoEmail('admin'));
  if (problem) throw new Error(`DEMO_PASSWORD in .env is not usable: ${problem}`);
  if (password === process.env.E2E_PASSWORD)
    throw new Error('DEMO_PASSWORD must differ from E2E_PASSWORD.');

  const prisma = new PrismaClient();
  let app: INestApplication | undefined;
  try {
    log(`Database: ${db}. Demo hospital: Sunrise Multispeciality Hospital (Demo).`);
    const created = await seedFoundation(prisma, password);
    log(
      created.length
        ? `Foundation: created ${created.length} rows/accounts.`
        : 'Foundation: already present; nothing changed.',
    );

    const where = { hospitalId: DEMO_IDS.hospital };
    const [appointments, started] = await Promise.all([
      prisma.appointment.count({ where }),
      Promise.all([
        prisma.taxClassification.count({ where }),
        prisma.room.count({ where }),
        prisma.labTest.count({ where }),
        prisma.medicine.count({ where }),
      ]).then((n) => n.reduce((a, b) => a + b, 0)),
    ]);
    if (appointments > 0) {
      log(`Story: the demo hospital already has ${appointments} appointments; nothing changed.`);
      return;
    }
    if (started > 0)
      throw new Error(
        'The demo story was started before and stopped part-way (catalogue rows exist but no appointments). Nothing was changed; this needs a decision from the owner, not an automatic clean-up.',
      );
    app = await NestFactory.create(AppModule, { rawBody: true, logger: ['error', 'warn'] });
    configureApp(app, { corsOrigins: [] });
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as { port: number };
    await runStory(prisma, `http://127.0.0.1:${address.port}`, password);
    log('Story: created through the API.');
  } finally {
    await app?.close();
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e: Error) => {
    console.error(e instanceof ApiError ? `Stopped: ${e.message}` : e.message);
    console.error(
      'Rows created before this point remain (nothing is ever deleted automatically). Fix the cause and rerun: existing rows are kept, and the story runs only while the demo hospital has no appointments.',
    );
    process.exit(1);
  });
}
