import { redirect } from 'next/navigation';

/** Old URL: the playground is now a drawer on Tools (/mcp?playground=1). Query params (e.g. ?tool=, ?agent=) are carried over. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = new URLSearchParams('playground=1');
  for (const [k, v] of Object.entries(await searchParams)) {
    if (typeof v === 'string' && !q.has(k)) q.set(k, v);
  }
  const qs = q.toString();
  redirect(`/mcp${qs ? `?${qs}` : ''}`);
}
