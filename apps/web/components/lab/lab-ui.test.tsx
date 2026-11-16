import type { LabOrder, LabTest } from '@medcore/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/store/auth';
import { LabOrderCard } from './lab-order-card';
import { LabOrderWork } from './lab-work-views';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard/lab/orders/o1',
  useSearchParams: () => new URLSearchParams(),
}));

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
const hb = {
  id: 'lt1',
  code: 'HB',
  name: 'Haemoglobin',
  category: 'LABORATORY' as const,
  unit: 'g/dL',
  sampleType: 'Blood',
};
const test: LabTest = {
  ...hb,
  price: '200.00',
  isActive: true,
  ranges: [
    { gender: null, ageMinYears: null, ageMaxYears: null, low: 12, high: 16 },
    { gender: 'MALE', ageMinYears: 18, ageMaxYears: null, low: 13, high: 17 },
  ],
};
const order = (over: Partial<LabOrder> = {}): LabOrder => ({
  id: 'o1',
  status: 'APPROVED',
  priority: 'URGENT',
  clinicalNotes: null,
  createdAt: '2026-11-16T05:00:00.000Z',
  medicalRecordId: 'r1',
  patient: {
    id: 'p1',
    firstName: 'Pat',
    lastName: 'One',
    mrn: 'MRN-1',
    dateOfBirth: '1990-01-01',
    gender: 'MALE',
  },
  orderedBy: { id: 'doc', firstName: 'Dee', lastName: 'Rao' },
  sampleCollectedAt: null,
  sampleCollectedBy: null,
  approvedAt: '2026-11-16T07:00:00.000Z',
  approvedBy: { id: 'lt', firstName: 'Lee', lastName: 'Tan' },
  rejectedAt: null,
  rejectedBy: null,
  rejectionReason: null,
  cancelledAt: null,
  cancellationReason: null,
  amendsLabOrderId: null,
  amendmentReason: null,
  hasReportFile: false,
  resultsVisible: true,
  items: [
    {
      id: 'i1',
      test: hb,
      result: {
        valueNumeric: 18.2,
        valueText: null,
        flag: 'HIGH',
        unit: 'g/dL',
        referenceLow: 13,
        referenceHigh: 17,
        enteredBy: { id: 'tech', firstName: 'T', lastName: 'K' },
        enteredAt: '2026-11-16T06:00:00.000Z',
      },
    },
  ],
  ...over,
});

beforeEach(() => {
  document.cookie = 'mc_csrf=' + 'c'.repeat(43) + '; path=/';
});
afterEach(() => vi.restoreAllMocks());

describe('LabOrderCard', () => {
  it('shows approved values with the flag as words and the snapshot range (LAB-006)', () => {
    signIn('DOCTOR', 'doc');
    wrap(<LabOrderCard order={order()} tz="UTC" />);
    expect(screen.getByText('18.2')).toBeInTheDocument();
    expect(screen.getByText('HIGH')).toBeInTheDocument();
    expect(screen.getByText('13 to 17')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Report PDF/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });

  it('hides values before approval and lets only the orderer cancel, with a reason (LAB-005, DEC-040)', async () => {
    signIn('DOCTOR', 'doc');
    const calls: { url: string; body: unknown }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      calls.push({ url: String(input), body: init?.body ? JSON.parse(String(init.body)) : null });
      return Promise.resolve(ok(order({ status: 'CANCELLED' })));
    });
    wrap(
      <LabOrderCard
        order={order({
          status: 'ORDERED',
          approvedAt: null,
          approvedBy: null,
          resultsVisible: false,
          items: [{ id: 'i1', test: hb, result: null }],
        })}
        tz="UTC"
      />,
    );
    expect(screen.queryByText('18.2')).toBeNull();
    expect(screen.getByText(/once a senior technician approves/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Report PDF/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(await screen.findByText(/Give a reason/)).toBeInTheDocument();
    expect(calls).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/Reason/), { target: { value: 'Duplicate order' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    await waitFor(() =>
      expect(calls[0]).toEqual({
        url: '/api/lab-orders/o1/cancel',
        body: { reason: 'Duplicate order' },
      }),
    );
  });

  it('gives no cancel button to a doctor who did not order', () => {
    signIn('DOCTOR', 'other');
    wrap(<LabOrderCard order={order({ status: 'ORDERED', resultsVisible: false })} tz="UTC" />);
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
  });
});

describe('LabOrderWork', () => {
  const serve = (o: LabOrder, sent: { url: string; method?: string; body: unknown }[]) =>
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (init?.method && init.method !== 'GET') {
        sent.push({
          url,
          method: init.method,
          body: init.body ? JSON.parse(String(init.body)) : null,
        });
        return Promise.resolve(
          ok({ ...o, status: url.endsWith('/approve') ? 'APPROVED' : 'RESULT_UPLOADED' }),
        );
      }
      if (url.startsWith('/api/hospitals/h1'))
        return Promise.resolve(ok({ id: 'h1', timezone: 'UTC' }));
      if (url.startsWith('/api/lab-tests'))
        return Promise.resolve(ok([test], { page: 1, limit: 100, total: 1, totalPages: 1 }));
      return Promise.resolve(ok(o));
    });

  it('previews the flag from the most specific range and submits numbers (LAB-003)', async () => {
    signIn('LAB_TECHNICIAN', 'tech');
    const sent: { url: string; method?: string; body: unknown }[] = [];
    serve(
      order({
        status: 'PROCESSING',
        approvedAt: null,
        approvedBy: null,
        items: [{ id: 'i1', test: hb, result: null }],
      }),
      sent,
    );
    wrap(<LabOrderWork id="o1" />);
    const input = await screen.findByLabelText('Value for Haemoglobin (g/dL)');
    fireEvent.change(input, { target: { value: '12.5' } });
    // Adult male range 13 to 17 wins over the general 12 to 16.
    expect(await screen.findByText('LOW')).toBeInTheDocument();
    expect(screen.getByText('Reference 13 to 17 g/dL')).toBeInTheDocument();
    fireEvent.change(input, { target: { value: '17' } });
    expect(await screen.findByText('Normal')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Send for approval' }));
    await waitFor(() =>
      expect(sent[0]).toEqual({
        url: '/api/lab-orders/o1/result',
        method: 'PATCH',
        body: { results: [{ itemId: 'i1', valueNumeric: 17 }], submit: true },
      }),
    );
  });

  it('tells a senior who entered results that another senior must review', async () => {
    signIn('LAB_TECHNICIAN', 'tech');
    serve(order({ status: 'RESULT_UPLOADED', approvedAt: null, approvedBy: null }), []);
    wrap(<LabOrderWork id="o1" />);
    expect(await screen.findByText(/another senior must review it/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve report' })).toBeInTheDocument();
  });

  it('sends a report back only with a reason (DEC-040 D7)', async () => {
    signIn('LAB_TECHNICIAN', 'senior');
    const sent: { url: string; method?: string; body: unknown }[] = [];
    serve(order({ status: 'RESULT_UPLOADED', approvedAt: null, approvedBy: null }), sent);
    wrap(<LabOrderWork id="o1" />);
    expect(screen.queryByText(/another senior must review it/)).toBeNull();
    fireEvent.click(await screen.findByRole('button', { name: 'Send back' }));
    fireEvent.change(screen.getByLabelText(/What needs correcting/), {
      target: { value: 'Recheck the sample label' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Send back' }));
    await waitFor(() =>
      expect(sent[0]).toEqual({
        url: '/api/lab-orders/o1/reject',
        method: 'PATCH',
        body: { reason: 'Recheck the sample label' },
      }),
    );
  });
});
