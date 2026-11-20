import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PATIENT_NAV, STAFF_NAV } from '@/constants/navigation';
import { useAuth } from '@/store/auth';
import { InvoiceDetail } from './invoice-detail';
import { InvoiceList } from './invoice-list';

/** Billing screens (8-B3): real requests, actions by role, patients read-only. */
const push = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push }),
  usePathname: () => '/dashboard/invoices',
  useSearchParams: () => new URLSearchParams(),
}));

const ok = (data: unknown, meta?: unknown) =>
  new Response(JSON.stringify({ success: true, data, ...(meta ? { meta } : {}), message: 'OK' }), {
    status: 200,
  });
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
  hospital: { id: 'h1', name: 'City', code: 'CITY', timezone: 'Asia/Kolkata' },
  permissions: [],
});
const as = (role: string) =>
  useAuth.setState({ status: 'authenticated', me: me(role) as never, accessToken: 't' });

const line = (o: object) => ({
  id: 'l1',
  kind: 'CONSULTATION',
  description: 'Consultation with Dr Rao',
  quantity: 1,
  unitPrice: '500.00',
  serviceDate: '2026-11-19',
  unclassified: false,
  classificationName: 'Healthcare services',
  hsnSac: '999312',
  supplyType: 'SERVICE',
  treatment: 'EXEMPT',
  ratePercent: '0.00',
  priceIncludesTax: false,
  gstCollected: true,
  notCollectedReason: null,
  grossAmount: '500.00',
  discountShare: '0.00',
  taxableValue: '500.00',
  taxAmount: '0.00',
  lineTotal: '500.00',
  releasedAt: null,
  manual: false,
  ...o,
});
const invoice = (o: object = {}) => ({
  id: 'i1',
  kind: 'ORIGINAL',
  status: 'DRAFT',
  invoiceNumber: null,
  documentType: null,
  issueDate: null,
  total: '500.00',
  patient: { id: 'p1', name: 'Asha Rao', mrn: 'MC-1' },
  appointment: { id: 'a1', scheduledAt: '2026-11-19T05:00:00Z', doctorName: 'Rao' },
  createdAt: '2026-11-19T05:00:00Z',
  sequence: 1,
  relatedInvoiceId: null,
  lateChargeInvoiceIds: [],
  subtotal: '500.00',
  taxAmount: '0.00',
  discountAmount: '0.00',
  discountReason: null,
  voidReason: null,
  voidedAt: null,
  finalisedAt: null,
  seller: null,
  lines: [line({})],
  events: [{ kind: 'CREATED', actorName: 'Dr Rao', note: null, createdAt: '2026-11-19T05:00:00Z' }],
  correctionRequests: [],
  finaliseBlockers: [],
  ...o,
});
const options = {
  classifications: [
    { id: 'c1', name: 'Healthcare services', supplyType: 'SERVICE', hsnSac: '999312' },
  ],
  rooms: [{ id: 'r1', number: '101', type: 'PRIVATE', dailyCharge: '6000.00' }],
};

function route(view: object, extra: Record<string, () => Response> = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const key = `${init?.method ?? 'GET'} ${url.replace(/^.*\/api/, '').split('?')[0]}`;
    if (extra[key]) return extra[key]();
    if (key === 'GET /invoices/options') return ok(options);
    if (key.startsWith('GET /invoices/')) return ok(view);
    if (key === 'GET /invoices')
      return ok([invoice()], { page: 1, limit: 20, total: 1, totalPages: 1 });
    if (key.startsWith('POST /invoices/i1/items')) return ok(view);
    if (key === 'POST /invoices') return ok({ ...view, id: 'i2' });
    throw new Error(`unexpected ${key}`);
  });
}

beforeEach(() => {
  document.cookie = 'mc_csrf=' + 'c'.repeat(43) + '; path=/';
  push.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('billing screens', () => {
  it('navigation: staff invoices for reception, accounts and admin; bills for patients', () => {
    expect([...STAFF_NAV.find((n) => n.href === '/dashboard/invoices')!.roles].sort()).toEqual([
      'ACCOUNTANT',
      'HOSPITAL_ADMIN',
      'RECEPTIONIST',
    ]);
    expect(PATIENT_NAV.some((n) => n.href === '/portal/invoices')).toBe(true);
  });

  it('lists invoices with draft and number labels', async () => {
    as('RECEPTIONIST');
    route(invoice());
    wrap(<InvoiceList />);
    // The table renders each row for desktop and mobile layouts.
    const links = await screen.findAllByRole('link', { name: 'Draft' });
    for (const l of links) expect(l).toHaveAttribute('href', '/dashboard/invoices/i1');
    expect(screen.getAllByText('Asha Rao (MC-1)').length).toBeGreaterThan(0);
  });

  it('receptionist draft: explains blockers, finalise disabled, no discount', async () => {
    as('RECEPTIONIST');
    route(
      invoice({
        finaliseBlockers: ['UNCLASSIFIED_LINES'],
        lines: [line({ unclassified: true, treatment: null })],
      }),
    );
    wrap(<InvoiceDetail id="i1" />);
    expect(await screen.findByText(/Some charges have no tax classification/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Finalise' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Discount' })).toBeNull();
    expect(screen.getByRole('button', { name: /Add charge/ })).toBeInTheDocument();
  });

  it('accountant draft offers the discount', async () => {
    as('ACCOUNTANT');
    route(invoice());
    wrap(<InvoiceDetail id="i1" />);
    expect(await screen.findByRole('button', { name: 'Discount' })).toBeInTheDocument();
  });

  it('receptionist adds a room charge with a real request', async () => {
    as('RECEPTIONIST');
    const spy = route(invoice());
    wrap(<InvoiceDetail id="i1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Add charge/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(await within(dialog).findByLabelText(/^Room/), { target: { value: 'r1' } });
    fireEvent.change(within(dialog).getByLabelText(/^Days/), { target: { value: '2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add charge' }));
    await waitFor(() => {
      const call = spy.mock.calls.find(
        ([u, i]) => String(u).includes('/invoices/i1/items') && i?.method === 'POST',
      );
      expect(call).toBeDefined();
      expect(JSON.parse(String(call![1]!.body))).toMatchObject({
        kind: 'ROOM',
        roomId: 'r1',
        days: 2,
      });
    });
  });

  it('other charge needs a classification and a valid price before anything is sent', async () => {
    as('RECEPTIONIST');
    const spy = route(invoice());
    wrap(<InvoiceDetail id="i1" />);
    fireEvent.click(await screen.findByRole('button', { name: /Add charge/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(await within(dialog).findByLabelText(/^Charge/), {
      target: { value: 'OTHER' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Description/), {
      target: { value: 'Dressing' },
    });
    fireEvent.change(within(dialog).getByLabelText(/^Price/), { target: { value: '12.345' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add charge' }));
    expect(await within(dialog).findByText('Choose a tax classification.')).toBeInTheDocument();
    expect(
      within(dialog).getByText('Enter a price with at most two decimals.'),
    ).toBeInTheDocument();
    expect(
      spy.mock.calls.some(([u, i]) => String(u).includes('/items') && i?.method === 'POST'),
    ).toBe(false);
  });

  it('a void draft offers a replacement draft for the same visit', async () => {
    as('RECEPTIONIST');
    const spy = route(
      invoice({
        status: 'VOID',
        voidReason: 'Voided by mistake',
        lines: [line({ releasedAt: '2026-11-19T06:00:00Z' })],
      }),
    );
    wrap(<InvoiceDetail id="i1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Create replacement draft' }));
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard/invoices/i2'));
    const call = spy.mock.calls.find(
      ([u, i]) => String(u).endsWith('/api/invoices') && i?.method === 'POST',
    )!;
    expect(JSON.parse(String(call[1]!.body))).toEqual({ appointmentId: 'a1' });
    expect(screen.getByText(/released for a replacement draft/)).toBeInTheDocument();
  });

  it('an issued document: no edits, late charges and correction request offered, with the accountant guidance', async () => {
    as('RECEPTIONIST');
    route(
      invoice({
        status: 'FINALISED',
        invoiceNumber: 'BOS/26-27/00001',
        documentType: 'BILL_OF_SUPPLY',
        issueDate: '2026-11-19',
      }),
    );
    wrap(<InvoiceDetail id="i1" />);
    expect(await screen.findByRole('heading', { name: 'BOS/26-27/00001' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Void|Finalise|Add charge/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Add late charges' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request correction' })).toBeInTheDocument();
    expect(screen.getByText(/handled by the accountant outside MedCore/)).toBeInTheDocument();
  });

  it('patients see their bill read-only, without history', async () => {
    as('PATIENT');
    route(invoice({ status: 'FINALISED', invoiceNumber: 'BOS/26-27/00001', events: [] }));
    wrap(<InvoiceDetail id="i1" patient />);
    expect(await screen.findByRole('heading', { name: 'BOS/26-27/00001' })).toBeInTheDocument();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByText('History')).toBeNull();
    expect(screen.getByRole('link', { name: /My bills/ })).toHaveAttribute(
      'href',
      '/portal/invoices',
    );
  });
});
