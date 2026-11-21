/**
 * Shared helpers for JSON-backed mock services.
 *
 * - `delay()` simulates network latency so loading states are exercised.
 * - `createCollection()` keeps an in-memory, mutable copy of a JSON dataset so
 *   edits (assign, resolve, approve…) persist while the user navigates, and
 *   notifies subscribers so badges and lists refresh.
 * - `queryList()` implements search / filter / sort / paginate once for all lists.
 *
 * To move to a real backend, replace the body of each service function with an
 * apiClient call; the return shapes (models/domain.model.ts) stay the same.
 */
import type { Paged } from '@/models/domain.model';

export function delay(ms?: number): Promise<void> {
  const wait = ms ?? 220 + Math.round(Math.random() * 180);
  return new Promise((resolve) => setTimeout(resolve, wait));
}

const clone = <T,>(v: T): T => (typeof structuredClone === 'function' ? structuredClone(v) : JSON.parse(JSON.stringify(v)));

type Listener = () => void;

export interface Collection<T extends { id: string }> {
  all(): T[];
  get(id: string): T | undefined;
  update(id: string, patch: Partial<T> | ((current: T) => Partial<T>)): T;
  insert(item: T): T;
  remove(id: string): void;
  subscribe(listener: Listener): () => void;
  version(): number;
}

export function createCollection<T extends { id: string }>(seed: T[]): Collection<T> {
  let items: T[] = clone(seed);
  let ver = 0;
  const listeners = new Set<Listener>();
  const emit = () => {
    ver += 1;
    listeners.forEach((l) => l());
  };
  return {
    all: () => items,
    get: (id) => items.find((i) => i.id === id),
    update(id, patch) {
      const idx = items.findIndex((i) => i.id === id);
      if (idx < 0) throw new Error(`Record ${id} not found`);
      const current = items[idx];
      const next = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
      items = [...items.slice(0, idx), next, ...items.slice(idx + 1)];
      emit();
      return next;
    },
    insert(item) {
      items = [item, ...items];
      emit();
      return item;
    },
    remove(id) {
      items = items.filter((i) => i.id !== id);
      emit();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    version: () => ver,
  };
}

export type SortDir = 'asc' | 'desc';

export interface ListQuery<T> {
  search?: string;
  searchFields?: (keyof T | ((item: T) => string))[];
  /** Exact-match filters; undefined, '' and 'all' are ignored. Arrays match any. */
  filters?: Partial<Record<keyof T, unknown>>;
  predicate?: (item: T) => boolean;
  sortBy?: keyof T | ((item: T) => string | number);
  sortDir?: SortDir;
  page?: number;
  pageSize?: number;
}

export function queryList<T>(source: T[], q: ListQuery<T> = {}): Paged<T> {
  let rows = source;
  const term = q.search?.trim().toLowerCase();
  if (term && q.searchFields?.length) {
    rows = rows.filter((row) =>
      q.searchFields!.some((f) => {
        const v = typeof f === 'function' ? f(row) : row[f];
        return String(v ?? '').toLowerCase().includes(term);
      }),
    );
  }
  if (q.filters) {
    for (const [key, val] of Object.entries(q.filters)) {
      if (val === undefined || val === '' || val === 'all' || (Array.isArray(val) && !val.length)) continue;
      rows = rows.filter((row) => {
        const v = (row as Record<string, unknown>)[key];
        return Array.isArray(val) ? val.includes(v) : v === val;
      });
    }
  }
  if (q.predicate) rows = rows.filter(q.predicate);
  if (q.sortBy) {
    const get = typeof q.sortBy === 'function' ? q.sortBy : (r: T) => r[q.sortBy as keyof T] as unknown as string | number;
    const dir = q.sortDir === 'asc' ? 1 : -1;
    rows = [...rows].sort((a, b) => {
      const av = get(a);
      const bv = get(b);
      if (av === bv) return 0;
      return (av > bv ? 1 : -1) * dir;
    });
  }
  const total = rows.length;
  const pageSize = q.pageSize ?? (total || 1);
  const page = Math.max(1, Math.min(q.page ?? 1, Math.max(1, Math.ceil(total / pageSize))));
  const start = (page - 1) * pageSize;
  return { items: rows.slice(start, start + pageSize), total, page, pageSize };
}

export const sum = (values: number[]) => values.reduce((s, v) => s + v, 0);
