'use client';

import { ROOM_TYPES, type Bed, type BedStatus, type Room, type RoomType } from '@medcore/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { BedDouble, DoorOpen, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { PageHeader } from '@/components/app/app-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { Badge, EmptyState, Panel, Skeleton } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/forms';
import { cn } from '@/lib/utils';
import { departmentsApi, facilitiesApi } from '@/services/org';
import { useAuth } from '@/store/auth';

const TYPE_LABEL: Record<RoomType, string> = {
  WARD: 'Ward',
  PRIVATE: 'Private',
  ICU: 'ICU',
  CONSULTATION: 'Consultation',
  OTHER: 'Other',
};
const BED: Record<
  BedStatus,
  { label: string; tone: 'success' | 'warning' | 'neutral'; cls: string }
> = {
  AVAILABLE: { label: 'Available', tone: 'success', cls: 'border-success/40 bg-success-bg' },
  OCCUPIED: { label: 'Occupied', tone: 'warning', cls: 'border-warning/40 bg-warning-bg' },
  MAINTENANCE: { label: 'Maintenance', tone: 'neutral', cls: 'border-border bg-surface-muted' },
};

export function RoomsView() {
  const me = useAuth((s) => s.me)!;
  const isAdmin = me.user.role === 'HOSPITAL_ADMIN';
  const canSetStatus = isAdmin || me.user.role === 'NURSE';
  const [type, setType] = useState('');
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['rooms', type],
    queryFn: () => facilitiesApi.rooms(type ? { type } : {}),
  });
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Room | null>(null);
  const invalidate = () => void qc.invalidateQueries({ queryKey: ['rooms'] });
  const setStatus = useMutation({
    mutationFn: (v: { bed: Bed; status: BedStatus }) =>
      facilitiesApi.updateBed(v.bed.id, { status: v.status }),
    onSuccess: (b) => {
      toast.success(`Bed ${b.label} is now ${BED[b.status].label.toLowerCase()}.`);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const removeBed = useMutation({
    mutationFn: (b: Bed) => facilitiesApi.deleteBed(b.id),
    onSuccess: () => {
      toast.success('Bed removed.');
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const removeRoom = useMutation({
    mutationFn: (r: Room) => facilitiesApi.deleteRoom(r.id),
    onSuccess: () => {
      toast.success('Room deleted.');
      setDeleting(null);
      invalidate();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });
  const totals = (q.data ?? [])
    .flatMap((r) => r.beds)
    .reduce(
      (a, b) => ({ ...a, [b.status]: (a[b.status] ?? 0) + 1 }),
      {} as Partial<Record<BedStatus, number>>,
    );

  return (
    <>
      <PageHeader
        title="Rooms and beds"
        description={
          canSetStatus
            ? 'Keep bed occupancy up to date for admissions and billing.'
            : 'Current bed occupancy.'
        }
        actions={
          isAdmin && (
            <Button onClick={() => setCreating(true)}>
              <Plus aria-hidden="true" />
              Add room
            </Button>
          )
        }
      />
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Select
          aria-label="Filter by room type"
          className="sm:w-52"
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          <option value="">All room types</option>
          {ROOM_TYPES.map((t) => (
            <option key={t} value={t}>
              {TYPE_LABEL[t]}
            </option>
          ))}
        </Select>
        {q.data && q.data.length > 0 && (
          <p className="text-body-sm text-ink-secondary" aria-live="polite">
            {totals.AVAILABLE ?? 0} available, {totals.OCCUPIED ?? 0} occupied,{' '}
            {totals.MAINTENANCE ?? 0} in maintenance
          </p>
        )}
      </div>
      {q.isPending && <Skeleton className="h-48 w-full" />}
      {q.error && (
        <Alert tone="error" title="Could not load rooms">
          {errorMessage(q.error)}{' '}
          <Button variant="link" onClick={() => void q.refetch()}>
            Try again
          </Button>
        </Alert>
      )}
      {q.data && q.data.length === 0 && (
        <Panel>
          <EmptyState
            icon={DoorOpen}
            title="No rooms yet"
            action={isAdmin && <Button onClick={() => setCreating(true)}>Add room</Button>}
          >
            {isAdmin ? 'Add rooms and their beds.' : 'Your administrator has not added rooms yet.'}
          </EmptyState>
        </Panel>
      )}
      <div className="flex flex-col gap-4">
        {q.data?.map((room) => (
          <Panel
            key={room.id}
            title={
              <span>
                Room {room.number}{' '}
                <span className="text-body-sm font-normal text-ink-secondary">
                  {TYPE_LABEL[room.type]}
                  {room.floor ? `, floor ${room.floor}` : ''}
                  {room.department ? `, ${room.department.name}` : ''}
                </span>
              </span>
            }
            actions={
              isAdmin && (
                <div className="flex gap-2">
                  <AddBed room={room} onDone={invalidate} />
                  <Button
                    size="compact"
                    variant="danger"
                    onClick={() => setDeleting(room)}
                    aria-label={`Delete room ${room.number}`}
                  >
                    <Trash2 aria-hidden="true" />
                    Delete
                  </Button>
                </div>
              )
            }
          >
            {room.beds.length === 0 ? (
              <p className="px-5 py-4 text-body-sm text-ink-muted">No beds in this room.</p>
            ) : (
              <ul className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
                {room.beds.map((bed) => (
                  <li
                    key={bed.id}
                    className={cn('flex flex-col gap-2 rounded-md border p-3', BED[bed.status].cls)}
                  >
                    <div className="flex items-center justify-between">
                      <span className="flex items-center gap-2 font-medium">
                        <BedDouble className="size-4" aria-hidden="true" />
                        Bed {bed.label}
                      </span>
                      <Badge tone={BED[bed.status].tone}>{BED[bed.status].label}</Badge>
                    </div>
                    {canSetStatus && (
                      <div className="flex items-center gap-2">
                        <Select
                          aria-label={`Status of bed ${bed.label} in room ${room.number}`}
                          value={bed.status}
                          disabled={setStatus.isPending}
                          onChange={(e) =>
                            setStatus.mutate({ bed, status: e.target.value as BedStatus })
                          }
                          className="h-8 text-body-sm"
                        >
                          {(Object.keys(BED) as BedStatus[]).map((s) => (
                            <option key={s} value={s}>
                              {BED[s].label}
                            </option>
                          ))}
                        </Select>
                        {isAdmin && (
                          <Button
                            size="icon"
                            variant="ghost"
                            aria-label={`Remove bed ${bed.label}`}
                            onClick={() => removeBed.mutate(bed)}
                          >
                            <Trash2 aria-hidden="true" />
                          </Button>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        ))}
      </div>
      {creating && <RoomDialog onClose={() => setCreating(false)} onDone={invalidate} />}
      {deleting && (
        <Dialog
          open
          onOpenChange={(o) => !o && setDeleting(null)}
          title={`Delete room ${deleting.number}?`}
          footer={
            <>
              <Button variant="ghost" onClick={() => setDeleting(null)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                loading={removeRoom.isPending}
                onClick={() => removeRoom.mutate(deleting)}
              >
                Delete room
              </Button>
            </>
          }
        >
          <p className="text-body-sm text-ink-secondary">
            Remove its beds first. Rooms used on invoices cannot be deleted.
          </p>
        </Dialog>
      )}
    </>
  );
}

function AddBed({ room, onDone }: { room: Room; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: () => facilitiesApi.addBed(room.id, label.trim()),
    onSuccess: () => {
      toast.success('Bed added.');
      setOpen(false);
      setLabel('');
      onDone();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <>
      <Button size="compact" variant="secondary" onClick={() => setOpen(true)}>
        <Plus aria-hidden="true" />
        Add bed
      </Button>
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={`Add a bed to room ${room.number}`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button loading={add.isPending} disabled={!label.trim()} onClick={() => add.mutate()}>
              Add bed
            </Button>
          </>
        }
      >
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (label.trim()) add.mutate();
          }}
        >
          {error && <Alert tone="error">{error}</Alert>}
          <Field label="Bed label" hint="For example A, B or 1." required>
            {({ id, describedBy }) => (
              <Input
                id={id}
                value={label}
                maxLength={20}
                onChange={(e) => setLabel(e.target.value)}
                aria-describedby={describedBy}
              />
            )}
          </Field>
        </form>
      </Dialog>
    </>
  );
}

function RoomDialog({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const hospitalId = useAuth((s) => s.me?.user.hospitalId)!;
  const departments = useQuery({
    queryKey: ['departments', hospitalId],
    queryFn: () => departmentsApi.list(hospitalId),
  });
  const [v, setV] = useState({
    number: '',
    type: 'WARD' as RoomType,
    floor: '',
    dailyCharge: '',
    departmentId: '',
  });
  const [error, setError] = useState<string | null>(null);
  const charge = v.dailyCharge === '' ? null : Number(v.dailyCharge);
  const invalid = !v.number.trim() || (charge !== null && (Number.isNaN(charge) || charge < 0));
  const save = useMutation({
    mutationFn: () =>
      facilitiesApi.createRoom({
        number: v.number.trim(),
        type: v.type,
        floor: v.floor.trim() || null,
        dailyCharge: charge,
        departmentId: v.departmentId || null,
      }),
    onSuccess: () => {
      toast.success('Room added.');
      onDone();
      onClose();
    },
    onError: (e) => setError(errorMessage(e)),
  });
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Add room"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={save.isPending} disabled={invalid} onClick={() => save.mutate()}>
            Add room
          </Button>
        </>
      }
    >
      <form
        noValidate
        className="grid gap-5 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!invalid) save.mutate();
        }}
      >
        {error && (
          <Alert tone="error" className="sm:col-span-2">
            {error}
          </Alert>
        )}
        <Field label="Room number" required>
          {({ id }) => (
            <Input
              id={id}
              value={v.number}
              maxLength={20}
              onChange={(e) => setV({ ...v, number: e.target.value })}
            />
          )}
        </Field>
        <Field label="Type" required>
          {({ id }) => (
            <Select
              id={id}
              value={v.type}
              onChange={(e) => setV({ ...v, type: e.target.value as RoomType })}
            >
              {ROOM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TYPE_LABEL[t]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Floor" hint="Optional.">
          {({ id, describedBy }) => (
            <Input
              id={id}
              value={v.floor}
              maxLength={20}
              aria-describedby={describedBy}
              onChange={(e) => setV({ ...v, floor: e.target.value })}
            />
          )}
        </Field>
        <Field
          label="Daily charge"
          hint="Optional; used for room billing."
          error={
            charge !== null && (Number.isNaN(charge) || charge < 0)
              ? 'Enter a positive amount.'
              : undefined
          }
        >
          {({ id, describedBy, invalid: inv }) => (
            <Input
              id={id}
              type="number"
              min={0}
              step="0.01"
              value={v.dailyCharge}
              aria-describedby={describedBy}
              aria-invalid={inv}
              onChange={(e) => setV({ ...v, dailyCharge: e.target.value })}
            />
          )}
        </Field>
        <Field label="Department" className="sm:col-span-2">
          {({ id }) => (
            <Select
              id={id}
              value={v.departmentId}
              onChange={(e) => setV({ ...v, departmentId: e.target.value })}
            >
              <option value="">No department</option>
              {departments.data?.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </form>
    </Dialog>
  );
}
