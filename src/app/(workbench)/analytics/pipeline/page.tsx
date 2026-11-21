import { redirect } from 'next/navigation';

/** Pipeline funnel moved to a tab; keep old links and bookmarks working. */
export default function Page() {
  redirect('/analytics?tab=flow');
}
