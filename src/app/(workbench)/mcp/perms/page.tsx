import { redirect } from 'next/navigation';

/** Old URL: tool grants are now the Permissions tab of each agent on Agents. Query params (e.g. ?tool=, ?agent=) are carried over. */
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const q = new URLSearchParams('tab=permissions');
  for (const [k, v] of Object.entries(await searchParams)) {
    if (typeof v === 'string' && !q.has(k)) q.set(k, v);
  }
  const qs = q.toString();
  redirect(`/mcp/agents${qs ? `?${qs}` : ''}`);
}
