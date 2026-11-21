import { redirect } from 'next/navigation';

export type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Server-side redirect for a retired Connection Fabric URL. Carries the old query string over
 * (e.g. ?source=, ?model=) and adds `extra`, which wins on conflict.
 */
export async function redirectWithQuery(searchParams: SearchParams, path: string, extra: Record<string, string> = {}): Promise<never> {
  const incoming = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(incoming)) {
    if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
    else if (v != null) q.set(k, v);
  }
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  const s = q.toString();
  redirect(s ? `${path}?${s}` : path);
}
