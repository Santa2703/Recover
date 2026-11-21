import { redirectWithQuery, type SearchParams } from '@/components/integration/redirectWithQuery';

/** Manual import is now Sources › Add source › File / CSV. */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  return redirectWithQuery(searchParams, '/integration/map', { add: 'file' });
}
