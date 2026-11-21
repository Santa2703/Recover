import { redirect } from 'next/navigation';

/** Model versions moved to a tab; keep old links and bookmarks working. */
export default function Page() {
  redirect('/analytics/forecast?tab=models');
}
