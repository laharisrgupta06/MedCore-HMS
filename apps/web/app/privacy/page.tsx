import type { Metadata } from 'next';
import { DocumentPage } from '@/components/public/public-shell';
import { Alert } from '@/components/ui/alert';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description: 'How MedCore HMS handles personal and health information.',
};

export default function PrivacyPage() {
  return (
    <DocumentPage title="Privacy Policy" updated="16 November 2026">
      <Alert tone="warning" title="Draft pending legal review" className="mt-6">
        This policy describes how the software currently works. It has not yet been reviewed by a
        lawyer and is not a statement of compliance with any law or certification.
      </Alert>
      <h2>Who is responsible for your data</h2>
      <p>
        Each hospital that uses MedCore decides what patient and staff information it records and
        why. MedCore stores and processes that information for the hospital. Questions about your
        records should go to your hospital first.
      </p>
      <h2>What we store</h2>
      <ul>
        <li>
          Account details: name, email address, optional mobile number, role and the hospital you
          belong to.
        </li>
        <li>
          For patients: date of birth, gender and the medical record number your hospital assigns.
        </li>
        <li>
          Clinical, appointment, prescription, laboratory, pharmacy and billing records created by
          hospital staff.
        </li>
        <li>Passwords are stored only as one-way hashes; we cannot read them.</li>
        <li>
          An audit trail of sign-ins and changes, with the time, your IP address and browser type.
          Audit entries record which fields were changed, not their contents.
        </li>
      </ul>
      <h2>How information is kept separate</h2>
      <p>
        Every hospital&apos;s records are isolated: staff can only see records of their own
        hospital, and patients can only see their own records. Platform administrators can access
        hospitals for support, and each such access is logged.
      </p>
      <h2>Cookies</h2>
      <ul>
        <li>
          <strong>mc_rt</strong>: keeps you signed in for up to 7 days. It cannot be read by page
          scripts and is sent only to the sign-in service.
        </li>
        <li>
          <strong>mc_csrf</strong>: protects forms against cross-site request forgery.
        </li>
      </ul>
      <p>
        We do not use advertising or analytics cookies, and we do not sell personal information.
      </p>
      <h2>Messages we send</h2>
      <p>
        Verification codes, password-reset links and service notifications are sent by email and, if
        you add a mobile number, by SMS through the hospital&apos;s configured providers.
      </p>
      <h2>Your choices</h2>
      <p>
        You can update your name and mobile number in your account and sign out of every device at
        any time. Requests to correct or delete clinical records are handled by your hospital,
        because clinical records are kept with their full correction history.
      </p>
      <h2>Contact</h2>
      <p>Contact your hospital&apos;s administrator for any privacy question about your records.</p>
    </DocumentPage>
  );
}
