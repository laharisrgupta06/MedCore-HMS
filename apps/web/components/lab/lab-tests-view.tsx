'use client';

import {
  LAB_TEST_CATEGORIES,
  type LabRange,
  type LabTest,
  type LabTestCategory,
  type RangeGender,
} from '@medcore/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FlaskConical, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { EntryDialog } from '@/components/emr/shared';
import { Button } from '@/components/ui/button';
import { DataTable, Pagination } from '@/components/ui/data-table';
import { Field, FieldGroup, Input, Select } from '@/components/ui/field';
import { Badge, Panel } from '@/components/ui/misc';
import { SearchInput } from '@/components/ui/search-input';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/forms';
import { labApi } from '@/services/lab';

const GENDER: Record<string, string> = {
  '': 'Any',
  FEMALE: 'Female',
  MALE: 'Male',
  OTHER: 'Other',
};
const rangeText = (r: LabRange) =>
  `${r.low} to ${r.high}${r.gender ? `, ${GENDER[r.gender]?.toLowerCase()}` : ''}${r.ageMinYears != null || r.ageMaxYears != null ? `, age ${r.ageMinYears ?? 0}${r.ageMaxYears != null ? `–${r.ageMaxYears}` : '+'}` : ''}`;

/** Test catalogue with reference ranges (LAB-006); hospital admins only. */
export function LabTestsView() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<LabTest | 'new' | null>(null);
  const q = useQuery({
    queryKey: ['lab-tests', 'catalogue', search, page],
    queryFn: () => labApi.tests({ page, limit: 20, ...(search ? { search } : {}) }),
  });
  return (
    <>
      <PageHeader
        title="Lab tests"
        description="Tests doctors can order, with prices and the reference ranges used to flag results."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus />
            Add test
          </Button>
        }
      />
      <Panel
        actions={
          <SearchInput
            label="Search tests"
            placeholder="Name or code"
            onSearch={(v) => {
              setSearch(v);
              setPage(1);
            }}
          />
        }
      >
        <DataTable<LabTest>
          caption="Lab test catalogue"
          rows={q.data?.items}
          rowKey={(t) => t.id}
          loading={q.isPending}
          error={q.error ? errorMessage(q.error) : null}
          onRetry={() => void q.refetch()}
          empty={{
            icon: FlaskConical,
            title: 'No tests yet',
            text: 'Add the tests your laboratory offers.',
          }}
          columns={[
            {
              key: 'name',
              header: 'Test',
              primary: true,
              cell: (t) => (
                <span>
                  <span className="font-medium">{t.name}</span>{' '}
                  <span className="font-mono text-caption text-ink-muted">{t.code}</span>
                </span>
              ),
            },
            {
              key: 'cat',
              header: 'Category',
              cell: (t) =>
                t.category === 'RADIOLOGY' ? (
                  <Badge tone="info">Radiology</Badge>
                ) : (
                  <Badge tone="sage">Laboratory</Badge>
                ),
            },
            {
              key: 'ranges',
              header: 'Reference ranges',
              hideOnMobile: true,
              cell: (t) =>
                t.ranges.length ? (
                  <span className="text-body-sm">
                    {t.ranges.map(rangeText).join('; ')}
                    {t.unit ? ` ${t.unit}` : ''}
                  </span>
                ) : (
                  <span className="text-ink-muted">None</span>
                ),
            },
            {
              key: 'price',
              header: 'Price',
              cell: (t) => <span className="font-mono">{t.price}</span>,
            },
          ]}
          actions={(t) => (
            <Button size="compact" variant="ghost" onClick={() => setEditing(t)}>
              Edit
            </Button>
          )}
        />
        {q.data && <Pagination meta={q.data.meta} onPage={setPage} />}
      </Panel>
      {editing && (
        <LabTestDialog
          test={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => void qc.invalidateQueries({ queryKey: ['lab-tests'] })}
        />
      )}
    </>
  );
}

type RangeRow = { gender: string; ageMin: string; ageMax: string; low: string; high: string };

function LabTestDialog({
  test,
  onClose,
  onSaved,
}: {
  test: LabTest | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [f, setF] = useState({
    code: test?.code ?? '',
    name: test?.name ?? '',
    category: test?.category ?? ('LABORATORY' as LabTestCategory),
    unit: test?.unit ?? '',
    sampleType: test?.sampleType ?? '',
    price: test?.price ?? '',
    active: test?.isActive ?? true,
  });
  const [ranges, setRanges] = useState<RangeRow[]>(
    (test?.ranges ?? []).map((r) => ({
      gender: r.gender ?? '',
      ageMin: r.ageMinYears?.toString() ?? '',
      ageMax: r.ageMaxYears?.toString() ?? '',
      low: String(r.low),
      high: String(r.high),
    })),
  );
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF({ ...f, [k]: e.target.value });
  const setRange = (i: number, k: keyof RangeRow, v: string) =>
    setRanges(ranges.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <EntryDialog
      title={test ? `Edit ${test.name}` : 'Add lab test'}
      submitLabel={test ? 'Save' : 'Add test'}
      onClose={onClose}
      onSave={async () => {
        const price = Number(f.price);
        if (!test && !/^[A-Za-z0-9][A-Za-z0-9-]{0,19}$/.test(f.code.trim()))
          throw new Error('Enter a short code of letters, digits and dashes.');
        if (f.name.trim().length < 2) throw new Error('Enter the test name.');
        if (!Number.isFinite(price) || price < 0) throw new Error('Enter a price of 0 or more.');
        const parsed: LabRange[] = ranges.map((r) => ({
          gender: (r.gender || null) as RangeGender | null,
          ageMinYears: r.ageMin ? Number(r.ageMin) : null,
          ageMaxYears: r.ageMax ? Number(r.ageMax) : null,
          low: Number(r.low),
          high: Number(r.high),
        }));
        if (
          parsed.some((r) => !Number.isFinite(r.low) || !Number.isFinite(r.high) || r.low > r.high)
        )
          throw new Error('Each range needs numbers, with low no higher than high.');
        const body = {
          name: f.name.trim(),
          unit: f.unit.trim(),
          sampleType: f.sampleType.trim(),
          price,
          ranges: parsed,
        };
        if (test) await labApi.updateTest(test.id, { ...body, isActive: f.active });
        else await labApi.createTest({ ...body, code: f.code.trim(), category: f.category });
        toast.success('Saved. Results already entered keep the range they were judged against.');
        onSaved();
      }}
    >
      {!test && (
        <Field label="Code" required>
          {(p) => <Input id={p.id} maxLength={20} value={f.code} onChange={set('code')} />}
        </Field>
      )}
      <Field label="Name" required>
        {(p) => <Input id={p.id} maxLength={120} value={f.name} onChange={set('name')} />}
      </Field>
      {!test && (
        <Field label="Category" required>
          {(p) => (
            <Select id={p.id} value={f.category} onChange={set('category')}>
              {LAB_TEST_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c === 'RADIOLOGY' ? 'Radiology' : 'Laboratory'}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      <Field label="Unit">
        {(p) => (
          <Input
            id={p.id}
            maxLength={30}
            placeholder="g/dL"
            value={f.unit}
            onChange={set('unit')}
          />
        )}
      </Field>
      <Field label="Sample type">
        {(p) => (
          <Input
            id={p.id}
            maxLength={60}
            placeholder="Blood"
            value={f.sampleType}
            onChange={set('sampleType')}
          />
        )}
      </Field>
      <Field label="Price" required>
        {(p) => (
          <Input
            id={p.id}
            type="number"
            min={0}
            step="0.01"
            value={f.price}
            onChange={set('price')}
          />
        )}
      </Field>
      {test && (
        <Field label="Status">
          {(p) => (
            <Select
              id={p.id}
              value={f.active ? 'true' : 'false'}
              onChange={(e) => setF({ ...f, active: e.target.value === 'true' })}
            >
              <option value="true">Offered</option>
              <option value="false">No longer offered</option>
            </Select>
          )}
        </Field>
      )}
      {(test?.category ?? f.category) !== 'RADIOLOGY' && (
        <FieldGroup label="Reference ranges" className="sm:col-span-2">
          <p className="text-caption text-ink-muted">
            The most specific matching range is used: gender and age band each count. A value equal
            to a limit is normal.
          </p>
          {ranges.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_4rem_4rem_5rem_5rem_auto] items-end gap-2">
              <Field label="Gender">
                {(p) => (
                  <Select
                    id={p.id}
                    value={r.gender}
                    onChange={(e) => setRange(i, 'gender', e.target.value)}
                  >
                    {Object.entries(GENDER).map(([k, v]) => (
                      <option key={k} value={k}>
                        {v}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Age from">
                {(p) => (
                  <Input
                    id={p.id}
                    type="number"
                    min={0}
                    value={r.ageMin}
                    onChange={(e) => setRange(i, 'ageMin', e.target.value)}
                  />
                )}
              </Field>
              <Field label="Age to">
                {(p) => (
                  <Input
                    id={p.id}
                    type="number"
                    min={0}
                    value={r.ageMax}
                    onChange={(e) => setRange(i, 'ageMax', e.target.value)}
                  />
                )}
              </Field>
              <Field label="Low" required>
                {(p) => (
                  <Input
                    id={p.id}
                    type="number"
                    step="any"
                    value={r.low}
                    onChange={(e) => setRange(i, 'low', e.target.value)}
                  />
                )}
              </Field>
              <Field label="High" required>
                {(p) => (
                  <Input
                    id={p.id}
                    type="number"
                    step="any"
                    value={r.high}
                    onChange={(e) => setRange(i, 'high', e.target.value)}
                  />
                )}
              </Field>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Remove range ${i + 1}`}
                onClick={() => setRanges(ranges.filter((_, j) => j !== i))}
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <Button
            size="compact"
            variant="secondary"
            onClick={() =>
              setRanges([...ranges, { gender: '', ageMin: '', ageMax: '', low: '', high: '' }])
            }
          >
            <Plus />
            Add range
          </Button>
        </FieldGroup>
      )}
    </EntryDialog>
  );
}
