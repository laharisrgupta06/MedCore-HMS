'use client';

import {
  PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  RECONCILIATION_STATES,
  type PaymentMethod,
  type ReconciliationState,
} from '@medcore/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Panel, Skeleton } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/forms';
import { fmtDate, localDate, useHospitalTz } from '@/lib/time';
import { paymentsApi } from '@/services/payments';
import { downloadBlob } from './payments-panel';
import { useAuth } from '@/store/auth';

const inr = (v: string) =>
  `₹${Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATE_LABEL: Record<ReconciliationState, string> = {
  all: 'All',
  open: 'Not reconciled',
  reconciled: 'Reconciled',
};

function addDays(day: string, n: number): string {
  const [y = 0, m = 1, d = 1] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

/** Reconciliation of received payments by date range (8-B5). Accountants mark rows; admins read them. */
export function Reconciliation() {
  const role = useAuth((s) => s.me?.user.role);
  const tz = useHospitalTz();
  const qc = useQueryClient();
  const today = localDate(new Date(), tz);
  const [from, setFrom] = useState(addDays(today, -6));
  const [to, setTo] = useState(today);
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [state, setState] = useState<ReconciliationState>('open');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const accountant = role === 'ACCOUNTANT';

  const q = useQuery({
    queryKey: ['reconciliation', from, to, method, state],
    queryFn: () => paymentsApi.reconciliation({ from, to, method: method || undefined, state }),
  });

  const toggle = (id: string) => {
    const next = new Set(picked);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  };

  const mark = async () => {
    setBusy(true);
    try {
      const r = await paymentsApi.markReconciled([...picked]);
      toast.success(`${r.marked} payment(s) marked as reconciled.`);
      setPicked(new Set());
      void qc.invalidateQueries({ queryKey: ['reconciliation'] });
      void qc.invalidateQueries({ queryKey: ['billing-summary'] });
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const invalidRange = from > to;

  /** Exports the rows shown as CSV (opens in any spreadsheet). Cells are quoted, and formula-like text is escaped. */
  const exportCsv = () => {
    if (!q.data) return;
    const cell = (v: string) => `"${(/^[=+\-@]/.test(v) ? `'${v}` : v).replace(/"/g, '""')}"`;
    const head = [
      'Received',
      'Patient',
      'MRN',
      'Invoice',
      'Method',
      'Received by',
      'Amount',
      'Reconciled at',
    ];
    const lines = q.data.rows.map((r) =>
      [
        r.paidAt,
        r.patientName,
        r.patientMrn,
        r.invoiceNumber ?? '',
        PAYMENT_METHOD_LABEL[r.method],
        r.receivedByName ?? 'Online',
        r.amount,
        r.reconciledAt ?? '',
      ]
        .map(cell)
        .join(','),
    );
    const blob = new Blob([[head.map(cell).join(','), ...lines].join('\r\n')], {
      type: 'text/csv',
    });
    downloadBlob(blob, `reconciliation-${from}-to-${to}.csv`);
  };

  return (
    <>
      <PageHeader
        title="Reconciliation"
        description="Received payments in a date range, checked against the bank or provider statement."
      />
      <div className="mb-4 grid gap-4 md:grid-cols-5">
        <Field label="From">
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          )}
        </Field>
        <Field label="To" error={invalidRange ? 'Must be on or after the start date.' : undefined}>
          {({ id, describedBy, invalid }) => (
            <Input
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          )}
        </Field>
        <Field label="Method">
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={method}
              onChange={(e) => setMethod(e.target.value as PaymentMethod | '')}
            >
              <option value="">All methods</option>
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {PAYMENT_METHOD_LABEL[m]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Show">
          {({ id, describedBy, invalid }) => (
            <Select
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid}
              value={state}
              onChange={(e) => setState(e.target.value as ReconciliationState)}
            >
              {RECONCILIATION_STATES.map((s) => (
                <option key={s} value={s}>
                  {STATE_LABEL[s]}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {q.isPending ? (
        <Skeleton className="h-96 w-full" />
      ) : q.error ? (
        <Alert tone="error" title="Could not load reconciliation">
          {errorMessage(q.error)}
        </Alert>
      ) : (
        <div className="flex flex-col gap-4">
          <Panel title="Totals for this view">
            <div className="flex flex-col gap-2 p-5 text-body-sm">
              <p className="font-semibold tabular-nums">
                {q.data.count} payment(s), {inr(q.data.total)}
              </p>
              <ul className="flex flex-wrap gap-4">
                {q.data.totals.map((t) => (
                  <li key={t.method}>
                    {PAYMENT_METHOD_LABEL[t.method]}: {t.count} · {inr(t.amount)}
                  </li>
                ))}
              </ul>
              <p className="text-ink-muted">
                Not yet reconciled in this period: {q.data.unreconciled.count} (
                {inr(q.data.unreconciled.amount)})
              </p>
            </div>
          </Panel>

          <div className="flex justify-end">
            <Button
              variant="secondary"
              size="compact"
              onClick={exportCsv}
              disabled={q.data.rows.length === 0}
            >
              Export CSV
            </Button>
          </div>

          {q.data.truncated && (
            <Alert tone="info" title="Showing the first 500 payments">
              The totals above include every payment in the range. Narrow the dates to see the rest.
            </Alert>
          )}

          {accountant && picked.size > 0 && (
            <div className="flex items-center justify-between rounded-md border border-border bg-surface p-3">
              <span className="text-body-sm">{picked.size} selected</span>
              <Button loading={busy} onClick={() => void mark()}>
                Mark as reconciled
              </Button>
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-1">
            <table className="mc-table min-w-full">
              <thead>
                <tr>
                  <th>Select</th>
                  <th>Received</th>
                  <th>Patient</th>
                  <th>Invoice</th>
                  <th>Method</th>
                  <th>Received by</th>
                  <th className="text-right">Amount</th>
                  <th>Reconciled</th>
                </tr>
              </thead>
              <tbody>
                {q.data.rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-ink-muted">
                      No payments match this view.
                    </td>
                  </tr>
                )}
                {q.data.rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {accountant && !r.reconciledAt ? (
                        <input
                          type="checkbox"
                          aria-label={`Select payment ${r.invoiceNumber ?? ''}`}
                          checked={picked.has(r.id)}
                          onChange={() => toggle(r.id)}
                        />
                      ) : null}
                    </td>
                    <td>{fmtDate(r.paidAt, tz)}</td>
                    <td>
                      {r.patientName} <span className="text-ink-muted">({r.patientMrn})</span>
                    </td>
                    <td>{r.invoiceNumber ?? 'Draft'}</td>
                    <td>{PAYMENT_METHOD_LABEL[r.method]}</td>
                    <td>{r.receivedByName ?? 'Online'}</td>
                    <td className="text-right tabular-nums">{inr(r.amount)}</td>
                    <td>
                      {r.reconciledAt
                        ? `${r.reconciledByName ?? 'Yes'}, ${fmtDate(r.reconciledAt, tz)}`
                        : 'No'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}
