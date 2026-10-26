import { Badge, type BadgeTone } from '@marktat/ui';
import { LISTING_STATUS_LABELS, type ListingStatus } from '@marktat/shared';

const TONES: Record<ListingStatus, BadgeTone> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'warning',
  ACTIVE: 'success',
  PAUSED: 'accent',
  EXPIRED: 'warning',
  REJECTED: 'danger',
  DELETED: 'danger',
};

export function ListingStatusBadge({ status }: { status: ListingStatus }) {
  return <Badge tone={TONES[status]}>{LISTING_STATUS_LABELS[status]}</Badge>;
}
