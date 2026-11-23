import type { AppointmentStatus } from './appointments';

/** The patient portal dashboard (Phase 10, DEC-060): the signed-in patient's own data only. */
export interface PortalSummaryView {
  appointments: {
    upcoming: number;
    next: {
      id: string;
      scheduledAt: string;
      status: AppointmentStatus;
      doctorName: string;
      department: string;
    }[];
  };
  prescriptions: { readyForPickup: number; active: number };
  lab: { reportsReady30d: number; inProgress: number };
  billing: { openInvoices: number; outstanding: string };
  notifications: { unread: number };
}
