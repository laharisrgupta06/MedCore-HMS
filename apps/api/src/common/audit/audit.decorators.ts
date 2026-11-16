import { SetMetadata } from '@nestjs/common';

export const AUDIT = 'medcore:audit';
export const SKIP_AUDIT = 'medcore:skipAudit';

export interface AuditMeta {
  /** e.g. "user.update" */
  action: string;
  /** e.g. "User" */
  entityType: string;
}

/** Names the audit action for a write route. Write routes without it are audited generically. */
export const Audit = (action: string, entityType: string) =>
  SetMetadata(AUDIT, { action, entityType } satisfies AuditMeta);

/** For routes that write their own, more specific audit entries (the auth controller). */
export const SkipAudit = () => SetMetadata(SKIP_AUDIT, true);
