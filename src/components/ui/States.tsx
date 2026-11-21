import React from 'react';
import { Inbox, SearchX, TriangleAlert, Lock } from 'lucide-react';
import { Button } from 'antd';

interface StateProps {
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
}

function Shell({ icon, title, description, action, compact }: StateProps & { icon: React.ReactNode }) {
  return (
    <div className={`flex flex-col items-center justify-center text-center ${compact ? 'py-6' : 'py-12'}`}>
      <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-ink-3">{icon}</div>
      <div className="text-xs font-medium text-ink">{title}</div>
      {description && <div className="mt-1 max-w-sm text-xs text-ink-2">{description}</div>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function EmptyState(props: StateProps) {
  return <Shell icon={<Inbox size={18} />} {...props} />;
}

export function NoResultsState({ onClear, ...props }: Partial<StateProps> & { onClear?: () => void }) {
  return (
    <Shell
      icon={<SearchX size={18} />}
      title={props.title ?? 'No results match these filters'}
      description={props.description ?? 'Try a different search term or clear the filters.'}
      action={onClear ? <Button onClick={onClear}>Clear filters</Button> : props.action}
      compact={props.compact}
    />
  );
}

export function ErrorState({ onRetry, ...props }: Partial<StateProps> & { onRetry?: () => void }) {
  return (
    <Shell
      icon={<TriangleAlert size={18} />}
      title={props.title ?? 'This view could not be loaded'}
      description={props.description ?? 'Your data is unchanged. Try again.'}
      action={onRetry ? <Button onClick={onRetry}>Retry</Button> : props.action}
      compact={props.compact}
    />
  );
}

export function PermissionState({ role, ...props }: Partial<StateProps> & { role?: string }) {
  return (
    <Shell
      icon={<Lock size={18} />}
      title={props.title ?? 'Not available for your role'}
      description={props.description ?? (role ? `The ${role} view does not include this page.` : undefined)}
      action={props.action}
      compact={props.compact}
    />
  );
}
