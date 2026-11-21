/** Formatting helpers. Use these instead of ad-hoc toFixed / toLocaleString in components. */

export function money(n: number, opts: { compact?: boolean; sign?: boolean } = {}): string {
  const sign = n < 0 ? '−' : opts.sign && n > 0 ? '+' : '';
  const v = Math.abs(n);
  if (opts.compact) {
    if (v >= 1e6) return `${sign}$${(v / 1e6).toFixed(v >= 1e7 ? 1 : 2)}M`;
    if (v >= 1e3) return `${sign}$${(v / 1e3).toFixed(v >= 1e5 ? 0 : 1).replace(/\.0$/, '')}k`;
  }
  return `${sign}$${Math.round(v).toLocaleString('en-US')}`;
}

export const moneyK = (n: number) => money(n, { compact: true });

export function num(n: number, digits = 0): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function pct(ratio: number, digits = 0): string {
  return `${(ratio * 100).toFixed(digits)}%`;
}

export function date(iso: string, withYear = false): string {
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', ...(withYear ? { year: 'numeric' } : {}), timeZone: 'UTC' });
}

export function dateTime(iso: string): string {
  const d = new Date(iso);
  return `${date(iso, true)}, ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })} UTC`;
}

/** "in 3 days", "today", "2 days overdue" */
export function dueLabel(days: number): string {
  if (days === 0) return 'Due today';
  if (days < 0) return `${Math.abs(days)}d overdue`;
  return `Due in ${days}d`;
}

export function relativeTime(iso: string, now: string): string {
  const diff = (new Date(now).getTime() - new Date(iso).getTime()) / 1000;
  if (diff < 3600) return `${Math.max(1, Math.round(diff / 60))} min ago`;
  if (diff < 86400) return `${Math.round(diff / 3600)} h ago`;
  return `${Math.round(diff / 86400)} d ago`;
}

export const titleCase = (s: string) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
