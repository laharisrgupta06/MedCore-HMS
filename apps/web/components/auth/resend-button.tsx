'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { errorMessage } from '@/lib/forms';

/** Resend with the API's 60-second cooldown shown as a countdown. */
export function ResendButton({
  onResend,
  onResult,
  initialCooldown = 60,
}: {
  onResend: () => Promise<string | void>;
  onResult: (r: { ok: boolean; message: string }) => void;
  initialCooldown?: number;
}) {
  const [left, setLeft] = useState(initialCooldown);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (left <= 0) return;
    const t = setTimeout(() => setLeft((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [left]);
  return (
    <Button
      variant="link"
      loading={busy}
      disabled={left > 0}
      onClick={async () => {
        setBusy(true);
        try {
          const msg = await onResend();
          onResult({ ok: true, message: msg || 'A new code has been sent.' });
          setLeft(60);
        } catch (e) {
          onResult({ ok: false, message: errorMessage(e) });
        } finally {
          setBusy(false);
        }
      }}
    >
      {left > 0 ? `Resend code in ${left} s` : 'Resend code'}
    </Button>
  );
}
