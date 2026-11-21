import { redirect } from 'next/navigation';

/** Old URL: server proposals are now the Requests tab on Servers. Query params (e.g. ?tool=, ?agent=) are carried over. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = new URLSearchParams('tab=requests');
  for (const [k, v] of Object.entries(await searchParams)) {
    if (typeof v === 'string' && !q.has(k)) q.set(k, v);
  }
  const qs = q.toString();
  redirect(`/mcp/servers${qs ? `?${qs}` : ''}`);
}
