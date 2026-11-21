import { legacyRedirect } from '@/components/governance/legacyRedirect';

/** Case runs now open as a drawer on Process flow. */
export default async function CaseRunsRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return legacyRedirect(searchParams, '/orchestration', { trace: '1' });
}
