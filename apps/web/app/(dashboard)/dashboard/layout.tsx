import type { Metadata } from 'next';
import type { ReactNode } from 'react';

/**
 * Signed-in area: kept out of search engines. Each page sets its own tab title from its heading
 * (PageHeader); this is the title until it does.
 */
export const metadata: Metadata = {
  title: 'Staff workspace',
  description: 'MedCore HMS staff workspace for hospital teams.',
  robots: { index: false, follow: false },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
