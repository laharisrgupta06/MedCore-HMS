'use client';

import type { Authored } from '@medcore/types';
import { History } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, textareaClass } from '@/components/ui/field';
import { Badge } from '@/components/ui/misc';
import { toast } from '@/components/ui/toast';
import { errorMessage } from '@/lib/forms';

/** Clinical text areas use the shared field style (components/ui/field). */
export { textareaClass };

/** Clinical timestamps in the hospital's time zone, like appointments (DEC-038). */
export const when = (iso: string, tz: string) =>
  new Intl.DateTimeFormat('en-IN', {
    timeZone: tz,
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(iso));

/** Author, time and correction state of a clinical row (nothing is overwritten, DEC-016). */
export function Provenance({ row, tz }: { row: Authored; tz: string }) {
  return (
    <p className="text-caption text-ink-muted">
      {row.by.firstName} {row.by.lastName} · {when(row.at, tz)}
      {row.supersedesId && (
        <>
          {' · '}
          <span className="text-ink-secondary">Correction: {row.correctionReason}</span>
        </>
      )}
    </p>
  );
}

export function CorrectedBadge({ row }: { row: Authored }) {
  return row.corrected ? (
    <Badge tone="neutral" icon={History}>
      Corrected later
    </Badge>
  ) : null;
}

/**
 * A dialog that saves a clinical entry. With `correcting`, it asks why: the original stays, and the
 * new row records the reason.
 */
export function EntryDialog({
  title,
  correcting,
  onClose,
  onSave,
  children,
  submitLabel,
}: {
  title: string;
  correcting?: boolean;
  onClose: () => void;
  onSave: (reason: string | undefined) => Promise<unknown>;
  children: ReactNode;
  submitLabel?: string;
}) {
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const submit = async () => {
    if (correcting && reason.trim().length < 3) return setError('Say why this needs correcting.');
    setSaving(true);
    setError(null);
    try {
      await onSave(correcting ? reason.trim() : undefined);
      toast.success(correcting ? 'Correction saved. The original stays in the record.' : 'Saved.');
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Dialog
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={title}
      description={correcting ? 'The original entry is kept and marked as corrected.' : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={saving} onClick={() => void submit()}>
            {submitLabel ?? (correcting ? 'Save correction' : 'Save')}
          </Button>
        </>
      }
    >
      {error && (
        <Alert tone="error" className="mb-4">
          {error}
        </Alert>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {children}
        {correcting && (
          <Field label="Reason for correction" required className="sm:col-span-2">
            {(p) => (
              <textarea
                id={p.id}
                aria-describedby={p.describedBy}
                className={textareaClass}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            )}
          </Field>
        )}
      </div>
    </Dialog>
  );
}

export function age(dob: string): number {
  const d = new Date(dob);
  const n = new Date();
  return (
    n.getFullYear() -
    d.getFullYear() -
    (n < new Date(n.getFullYear(), d.getMonth(), d.getDate()) ? 1 : 0)
  );
}
