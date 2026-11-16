import type { Metadata } from 'next';
import { DocumentPage } from '@/components/public/public-shell';
import { Alert } from '@/components/ui/alert';

export const metadata: Metadata = {
  title: 'Terms and Conditions',
  description: 'Terms for using MedCore HMS.',
};

export default function TermsPage() {
  return (
    <DocumentPage title="Terms and Conditions" updated="16 November 2026">
      <Alert tone="warning" title="Draft pending legal review" className="mt-6">
        These terms describe how the software is intended to be used and have not yet been reviewed
        by a lawyer.
      </Alert>
      <h2>The service</h2>
      <p>
        MedCore HMS is software that hospitals use to manage registration, appointments, medical
        records, prescriptions, laboratory work, pharmacy stock and billing. It does not give
        medical advice. Clinical decisions are made by the hospital&apos;s qualified staff.
      </p>
      <h2>Accounts</h2>
      <ul>
        <li>Patients create their own account using the code provided by their hospital.</li>
        <li>Staff accounts are created by the hospital&apos;s administrator.</li>
        <li>Keep your password private. You are responsible for activity under your account.</li>
        <li>Tell your hospital immediately if you believe your account has been misused.</li>
      </ul>
      <h2>Acceptable use</h2>
      <ul>
        <li>Use the service only for the hospital and role your account belongs to.</li>
        <li>Do not try to access another person&apos;s records or another hospital&apos;s data.</li>
        <li>Do not interfere with the service or attempt to bypass its security controls.</li>
      </ul>
      <h2>Records and corrections</h2>
      <p>
        Clinical records are never silently changed. Corrections are added as new entries that show
        who made them, when and why.
      </p>
      <h2>Availability</h2>
      <p>
        We work to keep the service available but cannot guarantee uninterrupted access. Hospitals
        should keep their own procedures for downtime.
      </p>
      <h2>Changes</h2>
      <p>
        We may update these terms. The date at the top of this page shows when they last changed.
      </p>
    </DocumentPage>
  );
}
