/** Phase 11 analytics (DASH-006..011). Every figure comes from MedCore's own records. */
export interface DayPoint {
  /** YYYY-MM-DD in the hospital's time zone. */
  day: string;
  value: number;
}

export interface CountRow {
  key: string;
  label: string;
  count: number;
}

export interface OverviewAnalytics {
  from: string;
  to: string;
  timezone: string;
  kpis: {
    patientsTotal: number;
    patientsNew: number;
    appointmentsToday: number;
    activeDoctors: number;
    beds: { occupied: number; total: number; maintenance: number };
    /** Received payments today; none are recorded until migration M-12 is applied. */
    receivedToday: string;
  };
  registrations: DayPoint[];
  appointments: DayPoint[];
  appointmentStatus: CountRow[];
  departments: {
    id: string;
    name: string;
    appointments: number;
    completed: number;
    cancelled: number;
  }[];
  doctors: {
    id: string;
    name: string;
    department: string | null;
    appointments: number;
    completed: number;
    cancelled: number;
    noShow: number;
  }[];
}

export interface OperationsAnalytics {
  from: string;
  to: string;
  timezone: string;
  cancellations: { day: string; total: number; cancelled: number; noShow: number }[];
  lab: {
    ordered: number;
    byStatus: CountRow[];
    approved: number;
    /** Hours from order to approval, for orders approved in the range; null when none. */
    turnaroundMedianHours: number | null;
    turnaroundP90Hours: number | null;
    orders: DayPoint[];
  };
  pharmacy: {
    dispenses: number;
    unitsDispensed: number;
    dispensed: DayPoint[];
    lowStock: number;
    expiringIn30Days: number;
    activeMedicines: number;
  };
  billing: {
    invoicesIssued: number;
    invoicedTotal: string;
    received: string;
    receivedByMethod: { method: string; amount: string; count: number }[];
    outstanding: string;
    invoiced: DayPoint[];
  };
}

export const SEARCH_KINDS = [
  'patients',
  'doctors',
  'appointments',
  'invoices',
  'prescriptions',
  'medicines',
] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  /** Non-clinical context only (MRN, date, status, department). */
  subtitle: string;
  /** Page that opens the record for this role. */
  href: string;
}

export interface SearchResults {
  query: string;
  /** Kinds this role may search; others are never queried. */
  searched: SearchKind[];
  groups: { kind: SearchKind; hits: SearchHit[]; more: boolean }[];
}
