import type { MedicalRecord, PatientHistory } from '@medcore/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/store/auth';
import { EncounterStart } from './encounter-start';
import { RecordView, recordPermissions } from './record-view';

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push: vi.fn() }),
  usePathname: () => '/dashboard/records/r1',
  useSearchParams: () => new URLSearchParams(),
}));

const ok = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data, message: 'OK' }), { status: 200 });
const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );
const signIn = (role: string, id: string) =>
  useAuth.setState({
    status: 'authenticated',
    accessToken: 't',
    me: {
      user: {
        id,
        email: 'a@b.c',
        phone: null,
        firstName: 'A',
        lastName: 'B',
        role,
        hospitalId: 'h1',
        emailVerified: true,
        phoneVerified: false,
      },
      hospital: { id: 'h1', name: 'City', code: 'CITY' },
      permissions: [],
    } as never,
  });
const by = { id: 'doc-user', firstName: 'Dee', lastName: 'Rao', role: 'DOCTOR' };
const record = (over: Partial<MedicalRecord> = {}): MedicalRecord => ({
  id: 'r1',
  status: 'OPEN',
  chiefComplaint: 'Sore throat',
  presentingSymptoms: null,
  treatmentPlan: null,
  createdAt: '2026-11-16T05:00:00.000Z',
  closedAt: null,
  appointment: {
    id: 'a1',
    scheduledAt: '2026-11-16T05:00:00.000Z',
    type: 'REGULAR',
    status: 'IN_PROGRESS',
  },
  patient: {
    id: 'p1',
    firstName: 'Pat',
    lastName: 'One',
    mrn: 'MRN-2026-000001',
    dateOfBirth: '1990-01-01',
    gender: 'FEMALE',
  },
  doctor: {
    id: 'd1',
    userId: 'doc-user',
    firstName: 'Dee',
    lastName: 'Rao',
    specialisation: 'General',
  },
  department: { id: 'dep', name: 'General' },
  entries: [
    {
      id: 'e1',
      kind: 'NOTE',
      body: 'Throat inflamed',
      by,
      at: '2026-11-16T05:10:00.000Z',
      supersedesId: null,
      correctionReason: null,
      corrected: false,
    },
  ],
  vitals: [
    {
      id: 'v1',
      systolicBp: 120,
      diastolicBp: 80,
      pulse: 72,
      temperatureC: 37.2,
      spo2: 98,
      heightCm: 170,
      weightKg: 65,
      bmi: 22.5,
      by,
      at: '2026-11-16T05:05:00.000Z',
      supersedesId: null,
      correctionReason: null,
      corrected: false,
    },
  ],
  diagnoses: [],
  files: [],
  ...over,
});
const history: PatientHistory = {
  allergies: [
    {
      id: 'al1',
      kind: 'ADVERSE_DRUG_REACTION',
      substance: 'Penicillin',
      reaction: 'Hives',
      severity: 'MODERATE',
      status: 'ACTIVE',
      statusReason: null,
      statusChangedAt: null,
      by,
      at: '2026-01-01T00:00:00.000Z',
      supersedesId: null,
      correctionReason: null,
      corrected: false,
    },
  ],
  medications: [],
  vaccinations: [],
  familyHistory: [],
};

beforeEach(() => {
  document.cookie = 'mc_csrf=' + 'c'.repeat(43) + '; path=/';
  replace.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('record permissions mirror the API (API-019, EMR-002)', () => {
  it('lets only the treating doctor change the encounter; nurses add vitals; closed records allow addenda only', () => {
    const open = record();
    expect(recordPermissions(open, 'DOCTOR', 'doc-user')).toMatchObject({
      editSummary: true,
      addNote: true,
      diagnose: true,
      addVitals: true,
      complete: true,
    });
    expect(recordPermissions(open, 'DOCTOR', 'other')).toMatchObject({
      editSummary: false,
      addNote: false,
      diagnose: false,
      addVitals: false,
      attach: false,
      history: true,
    });
    expect(recordPermissions(open, 'NURSE', 'n1')).toMatchObject({
      addVitals: true,
      attach: true,
      addNote: false,
      editSummary: false,
    });
    expect(recordPermissions(open, 'PATIENT', 'p-user')).toMatchObject({
      addVitals: false,
      addNote: false,
      history: false,
      correctVitals: false,
    });
    const closed = record({
      status: 'CLOSED',
      appointment: { ...open.appointment, status: 'COMPLETED' },
    });
    expect(recordPermissions(closed, 'DOCTOR', 'doc-user')).toMatchObject({
      editSummary: false,
      addNote: true,
      addVitals: false,
      correctVitals: true,
      diagnose: false,
      correctDiagnosis: true,
      complete: false,
    });
  });
});

describe('RecordView', () => {
  const mock = (r: MedicalRecord, posts: { url: string; body: unknown }[] = []) =>
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.startsWith('/api/hospitals/h1'))
        return Promise.resolve(ok({ id: 'h1', timezone: 'Asia/Kolkata' }));
      if (url === '/api/medical-records/record/r1' && (!init?.method || init.method === 'GET'))
        return Promise.resolve(ok(r));
      if (url === '/api/patients/p1/history') return Promise.resolve(ok(history));
      if (url.startsWith('/api/prescriptions?'))
        return Promise.resolve(
          new Response(
            JSON.stringify({
              success: true,
              data: [],
              meta: { page: 1, limit: 50, total: 0, totalPages: 0 },
              message: 'OK',
            }),
            { status: 200 },
          ),
        );
      if (init?.method === 'POST') {
        posts.push({ url, body: JSON.parse(String(init.body)) });
        return Promise.resolve(
          ok({
            ...r,
            entries: [...r.entries, { ...r.entries[0]!, id: 'e2', body: 'New finding' }],
          }),
        );
      }
      throw new Error(`unexpected ${url}`);
    });

  it('shows the encounter with BMI and an allergy warning, and the treating doctor adds a note', async () => {
    signIn('DOCTOR', 'doc-user');
    const posts: { url: string; body: unknown }[] = [];
    mock(record(), posts);
    wrap(<RecordView recordId="r1" backHref="/dashboard/appointments" />);
    expect(await screen.findByText('Throat inflamed')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Vitals' })).toHaveTextContent('22.5');
    expect(
      await screen.findByText('Allergies and reactions', { selector: 'p' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Complete consultation' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Add note/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/^Note/), { target: { value: 'New finding' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    await waitFor(() =>
      expect(posts).toEqual([
        { url: '/api/medical-records/record/r1/entries', body: { body: 'New finding' } },
      ]),
    );
    expect(await screen.findByText('New finding')).toBeInTheDocument();
  });

  it('a correction asks for a reason and keeps the original', async () => {
    signIn('DOCTOR', 'doc-user');
    const posts: { url: string; body: unknown }[] = [];
    mock(record(), posts);
    wrap(<RecordView recordId="r1" backHref="/x" />);
    await screen.findByText('Throat inflamed');
    const notes = screen.getByRole('heading', { name: 'Notes' }).closest('section')!;
    fireEvent.click(within(notes).getByRole('button', { name: 'Correct' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save correction' }));
    expect(await within(dialog).findByText('Say why this needs correcting.')).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Reason for correction/), {
      target: { value: 'Wrong side' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save correction' }));
    await waitFor(() =>
      expect(posts[0]).toEqual({
        url: '/api/medical-records/record/r1/entries',
        body: { body: 'Throat inflamed', amendsEntryId: 'e1', correctionReason: 'Wrong side' },
      }),
    );
  });

  it('is read-only for the patient', async () => {
    signIn('PATIENT', 'p-user');
    mock(
      record({
        status: 'CLOSED',
        appointment: {
          id: 'a1',
          scheduledAt: '2026-11-16T05:00:00.000Z',
          type: 'REGULAR',
          status: 'COMPLETED',
        },
      }),
    );
    wrap(<RecordView recordId="r1" backHref="/portal/health" />);
    expect(await screen.findByText('Throat inflamed')).toBeInTheDocument();
    expect((await screen.findAllByText(/Penicillin/)).length).toBeGreaterThan(0);
    for (const name of [
      /Add note/,
      /Add addendum/,
      /Record vitals/,
      /Add diagnosis/,
      'Correct',
      /Attach file/,
      'Complete consultation',
      /^Add/,
    ])
      expect(screen.queryAllByRole('button', { name })).toHaveLength(0);
  });
});

describe('EncounterStart', () => {
  it('starts the consultation with the chief complaint and opens the record (EMR-001)', async () => {
    signIn('DOCTOR', 'doc-user');
    const posts: unknown[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.startsWith('/api/hospitals/h1'))
        return Promise.resolve(ok({ id: 'h1', timezone: 'Asia/Kolkata' }));
      if (url === '/api/appointments/a1')
        return Promise.resolve(
          ok({
            id: 'a1',
            scheduledAt: '2026-11-16T05:00:00.000Z',
            status: 'CONFIRMED',
            reason: 'Cough',
            patient: { id: 'p1', firstName: 'Pat', lastName: 'One', mrn: 'MRN-1' },
            department: { id: 'd', name: 'General' },
            medicalRecordId: null,
          }),
        );
      if (url === '/api/medical-records' && init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)));
        return Promise.resolve(ok(record()));
      }
      throw new Error(`unexpected ${url}`);
    });
    wrap(<EncounterStart appointmentId="a1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Start consultation' }));
    expect(await screen.findByText('Enter the chief complaint.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Chief complaint/), {
      target: { value: '  Cough for a week ' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Start consultation' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard/records/r1'));
    expect(posts).toEqual([{ appointmentId: 'a1', chiefComplaint: 'Cough for a week' }]);
  });
});
