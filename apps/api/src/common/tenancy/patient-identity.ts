import type { AuthPrincipal } from '../auth/decorators';
import { notFound } from '../http/prisma-errors';

type PatientReader = {
  patient: {
    findFirst(args: {
      where: { userId: string; deletedAt: null };
      select: { id: true };
    }): Promise<{ id: string } | null>;
  };
};

/**
 * The one ownership check for patient-facing reads (Phase 10, DEC-060): the patient profile of the
 * signed-in user, resolved from the session (never from the request). Use it with the tenant client so
 * the hospital is scoped too. Without a live profile the caller gets "not found", the same answer as
 * for another patient's record, so nothing reveals that a record exists.
 */
export async function ownPatientId(
  db: PatientReader,
  actor: AuthPrincipal,
  notFoundOf = 'patient',
): Promise<string> {
  if (actor.role !== 'PATIENT') throw new Error('ownPatientId is for patient callers only');
  const p = await db.patient.findFirst({
    where: { userId: actor.userId, deletedAt: null },
    select: { id: true },
  });
  if (!p) throw notFound(notFoundOf);
  return p.id;
}
