import { Badge, type BadgeTone } from '@marktat/ui';
import type { ServiceProjectStatus } from '@marktat/shared';
import { projectStatusLabel } from '@/lib/projects';

const TONES: Record<ServiceProjectStatus, BadgeTone> = {
  DRAFT: 'neutral',
  ACTIVE: 'success',
  PAUSED: 'accent',
  CLOSED: 'neutral',
  PENDING_REVIEW: 'warning',
  REJECTED: 'danger',
  DELETED: 'danger',
};

export function ProjectStatusBadge({ status, expired = false }: { status: ServiceProjectStatus; expired?: boolean }) {
  return <Badge tone={expired ? 'warning' : TONES[status]}>{projectStatusLabel(status, expired)}</Badge>;
}
