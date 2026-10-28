import { Badge, type BadgeTone } from '@marktat/ui';
import { DEAL_STATUS_LABELS, type DealDisplayStatus } from '@marktat/shared';

const TONES: Record<DealDisplayStatus, BadgeTone> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'warning',
  ACTIVE: 'success',
  SCHEDULED: 'brand',
  UNVERIFIED: 'warning',
  SOLD_OUT: 'neutral',
  PAUSED: 'accent',
  EXPIRED: 'neutral',
  REJECTED: 'danger',
  DELETED: 'danger',
};

export function DealStatusBadge({ status }: { status: DealDisplayStatus }) {
  return <Badge tone={TONES[status]}>{DEAL_STATUS_LABELS[status]}</Badge>;
}
