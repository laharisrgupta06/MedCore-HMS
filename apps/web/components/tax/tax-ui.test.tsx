import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STAFF_NAV } from '@/constants/navigation';
import { useAuth } from '@/store/auth';
import { TaxSettingsView } from './tax-settings-view';

/** Tax settings screen (8-B2): real requests, read-only for accountants, lock and rule messages shown. */
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard/tax',
  useSearchParams: () => new URLSearchParams(),
}));

const ok = (data: unknown, meta?: unknown) =>
  new Response(JSON.stringify({ success: true, data, ...(meta ? { meta } : {}), message: 'OK' }), {
    status: 200,
  });
const fail = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ success: false, error: { code, message } }), { status });
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

const settings = {
  taxDate: '2026-11-19',
  timezone: 'Asia/Kolkata',
  timezoneLocked: true,
  setupConfirmedAt: null,
  classifications: [
    {
      id: 'c1',
      name: 'Consultations',
      supplyType: 'SERVICE',
      hsnSac: '999312',
      isActive: true,
      usedAsDefault: true,
      versions: [
        {
          id: 'v1',
          treatment: 'EXEMPT',
          ratePercent: '0.00',
          priceIncludesTax: false,
          effectiveFrom: '2026-11-01',
          inForce: true,
          editable: false,
        },
      ],
    },
    {
      id: 'c2',
      name: 'Medicaments',
      supplyType: 'GOODS',
      hsnSac: '3004',
      isActive: true,
      usedAsDefault: false,
      versions: [
        {
          id: 'v2',
          treatment: 'TAXABLE',
          ratePercent: '12.00',
          priceIncludesTax: true,
          effectiveFrom: '2026-12-01',
          inForce: false,
          editable: true,
        },
      ],
    },
  ],
  defaults: [{ kind: 'CONSULTATION', classificationId: 'c1' }],
  registrations: [],
  roomRules: [
    {
      effectiveFrom: '2017-07-01',
      thresholdPerDay: '5000.00',
      ratePercent: '5.00',
      sacCode: '999311',
      legalReference: 'Notification 12/2017',
    },
  ],
};
const medicines = [
  {
    id: 'm1',
    name: 'Crocin',
    genericName: null,
    form: 'TABLET',
    strength: '500 mg',
    reorderLevel: 5,
    isActive: true,
    available: 10,
    taxClassificationId: null,
  },
];

function route(overrides: Record<string, () => Response> = {}) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = String(input);
    const key = `${init?.method ?? 'GET'} ${url.replace(/^.*\/api/, '').split('?')[0]}`;
    if (overrides[key]) return overrides[key]();
    if (key === 'GET /tax/settings') return ok(settings);
    if (key === 'GET /medicines')
      return ok(medicines, { page: 1, limit: 20, total: 1, totalPages: 1 });
    if (key.startsWith('PUT /tax/assignments/medicines/'))
      return ok({ id: 'm1', taxClassificationId: 'c2' });
    throw new Error(`unexpected ${key}`);
  });
}

beforeEach(() => {
  document.cookie = 'mc_csrf=' + 'c'.repeat(43) + '; path=/';
});
afterEach(() => vi.restoreAllMocks());

describe('Tax settings', () => {
  it('appears in navigation for hospital admins and accountants only', () => {
    const item = STAFF_NAV.find((n) => n.href === '/dashboard/tax')!;
    expect([...item.roles].sort()).toEqual(['ACCOUNTANT', 'HOSPITAL_ADMIN']);
  });

  it('shows the lock, versions, defaults and the room rule; confirmation waits for both defaults', async () => {
    useAuth.setState({
      status: 'authenticated',
      me: me('HOSPITAL_ADMIN') as never,
      accessToken: 't',
    });
    route();
    wrap(<TaxSettingsView />);
    expect(await screen.findByText('Time zone locked')).toBeInTheDocument();
    expect(screen.getByText('Not yet confirmed')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm tax set-up' })).toBeDisabled();
    expect(screen.getByText(/Choose the lab default first/)).toBeInTheDocument();
    expect(screen.getByText('No GST registration recorded')).toBeInTheDocument();
    expect(screen.getAllByText('12% GST, included in price').length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Correct' })).toBeInTheDocument(); // future version only
    // A default cannot be deactivated from the screen either.
    expect(screen.getAllByRole('button', { name: 'Deactivate' })[0]).toBeDisabled();
    expect(screen.getByText(/attract 5% GST/)).toBeInTheDocument();
  });

  it('is read-only for accountants', async () => {
    useAuth.setState({ status: 'authenticated', me: me('ACCOUNTANT') as never, accessToken: 't' });
    route();
    wrap(<TaxSettingsView />);
    await screen.findByText('Tax classifications');
    expect(
      screen.queryByRole('button', {
        name: /New classification|Record registration|Confirm|Correct|Deactivate/,
      }),
    ).toBeNull();
    expect(await screen.findByText('Not classified')).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: /Tax classification for/ })).toBeNull();
  });

  it('assigns a medicine classification with a real request, offering only goods classifications', async () => {
    useAuth.setState({
      status: 'authenticated',
      me: me('HOSPITAL_ADMIN') as never,
      accessToken: 't',
    });
    const spy = route();
    wrap(<TaxSettingsView />);
    const select = await screen.findByRole('combobox', { name: 'Tax classification for Crocin' });
    expect(within(select).queryByText('Consultations')).toBeNull();
    fireEvent.change(select, { target: { value: 'c2' } });
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith(
        expect.stringContaining('/api/tax/assignments/medicines/m1'),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({ classificationId: 'c2' }),
        }),
      ),
    );
  });

  it('validates a GSTIN before sending and shows the server rule message', async () => {
    useAuth.setState({
      status: 'authenticated',
      me: me('HOSPITAL_ADMIN') as never,
      accessToken: 't',
    });
    const spy = route({
      'POST /tax/registrations': () =>
        fail(
          409,
          'GSTIN_UNAVAILABLE',
          'This GSTIN is already registered to another hospital on MedCore.',
        ),
    });
    wrap(<TaxSettingsView />);
    fireEvent.click(await screen.findByRole('button', { name: /Record registration/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/GSTIN/), {
      target: { value: '27AAPFU0939F1ZX' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Legal name/), {
      target: { value: 'City Hospitals LLP' },
    });
    fireEvent.click(within(dialog).getByRole('checkbox'));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record registration' }));
    expect(
      await within(dialog).findByText('Enter a valid 15-character GSTIN.'),
    ).toBeInTheDocument();
    expect(
      spy.mock.calls.some(
        ([u, i]) => String(u).includes('/tax/registrations') && i?.method === 'POST',
      ),
    ).toBe(false);
    fireEvent.change(within(dialog).getByLabelText(/GSTIN/), {
      target: { value: '27aapfu0939f1zv' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Record registration' }));
    expect(
      await within(dialog).findByText(/already registered to another hospital/),
    ).toBeInTheDocument();
    const sent = spy.mock.calls.find(
      ([u, i]) => String(u).includes('/tax/registrations') && i?.method === 'POST',
    )!;
    expect(JSON.parse(String(sent[1]!.body))).toMatchObject({
      registrationType: 'REGULAR',
      gstin: '27AAPFU0939F1ZV',
    });
  });
});
