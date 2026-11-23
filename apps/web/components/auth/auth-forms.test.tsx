import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LoginForm } from './login-form';
import { RegisterForm } from './register-form';
import { ResetPasswordForm } from './reset-password-form';
import { useAuth } from '@/store/auth';

const replace = vi.fn();
const push = vi.fn();
let search = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace, push }),
  useSearchParams: () => search,
  usePathname: () => '/login',
}));

const ok = (data: unknown) =>
  new Response(JSON.stringify({ success: true, data, message: 'OK' }), { status: 200 });
const fail = (status: number, code: string, message: string, details?: unknown) =>
  new Response(JSON.stringify({ success: false, error: { code, message, details } }), { status });

const session = {
  accessToken: 'a',
  expiresIn: 900,
  csrfToken: 'c'.repeat(43),
  user: {
    id: 'u1',
    email: 'asha@example.com',
    phone: null,
    firstName: 'Asha',
    lastName: 'Rao',
    role: 'DOCTOR',
    hospitalId: 'h',
    emailVerified: true,
    phoneVerified: false,
  },
  hospital: { id: 'h', name: 'City Care', code: 'CITYCARE' },
  permissions: [],
};

const type = (label: RegExp, value: string) => {
  const el = screen.getByLabelText(label);
  fireEvent.change(el, { target: { value } });
  fireEvent.blur(el);
};

/** Routes mocked fetch calls by path; the sign-in page first tries a silent refresh (no session). */
function api(routes: Record<string, () => Response>) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation((input) => {
    const path = String(input).replace(/^\/api/, '');
    const route =
      routes[path] ??
      (path === '/auth/refresh' ? () => fail(401, 'REFRESH_TOKEN_INVALID', 'x') : undefined);
    return Promise.resolve(route ? route() : fail(404, 'NOT_FOUND', path));
  });
}
const calls = (spy: ReturnType<typeof api>, path: string) =>
  spy.mock.calls.filter(([u]) => String(u) === `/api${path}`);

beforeEach(() => {
  useAuth.setState({
    status: 'idle',
    me: null,
    accessToken: null,
    expiresAt: null,
    expired: false,
  });
  document.cookie = 'mc_csrf=' + 'c'.repeat(43) + '; path=/';
  search = new URLSearchParams();
  replace.mockReset();
  push.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe('LoginForm', () => {
  it('validates before calling the API', async () => {
    const spy = api({});
    render(<LoginForm />);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(calls(spy, '/auth/login')).toHaveLength(0);
  });

  it('sends an already signed-in user straight to their area', async () => {
    api({ '/auth/refresh': () => ok(session) });
    render(<LoginForm />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
  });

  it('signs in and redirects to the role home (or a safe ?next=)', async () => {
    search = new URLSearchParams({ next: '/dashboard/account' });
    api({ '/auth/login': () => ok(session) });
    render(<LoginForm />);
    type(/^Email/, 'asha@example.com');
    type(/^Password/, 'Correct-horse-42');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard/account'));
  });

  it('shows the server error and a verification link for unverified accounts', async () => {
    api({
      '/auth/login': () =>
        fail(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address before signing in.'),
    });
    render(<LoginForm />);
    type(/^Email/, 'asha@example.com');
    type(/^Password/, 'whatever');
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Verify your email address before signing in.',
    );
    expect(screen.getByRole('link', { name: 'Verify your email' })).toHaveAttribute(
      'href',
      '/verify-email?email=asha%40example.com',
    );
    expect(replace).not.toHaveBeenCalled();
  });

  it('explains an expired session', () => {
    search = new URLSearchParams({ expired: '1' });
    render(<LoginForm />);
    expect(screen.getByText('Your session has ended')).toBeInTheDocument();
  });
});

describe('RegisterForm', () => {
  const fill = () => {
    type(/^Hospital code/, 'citycare');
    type(/^First name/, 'Asha');
    type(/^Last name/, 'Rao');
    type(/^Email/, 'asha@example.com');
    type(/^Date of birth/, '1990-04-21');
    fireEvent.change(screen.getByLabelText(/^Gender/), { target: { value: 'FEMALE' } });
    type(/^Password \(required\)/, 'Correct-horse-42');
    type(/^Confirm password/, 'Correct-horse-42');
  };

  it('blocks mismatched passwords and weak passwords client-side', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    render(<RegisterForm />);
    fill();
    type(/^Confirm password/, 'Different-pass-1');
    type(/^Password \(required\)/, 'short');
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(screen.getByText('Use at least 10 characters.')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('submits the API contract and goes to email verification', async () => {
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        ok({ userId: 'u', email: 'asha@example.com', emailVerificationRequired: true }),
      );
    render(<RegisterForm />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() =>
      expect(push).toHaveBeenCalledWith('/verify-email?email=asha%40example.com&new=1'),
    );
    const body = JSON.parse(spy.mock.calls[0]![1]!.body as string);
    expect(body).toEqual({
      hospitalCode: 'CITYCARE',
      firstName: 'Asha',
      lastName: 'Rao',
      email: 'asha@example.com',
      dateOfBirth: '1990-04-21',
      gender: 'FEMALE',
      password: 'Correct-horse-42',
    });
  });

  it('shows an unknown hospital code on the field', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      fail(400, 'INVALID_HOSPITAL_CODE', 'No active hospital uses this code.'),
    );
    render(<RegisterForm />);
    fill();
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('No active hospital uses this code.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Hospital code/)).toHaveAttribute('aria-invalid', 'true');
  });
});

describe('ResetPasswordForm', () => {
  it('refuses a missing or malformed token without calling the API', () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    render(<ResetPasswordForm />);
    expect(screen.getByText('This reset link cannot be used')).toBeInTheDocument();
    expect(spy).not.toHaveBeenCalled();
  });

  it('resets and returns to sign-in', async () => {
    search = new URLSearchParams({ token: 'a'.repeat(43) });
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(ok({ reset: true }));
    render(<ResetPasswordForm />);
    type(/^New password/, 'Brand-new-pass-7');
    type(/^Confirm new password/, 'Brand-new-pass-7');
    fireEvent.click(screen.getByRole('button', { name: 'Change password' }));
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login?notice=reset'));
  });
});
