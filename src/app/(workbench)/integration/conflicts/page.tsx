import { redirectWithQuery, type SearchParams } from '@/components/integration/redirectWithQuery';

/** The conflict queue is part of Issues › Open issues. */
export default async function Page({ searchParams }: { searchParams: SearchParams }) {
  return redirectWithQuery(searchParams, '/integration/issues');
}
