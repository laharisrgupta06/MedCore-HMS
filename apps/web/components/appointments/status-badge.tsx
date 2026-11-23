import type { AppointmentStatus, AppointmentType } from '@medcore/types';
import {
  CalendarCheck,
  CircleDot,
  CircleSlash,
  Clock,
  Siren,
  Stethoscope,
  UserX,
} from 'lucide-react';
import { Badge } from '@/components/ui/misc';

const MAP: Record<
  AppointmentStatus,
  {
    label: string;
    tone: 'warning' | 'sage' | 'info' | 'success' | 'neutral' | 'error';
    icon: typeof Clock;
  }
> = {
  PENDING: { label: 'Pending', tone: 'warning', icon: Clock },
  CONFIRMED: { label: 'Confirmed', tone: 'sage', icon: CalendarCheck },
  IN_PROGRESS: { label: 'In consultation', tone: 'info', icon: Stethoscope },
  COMPLETED: { label: 'Completed', tone: 'success', icon: CircleDot },
  CANCELLED: { label: 'Cancelled', tone: 'neutral', icon: CircleSlash },
  NO_SHOW: { label: 'Did not attend', tone: 'error', icon: UserX },
};

export function AppointmentStatusBadge({
  status,
  type,
}: {
  status: AppointmentStatus;
  type?: AppointmentType;
}) {
  const s = MAP[status];
  return (
    <span className="inline-flex flex-wrap gap-1">
      <Badge tone={s.tone} icon={s.icon}>
        {s.label}
      </Badge>
      {type === 'EMERGENCY' && (
        <Badge tone="error" icon={Siren}>
          Emergency
        </Badge>
      )}
      {type === 'FOLLOW_UP' && <Badge tone="neutral">Follow-up</Badge>}
    </span>
  );
}
