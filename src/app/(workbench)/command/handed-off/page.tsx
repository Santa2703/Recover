import { legacyRedirect } from '@/components/governance/legacyRedirect';

/** Handed off is now a tab of My work. */
export default async function HandedOffRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return legacyRedirect(searchParams, '/command/actions', { tab: 'handed-off' });
}
