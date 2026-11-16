import { SetMetadata } from '@nestjs/common';

export const AUDIT = 'medcore:audit';
export const SKIP_AUDIT = 'medcore:skipAudit';

export interface AuditMeta {
  /** e.g. "user.update" */
  action: string;
  /** e.g. "User" */
  entityType: string;
  /**
   * Request-body fields whose VALUES may be stored, for non-sensitive, non-identifying values such
   * as status flags. Every other field is recorded by name only (DEC-030).
   */
  safeFields?: readonly string[];
  /** Also audit successful reads of this route (clinical record views, EMR access audit). */
  read?: boolean;
}

/** Names the audit action for a write route. Write routes without it are audited generically. */
export const Audit = (action: string, entityType: string, safeFields: readonly string[] = []) =>
  SetMetadata(AUDIT, { action, entityType, safeFields } satisfies AuditMeta);

/** For routes that write their own, more specific audit entries (the auth controller). */
export const SkipAudit = () => SetMetadata(SKIP_AUDIT, true);

/** Audits every successful read of a route: who viewed which clinical record and when (roadmap Phase 4). */
export const AuditRead = (action: string, entityType: string) =>
  SetMetadata(AUDIT, { action, entityType, read: true } satisfies AuditMeta);
