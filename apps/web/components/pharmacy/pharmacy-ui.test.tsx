import type { Medicine, PharmacyAlerts, Prescription, StockBatch } from '@medcore/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/store/auth';
import { PharmacyAlertsView } from './alerts-view';
import { MedicineStockView } from './inventory-view';
import { PharmacyPrescriptionView } from './queue-view';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard/pharmacy',
  useSearchParams: () => new URLSearchParams(),
}));

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const ok = (data: unknown, meta?: unknown) =>
  json(200, { success: true, data, ...(meta ? { meta } : {}), message: 'OK' });
const page = { page: 1, limit: 20, total: 0, totalPages: 0 };
const wrap = (ui: ReactNode) =>
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      {ui}
    </QueryClientProvider>,
  );
const signIn = (role: string) =>
  useAuth.setState({
    status: 'authenticated',
    accessToken: 't',
    me: {
      user: {
        id: 'u1',
        email: 'a@b.c',
        phone: null,
        firstName: 'Phil',
        lastName: 'Ma',
        role,
        hospitalId: 'h1',
        emailVerified: true,
        phoneVerified: false,
      },
      hospital: { id: 'h1', name: 'City', code: 'CITY' },
      permissions: [],
    } as never,
  });
const iso = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const batch = (over: Partial<StockBatch>): StockBatch => ({
  id: 'b',
  medicineId: 'm1',
  batchNumber: 'B',
  manufacturedOn: iso(-300),
  expiresOn: iso(100),
  quantity: 10,
  unitCost: '1.00',
  mrp: '2.00',
  status: 'ACTIVE',
  receivedAt: '2026-01-01T00:00:00.000Z',
  expired: false,
  ...over,
});
const rx = (over: Partial<Prescription> = {}): Prescription => ({
  id: 'rx1',
  status: 'ISSUED',
  issuedAt: '2026-11-16T05:00:00.000Z',
  notes: null,
  medicalRecordId: 'r1',
  patient: { id: 'p1', firstName: 'Pat', lastName: 'One', mrn: 'MRN-1' },
  doctor: { id: 'd1', userId: 'doc', firstName: 'Dee', lastName: 'Rao', specialisation: 'General' },
  items: [
    {
      id: 'i1',
      medicine: { id: 'm1', name: 'Crocin', genericName: null, form: 'TABLET', strength: '500 mg' },
      dosage: '500 mg',
      frequency: 'TDS',
      durationDays: 5,
      quantity: 15,
      instructions: null,
      dispensedQuantity: 0,
    },
  ],
  allergyOverrideReason: 'Mild rash only',
  pdfReady: true,
  verifiedAt: null,
  verifiedBy: null,
  cancelledAt: null,
  cancellationReason: null,
  history: [],
  ...over,
});

beforeEach(() => {
  document.cookie = 'mc_csrf=' + 'c'.repeat(43) + '; path=/';
});
afterEach(() => vi.restoreAllMocks());

describe('PharmacyPrescriptionView', () => {
  const serve = (
    p: Prescription,
    batches: StockBatch[],
    sent: { url: string; method: string; body: unknown }[],
  ) =>
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (init?.method && init.method !== 'GET') {
        sent.push({
          url,
          method: init.method,
          body: init.body ? JSON.parse(String(init.body)) : null,
        });
        return Promise.resolve(
          ok(
            url.endsWith('/verify')
              ? { ...p, verifiedAt: '2026-11-16T06:00:00.000Z' }
              : { ...p, status: 'PARTIALLY_DISPENSED' },
          ),
        );
      }
      if (url.startsWith('/api/hospitals/h1'))
        return Promise.resolve(ok({ id: 'h1', timezone: 'Asia/Kolkata' }));
      if (url === '/api/medicines/m1/batches') return Promise.resolve(ok(batches));
      return Promise.resolve(ok(p));
    });

  it('asks for verification first and shows the allergy note (PHARM-006, DEC-040 D4)', async () => {
    signIn('PHARMACIST');
    const sent: { url: string; method: string; body: unknown }[] = [];
    serve(rx(), [], sent);
    wrap(<PharmacyPrescriptionView id="rx1" />);
    expect(await screen.findByText(/Mild rash only/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Dispense/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Verify prescription' }));
    await waitFor(() =>
      expect(sent[0]).toEqual({
        url: '/api/pharmacy/prescriptions/rx1/verify',
        method: 'PATCH',
        body: {},
      }),
    );
  });

  it('previews FIFO batches, skipping expired and quarantined ones, and sends the exact dispense body (PHARM-002/004)', async () => {
    signIn('PHARMACIST');
    const sent: { url: string; method: string; body: unknown }[] = [];
    serve(
      rx({
        verifiedAt: '2026-11-16T06:00:00.000Z',
        verifiedBy: { firstName: 'Phil', lastName: 'Ma' },
      }),
      [
        batch({ id: 'late', batchNumber: 'LATE', expiresOn: iso(200), quantity: 30 }),
        batch({ id: 'soon', batchNumber: 'SOON', expiresOn: iso(20), quantity: 6 }),
        batch({ id: 'old', batchNumber: 'OLD', expiresOn: iso(-1), quantity: 50, expired: true }),
        batch({
          id: 'q',
          batchNumber: 'QUAR',
          expiresOn: iso(5),
          quantity: 50,
          status: 'QUARANTINED',
        }),
      ],
      sent,
    );
    wrap(<PharmacyPrescriptionView id="rx1" />);
    const input = await screen.findByLabelText('Units to give of Crocin');
    fireEvent.change(input, { target: { value: '8' } });
    expect(
      await screen.findByText(/From SOON \(6, expires .*\), LATE \(2, expires .*\)/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/OLD|QUAR/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Dispense/ }));
    await waitFor(() =>
      expect(sent[0]).toEqual({
        url: '/api/pharmacy/prescriptions/rx1/dispense',
        method: 'POST',
        body: { items: [{ itemId: 'i1', quantity: 8 }] },
      }),
    );
  });

  it('shows the append-only history, including who acted (M-10)', async () => {
    signIn('PHARMACIST');
    serve(
      rx({
        status: 'READY_FOR_PICKUP',
        verifiedAt: '2026-11-16T06:00:00.000Z',
        history: [
          {
            kind: 'ISSUED',
            status: 'ISSUED',
            occurredAt: '2026-11-16T05:00:00.000Z',
            actor: { firstName: 'Dee', lastName: 'Rao' },
            reason: null,
          },
          {
            kind: 'VERIFIED',
            status: 'ISSUED',
            occurredAt: '2026-11-16T06:00:00.000Z',
            actor: { firstName: 'Phil', lastName: 'Ma' },
            reason: null,
          },
          {
            kind: 'DISPENSED',
            status: 'READY_FOR_PICKUP',
            occurredAt: '2026-11-16T06:10:00.000Z',
            actor: { firstName: 'Phil', lastName: 'Ma' },
            reason: null,
          },
        ],
      }),
      [],
      [],
    );
    wrap(<PharmacyPrescriptionView id="rx1" />);
    const list = await screen.findByRole('list', { name: 'Prescription history' });
    expect(list.textContent).toMatch(
      /Issued.*Dee Rao.*Verified by the pharmacy.*Phil Ma.*Dispensed, ready for collection/,
    );
  });

  it('warns in text when usable stock is short', async () => {
    signIn('PHARMACIST');
    serve(
      rx({ verifiedAt: '2026-11-16T06:00:00.000Z' }),
      [batch({ id: 's', batchNumber: 'S', quantity: 4 })],
      [],
    );
    wrap(<PharmacyPrescriptionView id="rx1" />);
    fireEvent.change(await screen.findByLabelText('Units to give of Crocin'), {
      target: { value: '10' },
    });
    expect(await screen.findByText('Only 4 in usable stock.')).toBeInTheDocument();
  });
});

describe('MedicineStockView', () => {
  const med: Medicine = {
    id: 'm1',
    name: 'Crocin',
    genericName: null,
    form: 'TABLET',
    strength: '500 mg',
    reorderLevel: 5,
    isActive: true,
    taxClassificationId: null,
    available: 4,
  };
  it('shows batch states, the nightly run as performer, and adjusts with a reason (exact body)', async () => {
    signIn('PHARMACIST');
    const sent: { url: string; body: unknown }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (init?.method === 'POST') {
        sent.push({ url, body: JSON.parse(String(init.body)) });
        return Promise.resolve(ok(batch({})));
      }
      if (url.startsWith('/api/hospitals/h1'))
        return Promise.resolve(ok({ id: 'h1', timezone: 'Asia/Kolkata' }));
      if (url === '/api/medicines/m1/batches')
        return Promise.resolve(
          ok([
            batch({ id: 'a', batchNumber: 'EXP', expired: true }),
            batch({ id: 'b2', batchNumber: 'Q', status: 'QUARANTINED' }),
            batch({ id: 'c', batchNumber: 'OK', quantity: 4 }),
          ]),
        );
      if (url.startsWith('/api/pharmacy/ledger'))
        return Promise.resolve(
          ok(
            [
              {
                id: 'l1',
                type: 'QUARANTINE',
                quantity: 9,
                reason: 'Expired on 2026-11-15; quarantined by the nightly expiry run',
                createdAt: '2026-11-16T20:31:00.000Z',
                batch: { id: 'a', batchNumber: 'EXP', expiresOn: '2026-11-15' },
                medicine: { id: 'm1', name: 'Crocin', strength: '500 mg' },
                performedBy: null,
                dispenseId: null,
              },
            ],
            { ...page, total: 1, totalPages: 1 },
          ),
        );
      return Promise.resolve(ok([]));
    });
    wrap(<MedicineStockView medicine={med} onBack={() => undefined} />);
    expect(await screen.findByText('Low stock: 4')).toBeInTheDocument();
    expect((await screen.findAllByText('Expired')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Quarantined').length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Nightly expiry run')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('9 set aside').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole('button', { name: 'Adjust' })[2]!);
    fireEvent.change(screen.getByLabelText(/Change in units/), { target: { value: '-5' } });
    fireEvent.change(screen.getByLabelText(/^Reason/), { target: { value: 'Count' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save adjustment' }));
    expect(await screen.findByText('Only 4 units are in this batch.')).toBeInTheDocument();
    expect(sent).toHaveLength(0);
    fireEvent.change(screen.getByLabelText(/Change in units/), { target: { value: '-2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save adjustment' }));
    await waitFor(() =>
      expect(sent[0]).toEqual({
        url: '/api/batches/c/adjustments',
        body: { quantity: -2, reason: 'Count' },
      }),
    );
  });

  it('gives hospital admins a read-only view', async () => {
    signIn('HOSPITAL_ADMIN');
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) =>
      Promise.resolve(
        String(input).startsWith('/api/pharmacy/ledger')
          ? ok([], page)
          : ok(String(input).includes('/batches') ? [batch({})] : { id: 'h1', timezone: 'UTC' }),
      ),
    );
    wrap(<MedicineStockView medicine={med} onBack={() => undefined} />);
    expect((await screen.findAllByText('B')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: /Receive stock/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Adjust' })).toBeNull();
  });
});

describe('PharmacyAlertsView', () => {
  it('lists low stock, near expiry and the latest nightly report', async () => {
    signIn('PHARMACIST');
    const alerts: PharmacyAlerts = {
      lowStock: [
        {
          id: 'm1',
          name: 'Zinc',
          strength: '20 mg',
          form: 'TABLET',
          reorderLevel: 5,
          available: 0,
          lowStockSince: '2026-11-16T05:00:00.000Z',
        },
      ],
      expiringSoon: [
        {
          id: 'b1',
          batchNumber: 'S30',
          expiresOn: '2026-12-15',
          quantity: 3,
          medicine: { id: 'm2', name: 'Para', strength: '500 mg' },
        },
      ],
      latestReport: {
        id: 'r1',
        runDate: '2026-11-16',
        createdAt: '2026-11-15T20:37:00.000Z',
        items: [
          {
            batchId: 'b9',
            medicineId: 'm3',
            medicineName: 'Amox',
            strength: '250 mg',
            batchNumber: 'OLD',
            expiresOn: '2026-11-15',
            quantity: 9,
            kind: 'QUARANTINED',
          },
        ],
      },
    };
    vi.spyOn(globalThis, 'fetch').mockImplementation((input) =>
      Promise.resolve(
        String(input) === '/api/pharmacy/alerts'
          ? ok(alerts)
          : ok({ id: 'h1', timezone: 'Asia/Kolkata' }),
      ),
    );
    wrap(<PharmacyAlertsView />);
    expect(await screen.findByText('Out of stock')).toBeInTheDocument();
    expect(screen.getByText('S30')).toBeInTheDocument();
    expect(screen.getByText('Expired, quarantined')).toBeInTheDocument();
    expect(screen.getByText('OLD')).toBeInTheDocument();
  });
});
