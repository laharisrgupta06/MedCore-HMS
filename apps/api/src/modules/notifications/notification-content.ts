import type { NotificationChannelName, NotificationType } from '@medcore/types';

/**
 * What each notification says and where it goes (PRD NOTIF-002..009, DEC-063). DEC-065: titles and
 * bodies say only what is ready or changed; details are on the signed-in page. Email and SMS links
 * point to a portal or dashboard section, never carry tokens, ids or patient data.
 */
export interface NotificationContent {
  type: NotificationType;
  title: string;
  body: string;
  channels: NotificationChannelName[];
  /** Section of the web app the email or SMS points to. */
  path: string;
  /**
   * true: at most one of this type per recipient and entity. 'same-body': at most one per recipient,
   * entity and body (a reminder names the appointment time, so a rescheduled visit gets new ones).
   */
  once: boolean | 'same-body';
}

const c = (
  type: NotificationType,
  title: string,
  body: string,
  channels: NotificationChannelName[],
  path: string,
  once: boolean | 'same-body' = true,
): NotificationContent => ({ type, title, body, channels, path, once });

export const CONTENT = {
  /** NOTIF-003 (24 hours) and the existing 1-hour reminder (APPT-005). `when` is the visit time only. */
  appointmentReminder: (when: string, offset: '24h' | '1h') =>
    c(
      offset === '24h' ? 'appointment.reminder.24h' : 'appointment.reminder.1h',
      'Appointment reminder',
      `Reminder: you have an appointment on ${when}. See the details in your portal.`,
      ['IN_APP', 'EMAIL', 'SMS'],
      '/portal/appointments',
      'same-body',
    ),
  appointmentConfirmed: () =>
    c(
      'appointment.confirmed',
      'Appointment confirmed',
      'Your appointment has been confirmed. See the details in your portal.',
      ['IN_APP', 'EMAIL', 'SMS'],
      '/portal/appointments',
    ),
  appointmentCancelled: () =>
    c(
      'appointment.cancelled',
      'Appointment cancelled',
      'One of your appointments has been cancelled. See the details in your portal.',
      ['IN_APP', 'EMAIL'],
      '/portal/appointments',
    ),
  // A booking can be moved more than once, so each move is its own notification.
  appointmentRescheduled: () =>
    c(
      'appointment.rescheduled',
      'Appointment rescheduled',
      'One of your appointments has a new time. See the details in your portal.',
      ['IN_APP', 'EMAIL'],
      '/portal/appointments',
      false,
    ),
  appointmentEmergency: () =>
    c(
      'appointment.emergency',
      'Emergency appointment',
      'An emergency appointment has been booked with you. Open your appointments.',
      ['IN_APP', 'SMS'],
      '/dashboard/appointments',
    ),
  labReportReady: () =>
    c(
      'lab.report.ready',
      'Lab report ready',
      'A lab report is ready to view in your portal.',
      ['IN_APP', 'EMAIL'],
      '/portal/lab-reports',
    ),
  prescriptionReady: () =>
    c(
      'prescription.ready',
      'Prescription ready for pickup',
      'Your prescription is ready to collect at the pharmacy.',
      ['IN_APP', 'SMS'],
      '/portal/prescriptions',
    ),
  invoiceIssued: () =>
    c(
      'invoice.issued',
      'New bill',
      'A new bill is available in your portal.',
      ['IN_APP', 'EMAIL'],
      '/portal/invoices',
    ),
  paymentReceived: () =>
    c(
      'payment.received',
      'Payment received',
      'We have received a payment on your bill. Your receipt is in your portal.',
      ['EMAIL', 'SMS'],
      '/portal/payments',
    ),
  // A medicine can cross its reorder level again after a restock, and each sweep is a new report.
  stockLow: () =>
    c(
      'stock.low',
      'Low stock alert',
      'A medicine is below its reorder level. Open the pharmacy alerts.',
      ['IN_APP', 'EMAIL'],
      '/dashboard/pharmacy/alerts',
      false,
    ),
  stockExpiring: () =>
    c(
      'stock.expiring',
      'Expiring stock report',
      'A new expiring-stock report is ready. Open the pharmacy alerts.',
      ['IN_APP', 'EMAIL'],
      '/dashboard/pharmacy/alerts',
    ),
} as const;
