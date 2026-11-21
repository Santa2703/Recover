import { legacyRedirect } from '@/components/governance/legacyRedirect';

/** Evidence gaps is now a tab of the Audit log. */
export default async function EvidenceGapsRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return legacyRedirect(searchParams, '/audit', { tab: 'gaps' });
}
