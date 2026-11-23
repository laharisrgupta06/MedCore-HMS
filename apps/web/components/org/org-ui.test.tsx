import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Users } from 'lucide-react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DataTable } from '@/components/ui/data-table';
import { STAFF_NAV } from '@/constants/navigation';
import { useAuth } from '@/store/auth';
import { PatientsView } from './patients-view';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard/patients',
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
  hospital: { id: 'h1', name: 'City', code: 'CITY' },
  permissions: [],
});

beforeEach(() => {
  document.cookie = 'mc_csrf=' + 'c'.repeat(43) + '; path=/';
});
afterEach(() => vi.restoreAllMocks());

describe('DataTable states', () => {
  const cols = [{ key: 'n', header: 'Name', primary: true, cell: (r: { n: string }) => r.n }];
  it('shows loading, empty and error-with-retry states', () => {
    const { rerender } = render(
      <DataTable
        caption="X"
        columns={cols}
        rows={undefined}
        loading
        rowKey={(r) => r.n}
        empty={{ icon: Users, title: 'Nothing here' }}
      />,
    );
    expect(screen.getByText('Loading')).toBeInTheDocument();
    rerender(
      <DataTable
        caption="X"
        columns={cols}
        rows={[]}
        rowKey={(r) => r.n}
        empty={{ icon: Users, title: 'Nothing here' }}
      />,
    );
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
    const retry = vi.fn();
    rerender(
      <DataTable
        caption="X"
        columns={cols}
        rows={[]}
        error="Boom"
        onRetry={retry}
        rowKey={(r) => r.n}
        empty={{ icon: Users, title: 'Nothing here' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(retry).toHaveBeenCalled();
  });
});

describe('role-aware navigation', () => {
  const visible = (role: string) =>
    STAFF_NAV.filter((n) => n.roles.includes(role as never)).map((n) => n.label);
  it('shows administration only to administrators and hospitals only to Super Admin', () => {
    expect(visible('HOSPITAL_ADMIN')).toEqual(
      expect.arrayContaining([
        'Staff',
        'Departments',
        'Hospital settings',
        'Patients',
        'Doctors',
        'Rooms and beds',
      ]),
    );
    expect(visible('HOSPITAL_ADMIN')).not.toContain('Hospitals');
    expect(visible('SUPER_ADMIN')).toEqual(['Home', 'Hospitals', 'My account']);
    expect(visible('NURSE')).not.toContain('Staff');
    expect(visible('PHARMACIST')).not.toContain('Rooms and beds');
  });
});

describe('PatientsView', () => {
  it('lists patients from the API, and reception registers a patient with the exact contract', async () => {
    useAuth.setState({
      status: 'authenticated',
      me: me('RECEPTIONIST') as never,
      accessToken: 't',
    });
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      if (String(input).startsWith('/api/patients') && (!init?.method || init.method === 'GET'))
        return Promise.resolve(
          ok(
            [
              {
                id: 'p1',
                userId: 'x',
                mrn: 'MRN-2026-000001',
                firstName: 'Pat',
                lastName: 'One',
                email: 'p@x.y',
                phone: null,
                dateOfBirth: '1990-01-01',
                gender: 'FEMALE',
                bloodGroup: 'O_POSITIVE',
                emergencyContactName: null,
                emergencyContactPhone: null,
                isActive: true,
                createdAt: '',
              },
            ],
            { page: 1, limit: 20, total: 1, totalPages: 1 },
          ),
        );
      return Promise.resolve(
        ok({ id: 'p2', mrn: 'MRN-2026-000002', firstName: 'New', lastName: 'Patient' }),
      );
    });
    wrap(<PatientsView />);
    expect((await screen.findAllByText('MRN-2026-000001')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Register patient' }));
    const set = (label: RegExp, v: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value: v } });
    set(/^First name/, 'New');
    set(/^Last name/, 'Patient');
    set(/^Email/, 'new@example.com');
    set(/^Date of birth/, '1985-05-05');
    set(/^Gender/, 'MALE');
    fireEvent.click(screen.getAllByRole('button', { name: 'Register patient' }).at(-1)!);
    await waitFor(() =>
      expect(
        spy.mock.calls.some(([, i]) => i?.method === 'POST'),
        document.body.textContent ?? '',
      ).toBe(true),
    );
    const post = spy.mock.calls.find(([, i]) => i?.method === 'POST')!;
    expect(JSON.parse(post[1]!.body as string)).toEqual({
      firstName: 'New',
      lastName: 'Patient',
      phone: null,
      dateOfBirth: '1985-05-05',
      gender: 'MALE',
      bloodGroup: null,
      emergencyContactName: null,
      emergencyContactPhone: null,
      email: 'new@example.com',
    });
  });

  it('hides registration from roles that cannot register patients', async () => {
    useAuth.setState({ status: 'authenticated', me: me('DOCTOR') as never, accessToken: 't' });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      ok([], { page: 1, limit: 20, total: 0, totalPages: 0 }),
    );
    wrap(<PatientsView />);
    expect(await screen.findByText('No patients found')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Register patient' })).toBeNull();
  });
});
