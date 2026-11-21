import { redirect } from 'next/navigation';

/** Route mix moved to a tab; keep old links and bookmarks working. */
export default function Page() {
  redirect('/analytics?tab=mix');
}
