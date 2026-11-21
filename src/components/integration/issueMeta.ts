import type { Severity } from '@/models/domain.model';
import type { Conflict, ConflictStatus, EventStatus } from '@/services/integrationService';
import type { PillTone } from './Pills';

export const CONFLICT_STATUS_PILL: Record<ConflictStatus, { tone: PillTone; label: string }> = {
  open: { tone: 'neutral', label: 'Open' },
  escalated: { tone: 'info', label: 'Escalated' },
  resolved: { tone: 'low', label: 'Resolved' },
  auto_resolved: { tone: 'low', label: 'Auto-resolved' },
};

export const SEV_PILL: Record<Severity, { tone: PillTone; label: string }> = {
  high: { tone: 'high', label: 'High' },
  medium: { tone: 'medium', label: 'Med' },
  low: { tone: 'low', label: 'Low' },
};

export const EVENT_STATUS_PILL: Record<EventStatus, { tone: PillTone; label: string }> = {
  ok: { tone: 'low', label: 'OK' },
  warn: { tone: 'medium', label: 'Warn' },
  error: { tone: 'high', label: 'Error' },
};

export const QUICK_REASONS = ['System of record for this field', 'Confirmed by physical check', 'Most recent observation', 'Confirmed with the data owner'];

export const isOpenConflict = (c: Conflict) => c.status === 'open' || c.status === 'escalated';

/** Link to a source's drawer on the Sources page (accepts the source id or its name). */
export const sourceHref = (source: string, panel?: string) =>
  `/integration/map?source=${encodeURIComponent(source)}${panel ? `&panel=${panel}` : ''}`;
