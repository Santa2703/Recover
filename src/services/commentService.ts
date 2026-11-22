/**
 * Comments on records: one thread per record, keyed `${kind}:${id}` (case, source, audit entry,
 * workflow, conflict, event). Seeded from src/data/comments.json; new comments live in the
 * in-memory store for the session. Text is stored and returned as plain text: the UI renders it
 * as a text node, never as HTML or markdown.
 */
import commentsJson from '@/data/comments.json';
import type { UserRole } from '@/models/user.model';
import { createCollection, delay } from './mock/mockUtils';
import { meta } from './mock/stores';

export type CommentKind = 'case' | 'source' | 'audit' | 'workflow' | 'conflict' | 'event';

export interface RecordComment {
  id: string;
  kind: CommentKind;
  /** Id of the record (case id, source id, audit entry id, …). */
  refId: string;
  author: string;
  role: UserRole;
  /** ISO timestamp. */
  at: string;
  text: string;
}

export const COMMENT_MAX_LENGTH = 2000;

const store = createCollection<RecordComment>(commentsJson as RecordComment[]);
let seq = Math.max(0, ...store.all().map((c) => Number(c.id.replace(/\D/g, '')) || 0));

const LOADED_AT = Date.now();
/** Mock clock: the data's "as of" time plus the time since the app loaded. */
const nowIso = () => new Date(Date.parse(meta.asOf) + (Date.now() - LOADED_AT)).toISOString();

export const commentKey = (kind: CommentKind, id: string) => `${kind}:${id}`;

/** Stable array per thread until the store changes, so it can back useSyncExternalStore. */
const cache = new Map<string, { ver: number; items: RecordComment[] }>();
const EMPTY: RecordComment[] = [];

export const commentService = {
  subscribe: store.subscribe,

  /** Comments on one record, oldest first (synchronous; stable reference between changes). */
  threadNow(kind: CommentKind, id: string): RecordComment[] {
    const key = commentKey(kind, id);
    const ver = store.version();
    const hit = cache.get(key);
    if (hit && hit.ver === ver) return hit.items;
    const items = store
      .all()
      .filter((c) => c.kind === kind && c.refId === id)
      .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    const out = items.length ? items : EMPTY;
    cache.set(key, { ver, items: out });
    return out;
  },

  async thread(kind: CommentKind, id: string): Promise<RecordComment[]> {
    await delay(120);
    return commentService.threadNow(kind, id);
  },

  countNow: (kind: CommentKind, id: string) => commentService.threadNow(kind, id).length,

  async add(kind: CommentKind, id: string, text: string, author: { name: string; role: UserRole }): Promise<RecordComment> {
    await delay(150);
    const body = text.replace(/\r\n/g, '\n').trim();
    if (!body) throw new Error('Write a comment first');
    if (body.length > COMMENT_MAX_LENGTH) throw new Error(`Comments are limited to ${COMMENT_MAX_LENGTH} characters`);
    seq += 1;
    return store.insert({ id: `CMT-${String(seq).padStart(4, '0')}`, kind, refId: id, author: author.name, role: author.role, at: nowIso(), text: body });
  },
};
