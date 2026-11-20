'use client';

import { INVOICE_STATUSES, type InvoiceStatus, type InvoiceSummary } from '@medcore/types';
import { ReceiptText } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { DataTable, Pagination } from '@/components/ui/data-table';
import { Field, Select } from '@/components/ui/field';
import { Badge, Panel } from '@/components/ui/misc';
import { useList } from '@/lib/use-list';
import { fmtDate, useHospitalTz } from '@/lib/time';
import { invoicesApi } from '@/services/invoices';
import { STATUS_LABEL, STATUS_TONE, documentTitle, rupees } from './invoice-format';

/** Staff invoice list (BILL-003) and the patient's own bills (Q8 A), one component. */
export function InvoiceList({ patient = false }: { patient?: boolean }) {
  const tz = useHospitalTz();
  const [status, setStatus] = useState<InvoiceStatus | ''>('');
  const list = useList<InvoiceSummary>(
    'invoices',
    (q) => invoicesApi.list({ ...q, limit: 20 } as never),
    status ? { status } : {},
  );
  const base = patient ? '/portal/invoices' : '/dashboard/invoices';
  return (
    <>
      <PageHeader
        title={patient ? 'My bills' : 'Invoices'}
        description={
          patient
            ? 'Bills issued by the hospital for your visits.'
            : 'Drafts fill in automatically from consultations, lab orders and dispensing. Review, then finalise.'
        }
      />
      <Panel
        actions={
          !patient && (
            <Field label="Status" className="w-48">
              {({ id }) => (
                <Select
                  id={id}
                  value={status}
                  onChange={(e) => setStatus(e.target.value as InvoiceStatus | '')}
                >
                  <option value="">All</option>
                  {INVOICE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {STATUS_LABEL[s]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )
        }
      >
        <DataTable
          caption={patient ? 'Your bills' : 'Invoices'}
          rows={list.rows}
          loading={list.loading}
          error={list.error}
          onRetry={list.refetch}
          rowKey={(r) => r.id}
          empty={{
            icon: ReceiptText,
            title: patient ? 'No bills yet' : 'No invoices',
            text: patient
              ? 'Bills appear here once the hospital issues them.'
              : 'Invoices appear when a visit is charged.',
          }}
          columns={[
            {
              key: 'doc',
              header: 'Document',
              primary: true,
              cell: (r) => (
                <Link
                  href={`${base}/${r.id}`}
                  className="font-medium text-sage-700 hover:underline"
                >
                  {documentTitle(r)}
                </Link>
              ),
            },
            ...(patient
              ? []
              : [
                  {
                    key: 'patient',
                    header: 'Patient',
                    cell: (r: InvoiceSummary) => `${r.patient.name} (${r.patient.mrn})`,
                  },
                ]),
            {
              key: 'visit',
              header: 'Visit',
              hideOnMobile: true,
              cell: (r) =>
                `${fmtDate(r.appointment.scheduledAt, tz)}, Dr ${r.appointment.doctorName}`,
            },
            {
              key: 'status',
              header: 'Status',
              cell: (r) => <Badge tone={STATUS_TONE[r.status]}>{STATUS_LABEL[r.status]}</Badge>,
            },
            {
              key: 'total',
              header: 'Total',
              className: 'text-right',
              cell: (r) => rupees(r.total),
            },
          ]}
        />
        <Pagination meta={list.meta} onPage={list.setPage} />
      </Panel>
    </>
  );
}
