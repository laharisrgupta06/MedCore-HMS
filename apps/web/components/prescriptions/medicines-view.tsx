'use client';

import { MEDICINE_FORMS, type Medicine, type MedicineForm } from '@medcore/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Pill, Plus } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { EntryDialog } from '@/components/emr/shared';
import { Button } from '@/components/ui/button';
import { DataTable, Pagination } from '@/components/ui/data-table';
import { Field, Input, Select } from '@/components/ui/field';
import { Badge, Panel } from '@/components/ui/misc';
import { SearchInput } from '@/components/ui/search-input';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/forms';
import { medicinesApi } from '@/services/prescriptions';
import { MedicineStockView } from '@/components/pharmacy/inventory-view';
import { StockBadge } from './prescription-form';

const FORM_LABEL: Record<MedicineForm, string> = {
  TABLET: 'Tablet',
  CAPSULE: 'Capsule',
  SYRUP: 'Syrup',
  INJECTION: 'Injection',
  TOPICAL: 'Topical',
};

/** Medicine catalogue (DEC-040 D2): pharmacists and admins keep it; doctors prescribe from it. */
export function MedicinesView() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [active, setActive] = useState<'true' | 'false'>('true');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Medicine | 'new' | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['medicines', 'catalogue', search, active, page],
    queryFn: () =>
      medicinesApi.list({
        page,
        limit: 20,
        active: active === 'true',
        ...(search ? { search } : {}),
      }),
  });
  const toggle = async (m: Medicine) => {
    try {
      await medicinesApi.update(m.id, { isActive: !m.isActive });
      toast.success(
        m.isActive
          ? `${m.name} can no longer be prescribed.`
          : `${m.name} can be prescribed again.`,
      );
      void qc.invalidateQueries({ queryKey: ['medicines'] });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const open = selected ? q.data?.items.find((m) => m.id === selected) : undefined;
  if (open) return <MedicineStockView medicine={open} onBack={() => setSelected(null)} />;
  return (
    <>
      <PageHeader
        title="Inventory"
        description="The medicines doctors prescribe from, with available stock. Open a medicine for its batches and ledger."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus />
            Add medicine
          </Button>
        }
      />
      <Panel
        actions={
          <div className="flex w-full flex-wrap items-center gap-2">
            <SearchInput
              label="Search medicines"
              placeholder="Name or generic name"
              onSearch={(v) => {
                setSearch(v);
                setPage(1);
              }}
            />
            <Select
              aria-label="Show"
              className="h-9 w-full sm:w-40"
              value={active}
              onChange={(e) => {
                setActive(e.target.value as 'true' | 'false');
                setPage(1);
              }}
            >
              <option value="true">In use</option>
              <option value="false">No longer in use</option>
            </Select>
          </div>
        }
      >
        <DataTable<Medicine>
          caption="Medicine catalogue"
          rows={q.data?.items}
          rowKey={(m) => m.id}
          loading={q.isPending}
          error={q.error ? errorMessage(q.error) : null}
          onRetry={() => void q.refetch()}
          empty={{
            icon: Pill,
            title: search ? 'No medicines match' : 'No medicines yet',
            text: search ? undefined : 'Add the medicines your pharmacy stocks.',
          }}
          columns={[
            {
              key: 'name',
              header: 'Medicine',
              primary: true,
              cell: (m) => (
                <span>
                  <span className="font-medium">
                    {m.name} {m.strength}
                  </span>
                  {m.genericName && (
                    <span className="block text-caption text-ink-muted">{m.genericName}</span>
                  )}
                </span>
              ),
            },
            { key: 'form', header: 'Form', cell: (m) => FORM_LABEL[m.form] },
            { key: 'stock', header: 'Stock', cell: (m) => <StockBadge m={m} /> },
            {
              key: 'reorder',
              header: 'Reorder level',
              hideOnMobile: true,
              cell: (m) => <span className="font-mono">{m.reorderLevel}</span>,
            },
            {
              key: 'state',
              header: 'Status',
              hideOnMobile: true,
              cell: (m) =>
                m.isActive ? <Badge tone="sage">In use</Badge> : <Badge>Not in use</Badge>,
            },
          ]}
          actions={(m) => (
            <span className="flex gap-1">
              <Button size="compact" variant="secondary" onClick={() => setSelected(m.id)}>
                Stock<span className="sr-only"> of {m.name}</span>
              </Button>
              <Button size="compact" variant="ghost" onClick={() => setEditing(m)}>
                Edit
              </Button>
              <Button size="compact" variant="ghost" onClick={() => void toggle(m)}>
                {m.isActive ? 'Stop using' : 'Use again'}
              </Button>
            </span>
          )}
        />
        {q.data && <Pagination meta={q.data.meta} onPage={setPage} />}
      </Panel>
      {editing && (
        <MedicineDialog
          medicine={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => void qc.invalidateQueries({ queryKey: ['medicines'] })}
        />
      )}
    </>
  );
}

function MedicineDialog({
  medicine,
  onClose,
  onSaved,
}: {
  medicine: Medicine | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    name: medicine?.name ?? '',
    genericName: medicine?.genericName ?? '',
    form: medicine?.form ?? ('TABLET' as MedicineForm),
    strength: medicine?.strength ?? '',
    reorderLevel: String(medicine?.reorderLevel ?? 10),
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  return (
    <EntryDialog
      title={medicine ? `Edit ${medicine.name}` : 'Add medicine'}
      submitLabel={medicine ? 'Save' : 'Add medicine'}
      onClose={onClose}
      onSave={async () => {
        if (f.name.trim().length < 2) throw new Error('Enter the medicine name.');
        if (!f.strength.trim()) throw new Error('Enter the strength, for example 500 mg.');
        const reorder = Number(f.reorderLevel);
        if (!Number.isInteger(reorder) || reorder < 0)
          throw new Error('The reorder level must be a whole number, 0 or more.');
        const body = {
          name: f.name.trim(),
          genericName: f.genericName.trim(),
          strength: f.strength.trim(),
          reorderLevel: reorder,
        };
        if (medicine) await medicinesApi.update(medicine.id, body);
        else
          await medicinesApi.create({
            ...body,
            form: f.form,
            genericName: body.genericName || undefined,
          });
        onSaved();
      }}
    >
      <Field label="Name" required>
        {(p) => <Input id={p.id} maxLength={120} value={f.name} onChange={set('name')} />}
      </Field>
      <Field label="Generic name">
        {(p) => (
          <Input id={p.id} maxLength={120} value={f.genericName} onChange={set('genericName')} />
        )}
      </Field>
      <Field label="Form" required>
        {(p) => (
          <Select id={p.id} value={f.form} disabled={Boolean(medicine)} onChange={set('form')}>
            {MEDICINE_FORMS.map((x) => (
              <option key={x} value={x}>
                {FORM_LABEL[x]}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Strength" required>
        {(p) => (
          <Input
            id={p.id}
            maxLength={40}
            placeholder="500 mg"
            value={f.strength}
            onChange={set('strength')}
          />
        )}
      </Field>
      <Field label="Reorder level (units)" required hint="A low-stock alert is raised below this.">
        {(p) => (
          <Input
            id={p.id}
            aria-describedby={p.describedBy}
            type="number"
            min={0}
            value={f.reorderLevel}
            onChange={set('reorderLevel')}
          />
        )}
      </Field>
    </EntryDialog>
  );
}
