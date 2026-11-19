import type { MedicalRecord, Medicine, Prescription } from '@medcore/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuth } from '@/store/auth';
import { PrescriptionCard } from './prescription-card';
import { PrescriptionForm, StockBadge } from './prescription-form';

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
const med: Medicine = {
  id: 'm1',
  name: 'Augmentin',
  genericName: 'Amoxicillin',
  form: 'TABLET',
  strength: '625 mg',
  reorderLevel: 10,
  isActive: true,
  taxClassificationId: null,
  available: 40,
};
const record = {
  id: 'r1',
  patient: { id: 'p1', firstName: 'Pat', lastName: 'One', mrn: 'MRN-1' },
} as unknown as MedicalRecord;
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
      medicine: {
        id: 'm1',
        name: 'Augmentin',
        genericName: 'Amoxicillin',
        form: 'TABLET',
        strength: '625 mg',
      },
      dosage: '625 mg',
      frequency: 'BD',
      durationDays: 5,
      quantity: 10,
      instructions: 'After food',
      dispensedQuantity: 0,
    },
  ],
  allergyOverrideReason: null,
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

describe('StockBadge', () => {
  it('shows out, low and in stock as text', () => {
    const { rerender } = render(<StockBadge m={{ available: 0, reorderLevel: 5 }} />);
    expect(screen.getByText('Out of stock')).toBeInTheDocument();
    rerender(<StockBadge m={{ available: 4, reorderLevel: 5 }} />);
    expect(screen.getByText('Low stock: 4')).toBeInTheDocument();
    // Strictly below the reorder level (PHARM-003, owner decision): equal is not low.
    rerender(<StockBadge m={{ available: 5, reorderLevel: 5 }} />);
    expect(screen.getByText('In stock: 5')).toBeInTheDocument();
    rerender(<StockBadge m={{ available: 6, reorderLevel: 5 }} />);
    expect(screen.getByText('In stock: 6')).toBeInTheDocument();
  });
});

describe('PrescriptionForm', () => {
  it('suggests quantity, then handles an allergy conflict with an acknowledged reason (RX-005, DEC-040 D4)', async () => {
    signIn('DOCTOR', 'doc');
    const posts: unknown[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      const url = String(input);
      if (url.startsWith('/api/medicines?'))
        return Promise.resolve(ok([med], { page: 1, limit: 8, total: 1, totalPages: 1 }));
      if (url === '/api/prescriptions' && init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        posts.push(body);
        return Promise.resolve(
          body.allergyOverrideReason
            ? ok(rx())
            : json(409, {
                success: false,
                error: {
                  code: 'ALLERGY_CONFLICT',
                  message: 'Allergy',
                  details: {
                    conflicts: [
                      {
                        allergyId: 'a1',
                        substance: 'Amoxicillin',
                        medicineId: 'm1',
                        medicineName: 'Augmentin 625 mg',
                      },
                    ],
                  },
                },
              }),
        );
      }
      throw new Error(`unexpected ${url}`);
    });
    const onClose = vi.fn();
    wrap(<PrescriptionForm record={record} onClose={onClose} />);
    fireEvent.click(await screen.findByRole('button', { name: /Augmentin 625 mg/ }));
    const line = await screen.findByRole('list', { name: 'Medicines on this prescription' });
    expect(within(line).getByLabelText(/^Quantity/)).toHaveValue(10);
    fireEvent.change(within(line).getByLabelText(/^Frequency/), { target: { value: 'TDS' } });
    fireEvent.change(within(line).getByLabelText(/^Days/), { target: { value: '7' } });
    expect(within(line).getByLabelText(/^Quantity/)).toHaveValue(21);
    fireEvent.change(within(line).getByLabelText(/^Instructions/), {
      target: { value: 'After food' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Issue prescription' }));
    expect(await screen.findByText(/matches the recorded allergy to/)).toBeInTheDocument();
    expect(posts[0]).toEqual({
      medicalRecordId: 'r1',
      items: [
        {
          medicineId: 'm1',
          dosage: '625 mg',
          frequency: 'TDS',
          durationDays: 7,
          quantity: 21,
          instructions: 'After food',
        },
      ],
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prescribe despite allergy' }));
    expect(
      await screen.findByText('Give a reason for prescribing despite the allergy.'),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Reason for prescribing despite the allergy/), {
      target: { value: 'Mild past rash; monitored' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Prescribe despite allergy' }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(posts[1]).toMatchObject({ allergyOverrideReason: 'Mild past rash; monitored' });
  });
});

describe('PrescriptionCard', () => {
  const tz = 'Asia/Kolkata';
  it('lets only the prescribing doctor cancel an undispensed prescription, with a reason', async () => {
    signIn('DOCTOR', 'doc');
    const calls: { url: string; body: unknown }[] = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
      calls.push({
        url: String(input),
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      return Promise.resolve(ok(rx({ status: 'CANCELLED', cancellationReason: 'Wrong dose' })));
    });
    wrap(<PrescriptionCard rx={rx()} tz={tz} />);
    expect(screen.getByRole('button', { name: /PDF/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: 'Wrong dose' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel prescription' }));
    await waitFor(() =>
      expect(calls[0]).toEqual({
        url: '/api/prescriptions/rx1/cancel',
        body: { reason: 'Wrong dose' },
      }),
    );
  });

  it('shows the PDF as being prepared, and no cancel for others or after dispensing', () => {
    signIn('DOCTOR', 'other');
    const { rerender } = wrap(<PrescriptionCard rx={rx({ pdfReady: false })} tz={tz} />);
    expect(screen.getByText('PDF being prepared')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    signIn('DOCTOR', 'doc');
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <PrescriptionCard
          rx={rx({ items: [{ ...rx().items[0]!, dispensedQuantity: 4 }] })}
          tz={tz}
        />
      </QueryClientProvider>,
    );
    expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
    expect(screen.getByText('4 of 10')).toBeInTheDocument();
  });
});
