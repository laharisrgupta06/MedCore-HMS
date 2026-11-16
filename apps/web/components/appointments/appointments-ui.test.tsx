import type { Appointment } from '@medcore/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { addDays, dayBounds, localDate, zonedToUtc } from '@/lib/time';
import { useAuth } from '@/store/auth';
import { allowedActions, canReschedule, tooLateToCancelOnline } from './appointment-actions';
import { AppointmentsView } from './appointments-view';
import { PortalBook } from './portal-appointments';

const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push }),
  usePathname: () => '/portal/book',
  useSearchParams: () => new URLSearchParams(),
}));

const TZ = 'Asia/Kolkata';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const ok = (data: unknown, meta?: unknown) =>
  json(200, { success: true, data, ...(meta ? { meta } : {}), message: 'OK' });
const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );
const me = (role: string) => ({
  user: {
    id: 'u1',
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
});
const doctor = {
  id: 'd1',
  userId: 'u9',
  firstName: 'Dee',
  lastName: 'Rao',
  email: 'd@x.y',
  phone: null,
  isActive: true,
  registrationNumber: 'R',
  specialisation: 'Cardiology',
  qualification: null,
  consultationFee: '500',
  bio: null,
  hasSignature: false,
  departments: [{ id: 'dep1', name: 'Heart' }],
};
const appt = (over: Partial<Appointment> = {}): Appointment => ({
  id: 'a1',
  scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
  endAt: new Date(Date.now() + 5_400_000).toISOString(),
  status: 'PENDING',
  type: 'REGULAR',
  reason: 'Chest pain',
  cancellationReason: null,
  doctor: { id: 'd1', firstName: 'Dee', lastName: 'Rao', specialisation: 'Cardiology' },
  patient: { id: 'p1', firstName: 'Pat', lastName: 'One', mrn: 'MRN-2026-000001' },
  department: { id: 'dep1', name: 'Heart' },
  medicalRecordId: null,
  createdAt: '',
  ...over,
});

beforeEach(() => {
  document.cookie = 'mc_csrf=' + 'c'.repeat(43) + '; path=/';
  push.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('hospital time zone helpers', () => {
  it('converts local wall-clock time to UTC, including across DST', () => {
    expect(zonedToUtc('2026-12-07', 9 * 60, TZ).toISOString()).toBe('2026-12-07T03:30:00.000Z');
    expect(zonedToUtc('2026-07-06', 9 * 60, 'America/New_York').toISOString()).toBe(
      '2026-07-06T13:00:00.000Z',
    );
    expect(zonedToUtc('2026-12-07', 9 * 60, 'America/New_York').toISOString()).toBe(
      '2026-12-07T14:00:00.000Z',
    );
    expect(dayBounds('2026-12-07', TZ)).toEqual({
      from: '2026-12-06T18:30:00.000Z',
      to: '2026-12-07T18:30:00.000Z',
    });
    expect(localDate(new Date('2026-12-06T19:00:00Z'), TZ)).toBe('2026-12-07');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });
});

describe('status actions mirror the API rules (APPT-003)', () => {
  it('offers each role only what the server allows', () => {
    const future = appt();
    const past = appt({
      status: 'CONFIRMED',
      scheduledAt: new Date(Date.now() - 60_000).toISOString(),
    });
    // Patients cancel online only until 2 hours before the start (DEC-038).
    expect(allowedActions(future, 'PATIENT')).toEqual([]);
    expect(
      allowedActions(
        appt({ scheduledAt: new Date(Date.now() + 3 * 3_600_000).toISOString() }),
        'PATIENT',
      ),
    ).toEqual(['CANCELLED']);
    expect(allowedActions(past, 'PATIENT')).toEqual([]);
    expect(allowedActions(future, 'RECEPTIONIST')).toEqual(['CONFIRMED', 'CANCELLED']);
    expect(allowedActions(appt({ status: 'CONFIRMED' }), 'RECEPTIONIST')).toEqual(['CANCELLED']);
    expect(allowedActions(past, 'RECEPTIONIST')).toEqual(['CANCELLED', 'NO_SHOW']);
    expect(allowedActions(past, 'DOCTOR')).toEqual(['IN_PROGRESS', 'CANCELLED', 'NO_SHOW']);
    expect(allowedActions(appt({ status: 'IN_PROGRESS' }), 'DOCTOR')).toEqual(['COMPLETED']);
    expect(allowedActions(future, 'NURSE')).toEqual([]);
    expect(tooLateToCancelOnline(future)).toBe(true);
    expect(tooLateToCancelOnline(past)).toBe(false);
    expect(canReschedule(future, 'PATIENT')).toBe(true);
    expect(canReschedule(future, 'DOCTOR')).toBe(false);
    expect(canReschedule(appt({ type: 'EMERGENCY' }), 'RECEPTIONIST')).toBe(false);
  });
});

describe('patient booking', () => {
  it('shows real slots, refreshes them after a conflict, then books the chosen time', async () => {
    useAuth.setState({ status: 'authenticated', me: me('PATIENT') as never, accessToken: 't' });
    const tomorrow = addDays(localDate(new Date(), TZ), 1);
    const t9 = zonedToUtc(tomorrow, 540, TZ).toISOString();
    const t930 = zonedToUtc(tomorrow, 570, TZ).toISOString();
    const t10 = zonedToUtc(tomorrow, 600, TZ).toISOString();
    let slotCalls = 0;
    const posts: unknown[] = [];
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.startsWith('/api/hospitals/h1'))
        return Promise.resolve(ok({ id: 'h1', timezone: TZ }));
      if (url.startsWith('/api/doctors?'))
        return Promise.resolve(ok([doctor], { page: 1, limit: 8, total: 1, totalPages: 1 }));
      if (url.startsWith('/api/doctors/d1/slots')) {
        expect(url).toBe(`/api/doctors/d1/slots?date=${tomorrow}`);
        slotCalls++;
        return Promise.resolve(
          ok([
            { start: t9, end: t930, departmentId: 'dep1', available: false },
            { start: t930, end: t10, departmentId: 'dep1', available: slotCalls === 1 },
            {
              start: t10,
              end: zonedToUtc(tomorrow, 630, TZ).toISOString(),
              departmentId: 'dep1',
              available: true,
            },
          ]),
        );
      }
      if (url === '/api/appointments' && init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)));
        return Promise.resolve(
          posts.length === 1
            ? json(409, {
                success: false,
                error: {
                  code: 'SLOT_UNAVAILABLE',
                  message: 'This slot was just booked by another patient.',
                },
              })
            : json(201, { success: true, data: appt({ scheduledAt: t10 }), message: 'Created' }),
        );
      }
      throw new Error(`unexpected ${url}`);
    });
    wrap(<PortalBook />);
    fireEvent.click(await screen.findByRole('button', { name: /Dr Dee Rao/ }));
    const times = await screen.findByRole('radiogroup', { name: 'Available times' });
    expect(within(times).getByRole('radio', { name: /09:00 \(taken\)/ })).toBeDisabled();
    fireEvent.click(within(times).getByRole('radio', { name: '09:30' }));
    fireEvent.click(screen.getByRole('button', { name: 'Book 09:30' }));
    expect(
      await screen.findByText('This slot was just booked by another patient.'),
    ).toBeInTheDocument();
    expect(posts[0]).toEqual({ doctorId: 'd1', scheduledAt: t930 });
    await waitFor(() =>
      expect(screen.getByRole('radio', { name: /09:30 \(taken\)/ })).toBeDisabled(),
    );
    fireEvent.click(screen.getByRole('radio', { name: '10:00' }));
    fireEvent.click(screen.getByRole('button', { name: 'Book 10:00' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/portal/appointments'));
    expect(posts[1]).toEqual({ doctorId: 'd1', scheduledAt: t10 });
    expect(spy).toHaveBeenCalled();
  });
});

describe('staff agenda', () => {
  it('reception lists the day and confirms; cancelling requires a reason', async () => {
    useAuth.setState({
      status: 'authenticated',
      me: me('RECEPTIONIST') as never,
      accessToken: 't',
    });
    const calls: { url: string; method: string; body?: unknown }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      const method = init?.method ?? 'GET';
      calls.push({ url, method, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.startsWith('/api/hospitals/h1'))
        return Promise.resolve(ok({ id: 'h1', timezone: TZ }));
      if (url.startsWith('/api/appointments?'))
        return Promise.resolve(ok([appt()], { page: 1, limit: 50, total: 1, totalPages: 1 }));
      if (url.startsWith('/api/appointments/a1/status'))
        return Promise.resolve(ok(appt({ status: 'CONFIRMED' })));
      throw new Error(`unexpected ${url}`);
    });
    wrap(<AppointmentsView />);
    expect((await screen.findAllByText('MRN-2026-000001')).length).toBeGreaterThan(0);
    const list = calls.find((c) => c.url.startsWith('/api/appointments?'))!;
    expect(list.url).toContain('order=asc');
    expect(list.url).toMatch(/from=.*&to=/);
    expect(screen.queryAllByRole('button', { name: 'Start consultation' })).toHaveLength(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Confirm' })[0]!);
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH')).toBe(true));
    expect(calls.find((c) => c.method === 'PATCH')).toMatchObject({
      url: '/api/appointments/a1/status',
      body: { status: 'CONFIRMED' },
    });

    fireEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]!);
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel appointment' }));
    expect(
      await within(dialog).findByText('Give a reason for the cancellation.'),
    ).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), {
      target: { value: 'Doctor unwell' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel appointment' }));
    await waitFor(() => expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(2));
    expect(calls.filter((c) => c.method === 'PATCH')[1]!.body).toEqual({
      status: 'CANCELLED',
      reason: 'Doctor unwell',
    });
  });
});
