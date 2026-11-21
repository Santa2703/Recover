import { redirect } from 'next/navigation';

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Server-side redirect for a retired governance URL: sends the user to `path` with `extra` params
 * added, keeping any params the old URL carried (e.g. ?case=RT-1048).
 */
export async function legacyRedirect(searchParams: SearchParams, path: string, extra: Record<string, string>): Promise<never> {
  const sp = await searchParams;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    if (typeof v === 'string') q.set(k, v);
    else if (Array.isArray(v)) v.forEach((x) => q.append(k, x));
  }
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  redirect(`${path}?${q.toString()}`);
}
