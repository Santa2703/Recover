/**
 * Templates remount on every navigation (see node_modules/next/dist/docs/.../template.md),
 * so each page reloads its data and charts replay their entrance animation when the
 * user returns to it. Layout state (sidebar, session) is unaffected.
 */
export default function WorkbenchTemplate({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
