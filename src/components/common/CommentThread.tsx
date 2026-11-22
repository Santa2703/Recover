'use client';

import React, { useState, useSyncExternalStore } from 'react';
import { message } from 'antd';
import { MessageSquare, Send } from 'lucide-react';
import { useAuth, SESSION_USER } from '@/store/authContext';
import { COMMENT_MAX_LENGTH, commentService, type CommentKind, type RecordComment } from '@/services/commentService';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('');

const fmtWhen = (iso: string) => {
  const d = new Date(iso);
  return `${d.toISOString().slice(0, 10)} ${d.toISOString().slice(11, 16)} UTC`;
};

/** Live comment count for a record (for tab labels such as "Comments (2)"). */
export function useCommentCount(kind: CommentKind, id: string | null | undefined): number {
  const items = useSyncExternalStore(
    commentService.subscribe,
    () => (id ? commentService.threadNow(kind, id) : EMPTY),
    () => (id ? commentService.threadNow(kind, id) : EMPTY),
  );
  return items.length;
}
const EMPTY: RecordComment[] = [];

interface Props {
  kind: CommentKind;
  /** Record id: case id, source id, audit entry id, workflow id, conflict id or event id. */
  id: string;
  /** Hide the "Comments (n)" heading when the host already shows one (e.g. a tab label). */
  hideHeading?: boolean;
  className?: string;
}

/**
 * Comment thread on one record: the list (oldest first) and an add box. Text is shown exactly as
 * typed (a plain text node, whitespace kept): it is never interpreted as HTML, markdown or links.
 * Ctrl+Enter (Cmd+Enter on Mac) posts.
 */
export function CommentThread({ kind, id, hideHeading, className }: Props) {
  const { currentRole } = useAuth();
  const items = useSyncExternalStore(
    commentService.subscribe,
    () => commentService.threadNow(kind, id),
    () => commentService.threadNow(kind, id),
  );
  const [draft, setDraft] = useState('');
  const [posting, setPosting] = useState(false);
  const inputId = `comment-${kind}-${id}`.replace(/[^a-zA-Z0-9_-]/g, '-');

  const post = async () => {
    if (!draft.trim() || posting) return;
    setPosting(true);
    try {
      await commentService.add(kind, id, draft, { name: SESSION_USER.name, role: currentRole });
      setDraft('');
      message.success('Comment posted');
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setPosting(false);
    }
  };

  return (
    <section className={`min-w-0 ${className ?? ''}`} aria-label="Comments">
      {!hideHeading && (
        <h3 className="m-0 mb-2 flex items-center gap-1.5 text-xs font-extrabold text-[#141416]">
          <MessageSquare size={14} className="text-amber-500" />
          Comments <span className="font-mono font-bold text-[#64748B]">({items.length})</span>
        </h3>
      )}
      {items.length === 0 ? (
        <p className="m-0 rounded-xl border border-dashed border-[#E2E8F0] bg-[#F8FAFC] px-3 py-3 text-center text-xs text-[#94A3B8]">No comments yet</p>
      ) : (
        <ol className="m-0 list-none space-y-2.5 p-0">
          {items.map((c) => (
            <li key={c.id} className="flex min-w-0 gap-2">
              <span
                aria-hidden
                className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[#E2E8F0] bg-[#F1F5F9] text-[10px] font-bold text-[#475569]"
              >
                {initials(c.author)}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-1.5 text-[11px]">
                  <span className="font-bold text-[#141416]">{c.author}</span>
                  <span className="text-[#64748B]">{c.role}</span>
                  <time dateTime={c.at} className="font-mono text-[#94A3B8]">
                    {fmtWhen(c.at)}
                  </time>
                </div>
                {/* Plain text node: React escapes it; whitespace and line breaks are kept. */}
                <p className="m-0 mt-0.5 whitespace-pre-wrap break-words text-xs leading-relaxed text-[#334155]">{c.text}</p>
              </div>
            </li>
          ))}
        </ol>
      )}
      <div className="mt-3">
        <label htmlFor={inputId} className="sr-only">
          Add a comment
        </label>
        <textarea
          id={inputId}
          value={draft}
          maxLength={COMMENT_MAX_LENGTH}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void post();
            }
          }}
          rows={2}
          placeholder="Add a comment"
          className="block w-full resize-y rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-xs text-[#141416] placeholder-[#94A3B8] focus:border-[#FFD600] focus:bg-white focus:outline-none"
        />
        <div className="mt-1.5 flex items-center justify-between gap-2">
          <span className="text-[11px] text-[#94A3B8]">
            Posting as {SESSION_USER.name} ({currentRole}) · Ctrl+Enter to post
          </span>
          <button
            type="button"
            onClick={post}
            disabled={!draft.trim() || posting}
            className="inline-flex cursor-pointer items-center gap-1 rounded-xl border border-[#E2E8F0] bg-white px-3 py-1 text-xs font-semibold text-[#141416] hover:border-gray-400 disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Send size={12} /> {posting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
    </section>
  );
}
