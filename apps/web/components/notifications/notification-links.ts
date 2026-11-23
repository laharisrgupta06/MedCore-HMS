import type { NotificationView } from '@medcore/types';

/** Where a notification opens, by the record it is about and who is reading it. */
export function notificationHref(n: NotificationView, portal: boolean): string | null {
  const id = n.entityId;
  switch (n.entityType) {
    case 'Appointment':
      return portal ? '/portal/appointments' : '/dashboard/appointments';
    case 'LabOrder':
      return portal ? '/portal/lab-reports' : null;
    case 'Prescription':
      return portal ? '/portal/prescriptions' : null;
    case 'Invoice':
      return id ? `${portal ? '/portal' : '/dashboard'}/invoices/${id}` : null;
    case 'Payment':
      return portal ? '/portal/payments' : null;
    case 'Medicine':
    case 'ExpiryReport':
      return portal ? null : '/dashboard/pharmacy/alerts';
    default:
      return null;
  }
}
