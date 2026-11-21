import { legacyRedirect } from '@/components/governance/legacyRedirect';

/** Outcomes to confirm is now a tab of My work. */
export default async function OutcomesRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return legacyRedirect(searchParams, '/command/actions', { tab: 'outcomes' });
}
