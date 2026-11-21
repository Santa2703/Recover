import { redirectWithQuery, type SearchParams } from '@/components/integration/redirectWithQuery';

/** Canonical models moved into Data model. */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  return redirectWithQuery(searchParams, '/integration/model');
}
