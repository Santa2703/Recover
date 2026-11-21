import { redirect } from 'next/navigation';

/** Old URL: connected MCP servers are now on Servers. Query params (e.g. ?tool=, ?agent=) are carried over. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = new URLSearchParams('');
  for (const [k, v] of Object.entries(await searchParams)) {
    if (typeof v === 'string' && !q.has(k)) q.set(k, v);
  }
  const qs = q.toString();
  redirect(`/mcp/servers${qs ? `?${qs}` : ''}`);
}
