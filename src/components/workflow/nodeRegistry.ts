import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  AlertTriangle,
  Bell,
  Bot,
  CircleStop,
  Clock,
  Database,
  GitBranch,
  Server,
  ShieldCheck,
  UserCheck,
  Zap,
} from 'lucide-react';
import type { NodeRunStatus, WorkflowNodeData, WorkflowNodeKind } from '@/services/workflowService';
import { NODE_KIND_LABEL } from '@/services/workflowService';

/** Node categories. Colours come from the Workflow Studio's existing palette. */
export type NodeCategory = 'start' | 'data' | 'processing' | 'control' | 'alert' | 'terminal';

export const CATEGORY_COLOR: Record<NodeCategory, string> = {
  start: '#059669',
  data: '#0284C7',
  processing: '#8B5CF6',
  control: '#D97706',
  alert: '#EF4444',
  terminal: '#64748B',
};

export interface NodeKindMeta {
  kind: WorkflowNodeKind;
  label: string;
  category: NodeCategory;
  icon: LucideIcon;
  hint: string;
  defaults: Omit<WorkflowNodeData, 'status'>;
}

export const NODE_KINDS: NodeKindMeta[] = [
  { kind: 'trigger', label: NODE_KIND_LABEL.trigger, category: 'start', icon: Zap, hint: 'Schedule, event or file arrival', defaults: { label: 'Trigger', subtitle: 'Every 15 min', config: [{ key: 'schedule', value: '*/15 * * * *' }], inputs: [], outputs: ['event'] } },
  { kind: 'dataSource', label: NODE_KIND_LABEL.dataSource, category: 'data', icon: Database, hint: 'Read records from a system', defaults: { label: 'Data source', subtitle: 'Select a source system', config: [{ key: 'entity', value: '' }], inputs: ['event'], outputs: ['records'] } },
  { kind: 'mcpTool', label: NODE_KIND_LABEL.mcpTool, category: 'processing', icon: Server, hint: 'Call an MCP tool or API', defaults: { label: 'MCP tool', subtitle: 'REST / SOAP, auth, throttling', config: [{ key: 'tool', value: '' }, { key: 'timeoutMs', value: '5000' }], inputs: ['payload'], outputs: ['result'] } },
  { kind: 'agent', label: NODE_KIND_LABEL.agent, category: 'processing', icon: Bot, hint: 'AI agent step', defaults: { label: 'Agent', subtitle: 'Reasoning step', config: [{ key: 'model', value: 'planner-v2' }], inputs: ['context'], outputs: ['decision'] } },
  { kind: 'condition', label: NODE_KIND_LABEL.condition, category: 'control', icon: GitBranch, hint: 'Branch on true / false', defaults: { label: 'Condition', subtitle: 'True / false branch', condition: 'records.count > 0', config: [{ key: 'branch', value: 'true' }], inputs: ['records'], outputs: ['true', 'false'] } },
  { kind: 'validation', label: NODE_KIND_LABEL.validation, category: 'processing', icon: ShieldCheck, hint: 'Schema and completeness checks', defaults: { label: 'Validation', subtitle: 'Schema, completeness and reference checks', config: [{ key: 'schema', value: '' }], inputs: ['records'], outputs: ['valid_records'] } },
  { kind: 'approval', label: NODE_KIND_LABEL.approval, category: 'control', icon: UserCheck, hint: 'Human sign-off', defaults: { label: 'Approval', subtitle: 'Awaiting sign-off', config: [{ key: 'approverRole', value: 'Approver' }, { key: 'slaHours', value: '24' }], inputs: ['request'], outputs: ['approved'] } },
  { kind: 'action', label: NODE_KIND_LABEL.action, category: 'processing', icon: Activity, hint: 'Transform or write data', defaults: { label: 'Action', subtitle: 'Transform and write', config: [{ key: 'target', value: '' }], inputs: ['records'], outputs: ['result'] } },
  { kind: 'notification', label: NODE_KIND_LABEL.notification, category: 'alert', icon: Bell, hint: 'Alert a team or queue', defaults: { label: 'Notification', subtitle: 'Email / Teams', config: [{ key: 'channel', value: '' }], inputs: ['message'], outputs: ['sent'] } },
  { kind: 'end', label: NODE_KIND_LABEL.end, category: 'terminal', icon: CircleStop, hint: 'Finish the run', defaults: { label: 'Complete', subtitle: 'Run finished', config: [], inputs: ['result'], outputs: [] } },
];

export const KIND_META: Record<WorkflowNodeKind, NodeKindMeta> = Object.fromEntries(NODE_KINDS.map((m) => [m.kind, m])) as Record<
  WorkflowNodeKind,
  NodeKindMeta
>;

/** Icons a node may use instead of its type's default (kept for nodes that existed before the builder). */
export const ICON_OVERRIDES: Record<string, LucideIcon> = { Clock, AlertTriangle, Server, ShieldCheck, Database, Activity };

export const kindColor = (kind: WorkflowNodeKind) => CATEGORY_COLOR[KIND_META[kind].category];

export const STATUS_STYLE: Record<NodeRunStatus, { text: string; dot: string; edge: string }> = {
  Success: { text: '#15803D', dot: '#10B981', edge: '#10B981' },
  Running: { text: '#0284C7', dot: '#0284C7', edge: '#0284C7' },
  Warning: { text: '#D97706', dot: '#F59E0B', edge: '#F59E0B' },
  Failed: { text: '#DC2626', dot: '#EF4444', edge: '#EF4444' },
  Skipped: { text: '#94A3B8', dot: '#CBD5E1', edge: '#CBD5E1' },
  Idle: { text: '#64748B', dot: '#CBD5E1', edge: '#CBD5E1' },
};

export const NODE_STATUSES: NodeRunStatus[] = ['Idle', 'Running', 'Success', 'Warning', 'Failed', 'Skipped'];

/** Drag payload MIME type used by the palette. */
export const DND_MIME = 'application/x-workflow-node';

export interface PaletteTemplate {
  kind: WorkflowNodeKind;
  data?: Partial<WorkflowNodeData>;
}
