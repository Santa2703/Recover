import { redirectWithQuery, type SearchParams } from '@/components/integration/redirectWithQuery';

/** Integration health is now the Health tab of Connection Fabric › Sources. */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  return redirectWithQuery(searchParams, '/integration/map', { tab: 'health' });
}
