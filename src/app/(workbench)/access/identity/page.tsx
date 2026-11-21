import { legacyRedirect } from '@/components/governance/legacyRedirect';

/** Identity provider is now a tab of Users & identity. */
export default async function IdentityRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return legacyRedirect(searchParams, '/access', { tab: 'identity' });
}
