import { redirect } from 'next/navigation';

/** Predicted vs. actual is now the Accuracy tab of Forecast quality; keep old links and bookmarks working. */
export default function Page() {
  redirect('/analytics/forecast');
}
