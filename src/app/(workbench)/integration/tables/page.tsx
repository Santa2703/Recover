import { redirectWithQuery, type SearchParams } from '@/components/integration/redirectWithQuery';

/** Source tables (every mapping rule) moved into Data model › Mappings. */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  return redirectWithQuery(searchParams, '/integration/model', { tab: 'mappings' });
}
