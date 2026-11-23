'use client';

import { HomeView } from '@/components/app/home-view';
import { STAFF_NAV } from '@/constants/navigation';

export default function DashboardHome() {
  return <HomeView nav={STAFF_NAV} home="/dashboard" />;
}
