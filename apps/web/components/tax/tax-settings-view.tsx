'use client';

import type {
  GstRegistrationView,
  TaxClassificationVersionView,
  TaxClassificationView,
  TaxDefaultKind,
  TaxSettings,
} from '@medcore/types';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { Lock, Plus, ReceiptText } from 'lucide-react';
import { useCallback, useState } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Select } from '@/components/ui/field';
import { Badge, EmptyState, Panel, Skeleton } from '@/components/ui/misc';
import { SearchInput } from '@/components/ui/search-input';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/forms';
import { labApi } from '@/services/lab';
import { medicinesApi } from '@/services/prescriptions';
import { taxApi } from '@/services/tax';
import { useAuth } from '@/store/auth';
import { ClassificationDialog, RegistrationDialog, VersionDialog } from './tax-forms';

/** Hospital tax settings (BILL-008, task 8-B2). Accountants see the same page read-only. */

const TREATMENT = { TAXABLE: 'Taxable', EXEMPT: 'Exempt', NIL_RATED: 'Nil rated' } as const;
const REGISTRATION = {
  REGULAR: 'Regular',
  COMPOSITION: 'Composition scheme',
  UNREGISTERED: 'Not registered',
} as const;

export const formatDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

export function versionSummary(v: TaxClassificationVersionView): string {
  if (v.treatment !== 'TAXABLE') return TREATMENT[v.treatment];
  return `${Number(v.ratePercent)}% GST${v.priceIncludesTax ? ', included in price' : ', added to price'}`;
}

/** Runs an action with a toast; the caller refreshes. */
async function act(fn: () => Promise<unknown>, done: string): Promise<boolean> {
  try {
    await fn();
    toast.success(done);
    return true;
  } catch (e) {
    toast.error(errorMessage(e));
    return false;
  }
}

export function TaxSettingsView() {
  const role = useAuth((s) => s.me?.user.role);
  const canEdit = role === 'HOSPITAL_ADMIN';
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['tax-settings'], queryFn: taxApi.settings });
  const refresh = () => void qc.invalidateQueries({ queryKey: ['tax-settings'] });

  if (q.isPending) return <Skeleton className="h-[32rem] w-full" />;
  if (q.error)
    return (
      <Alert tone="error" title="Could not load tax settings">
        {errorMessage(q.error)}
      </Alert>
    );
  const t = q.data;
  return (
    <>
      <PageHeader
        title="Tax settings"
        description="GST registration, tax classifications and the rates bills will use. Recorded history never changes, so issued bills stay correct."
      />
      <div className="flex flex-col gap-6">
        <SetupStatus t={t} canEdit={canEdit} onDone={refresh} />
        <div className="grid gap-6 xl:grid-cols-2">
          <Registrations t={t} canEdit={canEdit} onDone={refresh} />
          <Defaults t={t} canEdit={canEdit} onDone={refresh} />
        </div>
        <Classifications t={t} canEdit={canEdit} onDone={refresh} />
        <ItemAssignments t={t} canEdit={canEdit} />
        <RoomRule t={t} />
      </div>
    </>
  );
}

function SetupStatus({
  t,
  canEdit,
  onDone,
}: {
  t: TaxSettings;
  canEdit: boolean;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const missing = (['CONSULTATION', 'LAB'] as TaxDefaultKind[]).filter(
    (k) => !t.defaults.some((d) => d.kind === k),
  );
  return (
    <Panel>
      <div className="flex flex-col gap-4 p-5 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-col gap-2 text-body-sm">
          <p>
            Set-up:{' '}
            {t.setupConfirmedAt ? (
              <Badge tone="success">
                Confirmed {new Date(t.setupConfirmedAt).toLocaleDateString('en-IN')}
              </Badge>
            ) : (
              <Badge tone="warning">Not yet confirmed</Badge>
            )}
          </p>
          <p className="text-ink-secondary">
            Tax date today: <span className="font-medium text-ink">{formatDate(t.taxDate)}</span> in{' '}
            <span className="font-medium text-ink">{t.timezone}</span>{' '}
            {t.timezoneLocked && (
              <Badge tone="neutral" icon={Lock}>
                Time zone locked
              </Badge>
            )}
          </p>
          {t.timezoneLocked && (
            <p className="text-caption text-ink-muted">
              Tax dates already use this time zone, so it can no longer be changed in the app.
            </p>
          )}
        </div>
        {canEdit && (
          <div className="flex flex-col items-start gap-1 md:items-end">
            <Button
              loading={busy}
              disabled={missing.length > 0}
              onClick={async () => {
                setBusy(true);
                if (await act(taxApi.confirm, 'Tax set-up confirmed.')) onDone();
                setBusy(false);
              }}
            >
              {t.setupConfirmedAt ? 'Confirm again' : 'Confirm tax set-up'}
            </Button>
            {missing.length > 0 && (
              <p className="text-caption text-ink-muted">
                Choose the {missing.map((k) => k.toLowerCase()).join(' and ')} default first.
              </p>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

function Registrations({
  t,
  canEdit,
  onDone,
}: {
  t: TaxSettings;
  canEdit: boolean;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [removing, setRemoving] = useState<GstRegistrationView | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Panel
      title="GST registration"
      actions={
        canEdit && (
          <Button size="compact" variant="secondary" onClick={() => setOpen(true)}>
            <Plus aria-hidden="true" /> Record registration
          </Button>
        )
      }
    >
      {t.registrations.length === 0 ? (
        <div className="p-5">
          <EmptyState icon={ReceiptText} title="No GST registration recorded">
            Until one is recorded, bills show no GST.
          </EmptyState>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {[...t.registrations].reverse().map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-body-sm"
            >
              <div className="flex flex-col gap-0.5">
                <span className="font-medium">
                  {REGISTRATION[r.registrationType]}
                  {r.gstin && <span className="ml-2 font-mono">{r.gstin}</span>}
                </span>
                {r.legalName && <span className="text-ink-secondary">{r.legalName}</span>}
                <span className="text-caption text-ink-muted">
                  From {formatDate(r.effectiveFrom)}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {r.inForce ? (
                  <Badge tone="success">In force</Badge>
                ) : r.deletable ? (
                  <Badge tone="info">Scheduled</Badge>
                ) : (
                  <Badge tone="neutral">Superseded</Badge>
                )}
                {canEdit && r.deletable && (
                  <Button size="compact" variant="ghost" onClick={() => setRemoving(r)}>
                    Delete
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <RegistrationDialog open={open} onOpenChange={setOpen} minDate={t.taxDate} onSaved={onDone} />
      <Dialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title="Delete scheduled registration?"
        description="It has not come into force, so no bill uses it."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoving(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                if (
                  await act(
                    () => taxApi.deleteRegistration(removing!.id),
                    'Scheduled registration deleted.',
                  )
                )
                  onDone();
                setBusy(false);
                setRemoving(null);
              }}
            >
              Delete
            </Button>
          </>
        }
      >
        {removing && (
          <p className="text-body-sm">
            {REGISTRATION[removing.registrationType]} {removing.gstin ?? ''} from{' '}
            {formatDate(removing.effectiveFrom)}
          </p>
        )}
      </Dialog>
    </Panel>
  );
}

function Defaults({
  t,
  canEdit,
  onDone,
}: {
  t: TaxSettings;
  canEdit: boolean;
  onDone: () => void;
}) {
  const services = t.classifications.filter((c) => c.supplyType === 'SERVICE' && c.isActive);
  const current = (k: TaxDefaultKind) =>
    t.defaults.find((d) => d.kind === k)?.classificationId ?? '';
  const label = { CONSULTATION: 'Consultations', LAB: 'Lab tests' } as const;
  return (
    <Panel title="Defaults">
      <div className="flex flex-col gap-4 p-5">
        <p className="text-body-sm text-ink-secondary">
          The classification used for every consultation, and for lab tests without their own.
        </p>
        {(['CONSULTATION', 'LAB'] as const).map((k) => (
          <Field
            key={k}
            label={label[k]}
            hint={
              services.length === 0 ? 'Create an active service classification first.' : undefined
            }
          >
            {({ id, describedBy }) => (
              <Select
                id={id}
                aria-describedby={describedBy}
                value={current(k)}
                disabled={!canEdit || services.length === 0}
                onChange={async (e) => {
                  if (
                    e.target.value &&
                    (await act(
                      () => taxApi.setDefault(k, e.target.value),
                      `${label[k]} default saved.`,
                    ))
                  )
                    onDone();
                }}
              >
                <option value="" disabled>
                  Choose a classification
                </option>
                {services.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.hsnSac})
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ))}
      </div>
    </Panel>
  );
}

function Classifications({
  t,
  canEdit,
  onDone,
}: {
  t: TaxSettings;
  canEdit: boolean;
  onDone: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<TaxClassificationView | null>(null);
  const [adding, setAdding] = useState<TaxClassificationView | null>(null);
  const [editing, setEditing] = useState<{
    c: TaxClassificationView;
    v: TaxClassificationVersionView;
  } | null>(null);
  const [withdrawing, setWithdrawing] = useState<TaxClassificationVersionView | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Panel
      title="Tax classifications"
      actions={
        canEdit && (
          <Button size="compact" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" /> New classification
          </Button>
        )
      }
    >
      {t.classifications.length === 0 ? (
        <div className="p-5">
          <EmptyState icon={ReceiptText} title="No classifications yet">
            Create one for consultations, one for lab tests and one for each medicine rate.
          </EmptyState>
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {t.classifications.map((c) => {
            const inForce = c.versions.find((v) => v.inForce);
            return (
              <li key={c.id} className="flex flex-col gap-3 px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <span className="font-medium">{c.name}</span>
                    <span className="text-caption text-ink-muted">
                      {c.supplyType === 'SERVICE' ? 'Service, SAC' : 'Goods, HSN'} {c.hsnSac}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {c.usedAsDefault && <Badge tone="sage">Default</Badge>}
                    {!c.isActive && <Badge tone="neutral">Inactive</Badge>}
                    <Badge tone={inForce ? 'success' : 'warning'}>
                      {inForce ? versionSummary(inForce) : 'No rate in force'}
                    </Badge>
                  </div>
                </div>
                {c.versions.length > 0 && (
                  <table className="w-full text-body-sm">
                    <caption className="sr-only">Rate versions of {c.name}</caption>
                    <thead className="text-left text-caption text-ink-muted">
                      <tr>
                        <th className="py-1 font-medium">From</th>
                        <th className="py-1 font-medium">Rate</th>
                        <th className="py-1 font-medium">Status</th>
                        {canEdit && (
                          <th className="py-1 font-medium">
                            <span className="sr-only">Actions</span>
                          </th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {c.versions.map((v) => (
                        <tr key={v.id} className="border-t border-border">
                          <td className="py-1.5">{formatDate(v.effectiveFrom)}</td>
                          <td className="py-1.5">{versionSummary(v)}</td>
                          <td className="py-1.5">
                            {v.inForce ? 'In force' : v.editable ? 'Scheduled' : 'Superseded'}
                          </td>
                          {canEdit && (
                            <td className="py-1.5 text-right">
                              {v.editable && (
                                <span className="inline-flex gap-1">
                                  <Button
                                    size="compact"
                                    variant="ghost"
                                    onClick={() => setEditing({ c, v })}
                                  >
                                    Correct
                                  </Button>
                                  <Button
                                    size="compact"
                                    variant="ghost"
                                    onClick={() => setWithdrawing(v)}
                                  >
                                    Withdraw
                                  </Button>
                                </span>
                              )}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {canEdit && (
                  <div className="flex flex-wrap gap-2">
                    {c.isActive && (
                      <Button size="compact" variant="secondary" onClick={() => setAdding(c)}>
                        Add rate version
                      </Button>
                    )}
                    <Button size="compact" variant="ghost" onClick={() => setRenaming(c)}>
                      Rename
                    </Button>
                    <Button
                      size="compact"
                      variant="ghost"
                      disabled={c.isActive && c.usedAsDefault}
                      title={
                        c.isActive && c.usedAsDefault ? 'Choose another default first.' : undefined
                      }
                      onClick={async () => {
                        if (
                          await act(
                            () => taxApi.updateClassification(c.id, { isActive: !c.isActive }),
                            c.isActive
                              ? 'Classification deactivated. Recorded versions are kept.'
                              : 'Classification reactivated.',
                          )
                        )
                          onDone();
                      }}
                    >
                      {c.isActive ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {canEdit && (
        <p className="border-t border-border px-5 py-3 text-caption text-ink-muted">
          Deactivating keeps every recorded version but blocks new versions and new assignments.
        </p>
      )}
      <ClassificationDialog open={creating} onOpenChange={setCreating} onSaved={onDone} />
      {renaming && (
        <ClassificationDialog
          open
          onOpenChange={(o) => !o && setRenaming(null)}
          existing={renaming}
          onSaved={onDone}
        />
      )}
      {adding && (
        <VersionDialog
          open
          onOpenChange={(o) => !o && setAdding(null)}
          classification={adding}
          minDate={t.taxDate}
          onSaved={onDone}
        />
      )}
      {editing && (
        <VersionDialog
          open
          onOpenChange={(o) => !o && setEditing(null)}
          classification={editing.c}
          version={editing.v}
          minDate={t.taxDate}
          onSaved={onDone}
        />
      )}
      <Dialog
        open={!!withdrawing}
        onOpenChange={(o) => !o && setWithdrawing(null)}
        title="Withdraw scheduled version?"
        description="It has not come into force, so no bill uses it."
        footer={
          <>
            <Button variant="secondary" onClick={() => setWithdrawing(null)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              loading={busy}
              onClick={async () => {
                setBusy(true);
                if (
                  await act(
                    () => taxApi.deleteVersion(withdrawing!.id),
                    'Scheduled version withdrawn.',
                  )
                )
                  onDone();
                setBusy(false);
                setWithdrawing(null);
              }}
            >
              Withdraw
            </Button>
          </>
        }
      >
        {withdrawing && (
          <p className="text-body-sm">
            {versionSummary(withdrawing)} from {formatDate(withdrawing.effectiveFrom)}
          </p>
        )}
      </Dialog>
    </Panel>
  );
}

function ItemAssignments({ t, canEdit }: { t: TaxSettings; canEdit: boolean }) {
  const [tab, setTab] = useState<'medicines' | 'lab-tests'>('medicines');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const onSearch = useCallback((v: string) => {
    setSearch(v);
    setPage(1);
  }, []);
  const qc = useQueryClient();
  const key = ['tax-items', tab, search, page];
  const q = useQuery({
    queryKey: key,
    queryFn: async () => {
      const filter = { search: search || undefined, page, limit: 20 };
      if (tab === 'medicines') {
        const r = await medicinesApi.list(filter);
        return {
          rows: r.items.map((i) => ({
            id: i.id,
            name: i.name,
            detail: i.strength,
            classificationId: i.taxClassificationId,
          })),
          meta: r.meta,
        };
      }
      const r = await labApi.tests(filter);
      return {
        rows: r.items.map((i) => ({
          id: i.id,
          name: i.name,
          detail: i.code,
          classificationId: i.taxClassificationId,
        })),
        meta: r.meta,
      };
    },
    placeholderData: keepPreviousData,
  });
  const supply = tab === 'medicines' ? 'GOODS' : 'SERVICE';
  const options = t.classifications.filter((c) => c.supplyType === supply);
  const name = (id: string | null) => options.find((c) => c.id === id)?.name;
  return (
    <Panel title="Item classifications">
      <div className="flex flex-col gap-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            role="tablist"
            aria-label="Item type"
            className="inline-flex rounded-md border border-border p-0.5"
          >
            {(['medicines', 'lab-tests'] as const).map((k) => (
              <button
                key={k}
                role="tab"
                aria-selected={tab === k}
                className={`rounded px-3 py-1.5 text-body-sm ${tab === k ? 'bg-sage-600 text-white' : 'text-ink-secondary hover:bg-sage-50'}`}
                onClick={() => (setTab(k), setPage(1))}
              >
                {k === 'medicines' ? 'Medicines' : 'Lab tests'}
              </button>
            ))}
          </div>
          <SearchInput label="Search items" placeholder="Search by name" onSearch={onSearch} />
        </div>
        <p className="text-caption text-ink-muted">
          {tab === 'medicines'
            ? 'Every medicine needs a goods classification before it can be billed.'
            : 'Lab tests without their own classification use the lab default.'}
        </p>
        {q.isPending ? (
          <Skeleton className="h-40 w-full" />
        ) : q.error ? (
          <Alert tone="error">{errorMessage(q.error)}</Alert>
        ) : q.data.rows.length === 0 ? (
          <EmptyState icon={ReceiptText} title={search ? 'Nothing matches' : 'No items yet'} />
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {q.data.rows.map((i) => (
              <li
                key={i.id}
                className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="text-body-sm">
                  <span className="font-medium">{i.name}</span>{' '}
                  <span className="text-ink-muted">{i.detail}</span>
                </div>
                {canEdit ? (
                  <Select
                    aria-label={`Tax classification for ${i.name}`}
                    className="sm:w-72"
                    value={i.classificationId ?? ''}
                    onChange={async (e) => {
                      const v = e.target.value || null;
                      if (
                        await act(
                          () => taxApi.assign(tab, i.id, v),
                          `${i.name}: classification saved.`,
                        )
                      )
                        void qc.invalidateQueries({ queryKey: ['tax-items'] });
                    }}
                  >
                    <option value="">
                      {tab === 'medicines' ? 'Not classified' : 'Use lab default'}
                    </option>
                    {options
                      .filter((c) => c.isActive || c.id === i.classificationId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                  </Select>
                ) : (
                  <span className="text-body-sm text-ink-secondary">
                    {name(i.classificationId) ??
                      (tab === 'medicines' ? 'Not classified' : 'Lab default')}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {q.data && q.data.meta && q.data.meta.totalPages > 1 && (
          <div className="flex items-center justify-end gap-2 text-body-sm">
            <Button
              size="compact"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage(page - 1)}
            >
              Previous
            </Button>
            <span>
              Page {page} of {q.data.meta.totalPages}
            </span>
            <Button
              size="compact"
              variant="secondary"
              disabled={page >= q.data.meta.totalPages}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </div>
        )}
      </div>
    </Panel>
  );
}

function RoomRule({ t }: { t: TaxSettings }) {
  const rule = t.roomRules.filter((r) => r.effectiveFrom <= t.taxDate).at(-1);
  return (
    <Panel title="Room charges">
      <div className="p-5 text-body-sm">
        {rule ? (
          <p>
            Rooms charged above ₹{Number(rule.thresholdPerDay).toLocaleString('en-IN')} a day
            attract {Number(rule.ratePercent)}% GST (SAC {rule.sacCode}); critical care rooms are
            exempt. Set by law ({rule.legalReference}); not editable.
          </p>
        ) : (
          <p className="text-ink-secondary">No statutory room rule is in force.</p>
        )}
      </div>
    </Panel>
  );
}
