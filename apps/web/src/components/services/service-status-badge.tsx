import { Badge, type BadgeTone } from '@marktat/ui';
import { SERVICE_PROFILE_STATUS_LABELS, type ServiceProfileStatus } from '@marktat/shared';

const TONES: Record<ServiceProfileStatus, BadgeTone> = {
  DRAFT: 'neutral',
  ACTIVE: 'success',
  PAUSED: 'accent',
  PENDING_REVIEW: 'warning',
  REJECTED: 'danger',
  DELETED: 'danger',
};

export function ServiceStatusBadge({ status }: { status: ServiceProfileStatus }) {
  return <Badge tone={TONES[status]}>{SERVICE_PROFILE_STATUS_LABELS[status]}</Badge>;
}
