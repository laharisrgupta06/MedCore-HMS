import type { Prisma, Role } from '@prisma/client';

type Tx = Prisma.TransactionClient;

/** Who a notification goes to, read inside the business transaction. */
export async function appointmentPeople(tx: Tx, appointmentId: string) {
  const a = await tx.appointment.findUnique({
    where: { id: appointmentId },
    select: { patient: { select: { userId: true } }, doctor: { select: { userId: true } } },
  });
  return a ? { patient: a.patient.userId, doctor: a.doctor.userId } : null;
}

export async function patientOfRecord(tx: Tx, medicalRecordId: string): Promise<string | null> {
  const r = await tx.medicalRecord.findUnique({
    where: { id: medicalRecordId },
    select: { appointment: { select: { patient: { select: { userId: true } } } } },
  });
  return r?.appointment.patient.userId ?? null;
}

export async function patientOfInvoice(tx: Tx, invoiceId: string): Promise<string | null> {
  const i = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { patient: { select: { userId: true } } },
  });
  return i?.patient.userId ?? null;
}

/** Staff who receive pharmacy stock alerts (NOTIF-008: staff only). */
export const STOCK_ALERT_ROLES: Role[] = ['PHARMACIST', 'HOSPITAL_ADMIN'];

export async function activeStaff(tx: Tx, hospitalId: string, roles: Role[]): Promise<string[]> {
  const users = await tx.user.findMany({
    where: { hospitalId, role: { in: roles }, isActive: true, deletedAt: null },
    select: { id: true },
  });
  return users.map((u) => u.id);
}
