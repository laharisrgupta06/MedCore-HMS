'use client';

import { HomeView } from '@/components/app/home-view';
import { PATIENT_NAV } from '@/constants/navigation';

export default function PortalHome() {
  return <HomeView nav={PATIENT_NAV} home="/portal" />;
}
