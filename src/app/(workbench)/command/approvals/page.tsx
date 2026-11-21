import { legacyRedirect } from '@/components/governance/legacyRedirect';

/** The Approvals inbox is now a tab of My work. */
export default async function ApprovalsRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return legacyRedirect(searchParams, '/command/actions', { tab: 'approvals' });
}
