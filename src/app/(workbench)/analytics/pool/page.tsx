import { redirect } from 'next/navigation';

/** Pool efficiency is now the Results tab of the Pool optimizer; keep old links and bookmarks working. */
export default function Page() {
  redirect('/product/pools?tab=results');
}
