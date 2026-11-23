'use client';

import { isExpired, type Medicine, type StockBatch } from '@medcore/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { History, PackagePlus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { EntryDialog, when } from '@/components/emr/shared';
import { ReasonDialog } from '@/components/lab/lab-order-card';
import { StockBadge } from '@/components/prescriptions/prescription-form';
import { Button } from '@/components/ui/button';
import { DataTable, Pagination } from '@/components/ui/data-table';
import { Field, Input } from '@/components/ui/field';
import { Panel } from '@/components/ui/misc';
import { errorMessage } from '@/lib/forms';
import { useHospitalTz } from '@/lib/time';
import { pharmacyApi } from '@/services/pharmacy';
import { useAuth } from '@/store/auth';
import { BatchStatusBadge, MOVEMENT_LABEL, day } from './shared';

/**
 * One medicine's stock (PHARM-001, PHARM-004): batches in FIFO order and the ledger. Opened from
 * the inventory list, which supplies the medicine (the API has no single-medicine route).
 */
export function MedicineStockView({
  medicine: m,
  onBack,
}: {
  medicine: Medicine;
  onBack: () => void;
}) {
  const id = m.id;
  const tz = useHospitalTz();
  const role = useAuth((s) => s.me?.user.role);
  const pharmacist = role === 'PHARMACIST';
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<
    { kind: 'receive' } | { kind: 'quarantine' | 'adjust'; batch: StockBatch } | null
  >(null);
  const [page, setPage] = useState(1);
  const batches = useQuery({ queryKey: ['batches', id], queryFn: () => pharmacyApi.batches(id) });
  const ledger = useQuery({
    queryKey: ['ledger', id, page],
    queryFn: () => pharmacyApi.ledger({ medicineId: id, page, limit: 20 }),
  });
  const changed = () => {
    void qc.invalidateQueries({ queryKey: ['batches', id] });
    void qc.invalidateQueries({ queryKey: ['ledger', id] });
    void qc.invalidateQueries({ queryKey: ['medicines'] });
    void qc.invalidateQueries({ queryKey: ['pharmacy-alerts'] });
  };
  return (
    <>
      <PageHeader
        title={`${m.name} ${m.strength}`}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <StockBadge m={m} /> Reorder level <span className="font-mono">{m.reorderLevel}</span>
          </span>
        }
        actions={
          <span className="flex flex-wrap items-center gap-2">
            {pharmacist && (
              <Button onClick={() => setDialog({ kind: 'receive' })}>
                <PackagePlus />
                Receive stock
              </Button>
            )}
            <Button variant="ghost" onClick={onBack}>
              Back to inventory
            </Button>
          </span>
        }
      />
      <Panel title="Batches" className="mb-6">
        <p className="px-5 pt-3 text-caption text-ink-muted">
          Dispensing takes the batch that expires first. Expired and quarantined batches are never
          dispensed.
        </p>
        <DataTable<StockBatch>
          caption="Batches in dispensing order"
          rows={batches.data}
          rowKey={(b) => b.id}
          loading={batches.isPending}
          error={batches.error ? errorMessage(batches.error) : null}
          onRetry={() => void batches.refetch()}
          empty={{ icon: PackagePlus, title: 'No stock received yet' }}
          columns={[
            {
              key: 'n',
              header: 'Batch',
              primary: true,
              cell: (b) => <span className="font-mono">{b.batchNumber}</span>,
            },
            { key: 'exp', header: 'Expires', cell: (b) => day(b.expiresOn) },
            {
              key: 'qty',
              header: 'Quantity',
              cell: (b) => <span className="font-mono">{b.quantity}</span>,
            },
            { key: 'st', header: 'Status', cell: (b) => <BatchStatusBadge b={b} /> },
            {
              key: 'cost',
              header: 'Unit cost / MRP',
              hideOnMobile: true,
              cell: (b) => (
                <span className="font-mono">
                  {b.unitCost} / {b.mrp}
                </span>
              ),
            },
            { key: 'mfg', header: 'Made', hideOnMobile: true, cell: (b) => day(b.manufacturedOn) },
          ]}
          actions={
            pharmacist
              ? (b) => (
                  <span className="flex gap-1">
                    <Button
                      size="compact"
                      variant="ghost"
                      onClick={() => setDialog({ kind: 'adjust', batch: b })}
                    >
                      Adjust
                    </Button>
                    {b.status === 'ACTIVE' && (
                      <Button
                        size="compact"
                        variant="danger"
                        onClick={() => setDialog({ kind: 'quarantine', batch: b })}
                      >
                        Quarantine
                      </Button>
                    )}
                  </span>
                )
              : undefined
          }
        />
      </Panel>
      <Panel title="Stock ledger">
        <DataTable
          caption="Stock movements, newest first"
          rows={ledger.data?.items}
          rowKey={(x) => x.id}
          loading={ledger.isPending}
          error={ledger.error ? errorMessage(ledger.error) : null}
          onRetry={() => void ledger.refetch()}
          empty={{ icon: History, title: 'No stock movements yet' }}
          columns={[
            { key: 'when', header: 'When', primary: true, cell: (x) => when(x.createdAt, tz) },
            { key: 'type', header: 'Movement', cell: (x) => MOVEMENT_LABEL[x.type] },
            {
              key: 'q',
              header: 'Units',
              cell: (x) => (
                <span className="font-mono">
                  {x.type === 'QUARANTINE'
                    ? `${x.quantity} set aside`
                    : x.quantity > 0
                      ? `+${x.quantity}`
                      : x.quantity}
                </span>
              ),
            },
            {
              key: 'b',
              header: 'Batch',
              cell: (x) => <span className="font-mono">{x.batch.batchNumber}</span>,
            },
            {
              key: 'by',
              header: 'By',
              hideOnMobile: true,
              cell: (x) =>
                x.performedBy
                  ? `${x.performedBy.firstName} ${x.performedBy.lastName}`
                  : 'Nightly expiry run',
            },
            { key: 'why', header: 'Reason', hideOnMobile: true, cell: (x) => x.reason ?? '' },
          ]}
        />
        {ledger.data && <Pagination meta={ledger.data.meta} onPage={setPage} />}
      </Panel>
      {dialog?.kind === 'receive' && (
        <ReceiveDialog medicineId={id} onClose={() => setDialog(null)} onSaved={changed} />
      )}
      {dialog?.kind === 'quarantine' && (
        <ReasonDialog
          title={`Quarantine batch ${dialog.batch.batchNumber}?`}
          label="Reason, for example damaged packaging or a recall"
          submitLabel="Quarantine"
          onClose={() => setDialog(null)}
          onSave={async (reason) => {
            await pharmacyApi.quarantine(dialog.batch.id, reason);
            changed();
          }}
        />
      )}
      {dialog?.kind === 'adjust' && (
        <AdjustDialog batch={dialog.batch} onClose={() => setDialog(null)} onSaved={changed} />
      )}
    </>
  );
}

function ReceiveDialog({
  medicineId,
  onClose,
  onSaved,
}: {
  medicineId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    batchNumber: '',
    manufacturedOn: '',
    expiresOn: '',
    quantity: '',
    unitCost: '',
    mrp: '',
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const today = new Date().toISOString().slice(0, 10);
  return (
    <EntryDialog
      title="Receive stock"
      submitLabel="Receive"
      onClose={onClose}
      onSave={async () => {
        const quantity = Number(f.quantity);
        const unitCost = Number(f.unitCost);
        const mrp = Number(f.mrp);
        if (!f.batchNumber.trim()) throw new Error('Enter the batch number.');
        if (!f.manufacturedOn || !f.expiresOn) throw new Error('Enter both dates.');
        if (isExpired(f.expiresOn, today))
          throw new Error('This batch has expired or expires today.');
        if (!Number.isInteger(quantity) || quantity < 1)
          throw new Error('Enter a quantity of at least 1.');
        if (!(unitCost >= 0) || !(mrp >= 0) || f.unitCost === '' || f.mrp === '')
          throw new Error('Enter the unit cost and MRP.');
        await pharmacyApi.receive(medicineId, {
          batchNumber: f.batchNumber.trim(),
          manufacturedOn: f.manufacturedOn,
          expiresOn: f.expiresOn,
          quantity,
          unitCost,
          mrp,
        });
        onSaved();
      }}
    >
      <Field label="Batch number" required>
        {(p) => (
          <Input id={p.id} maxLength={40} value={f.batchNumber} onChange={set('batchNumber')} />
        )}
      </Field>
      <Field label="Quantity" required>
        {(p) => (
          <Input id={p.id} type="number" min={1} value={f.quantity} onChange={set('quantity')} />
        )}
      </Field>
      <Field label="Manufactured on" required>
        {(p) => (
          <Input
            id={p.id}
            type="date"
            max={today}
            value={f.manufacturedOn}
            onChange={set('manufacturedOn')}
          />
        )}
      </Field>
      <Field label="Expires on" required>
        {(p) => (
          <Input
            id={p.id}
            type="date"
            min={today}
            value={f.expiresOn}
            onChange={set('expiresOn')}
          />
        )}
      </Field>
      <Field label="Unit cost" required>
        {(p) => (
          <Input
            id={p.id}
            type="number"
            min={0}
            step="0.01"
            value={f.unitCost}
            onChange={set('unitCost')}
          />
        )}
      </Field>
      <Field
        label="MRP"
        required
        hint={
          Number(f.mrp) < Number(f.unitCost) && f.mrp !== ''
            ? 'MRP is below the unit cost.'
            : undefined
        }
      >
        {(p) => (
          <Input
            id={p.id}
            aria-describedby={p.describedBy}
            type="number"
            min={0}
            step="0.01"
            value={f.mrp}
            onChange={set('mrp')}
          />
        )}
      </Field>
    </EntryDialog>
  );
}

function AdjustDialog({
  batch,
  onClose,
  onSaved,
}: {
  batch: StockBatch;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState('');
  return (
    <EntryDialog
      title={`Adjust batch ${batch.batchNumber}`}
      submitLabel="Save adjustment"
      onClose={onClose}
      onSave={async () => {
        const n = Number(quantity);
        if (!Number.isInteger(n) || n === 0)
          throw new Error('Enter a whole number, for example -2 or 5.');
        if (batch.quantity + n < 0)
          throw new Error(`Only ${batch.quantity} units are in this batch.`);
        if (reason.trim().length < 3) throw new Error('Give a reason (at least 3 characters).');
        await pharmacyApi.adjust(batch.id, n, reason.trim());
        onSaved();
      }}
    >
      <Field
        label="Change in units"
        required
        hint={`Now ${batch.quantity}. Use a minus sign to remove units.`}
      >
        {(p) => (
          <Input
            id={p.id}
            aria-describedby={p.describedBy}
            type="number"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
        )}
      </Field>
      <Field label="Reason" required>
        {(p) => (
          <Input
            id={p.id}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        )}
      </Field>
    </EntryDialog>
  );
}
