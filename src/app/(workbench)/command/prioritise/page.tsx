import { legacyRedirect } from '@/components/governance/legacyRedirect';

/** Prioritise is now a tab of My work. */
export default async function PrioritiseRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return legacyRedirect(searchParams, '/command/actions', { tab: 'prioritise' });
}
