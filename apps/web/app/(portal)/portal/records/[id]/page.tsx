'use client';

import { useParams } from 'next/navigation';
import { RecordView } from '@/components/emr/record-view';

export default function Page() {
  const { id } = useParams<{ id: string }>();
  return <RecordView recordId={id} backHref="/portal/health" />;
}
