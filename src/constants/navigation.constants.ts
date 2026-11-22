import type { UserRole } from '@/models/user.model';

/**
 * Single source of truth for the sidebar, breadcrumbs and role-based navigation.
 * Labels here are what the user sees in the sidebar and in the header breadcrumb.
 */

/** Live counts a sidebar entry can show as a badge. */
export type NavBadgeKey = 'exceptions' | 'actions' | 'approvals' | 'sources' | 'alerts';

/** Badge colours: red for problems, yellow for work waiting on the user. */
export const NAV_BADGE_COLOR: Record<NavBadgeKey, string> = {
  exceptions: '#DC2626',
  actions: '#FFD600',
  approvals: '#FFD600',
  sources: '#FFD600',
  alerts: '#DC2626',
};

export interface NavChild {
  key: string;
  label: string;
  path: string;
  badgeKey?: NavBadgeKey;
  /** Other routes that belong to this entry (e.g. case detail pages under Returned assets). */
  aliases?: string[];
}

export interface NavItem {
  id: string;
  label: string;
  /** Lucide icon name, resolved in AppSidebar. */
  iconName: string;
  /** Used for items without children (Dashboard, Settings). */
  path: string;
  /** Breadcrumb secondary label for items without children. */
  pageLabel?: string;
  badgeKey?: NavBadgeKey;
  aliases?: string[];
  children?: NavChild[];
}

export interface NavSection {
  id: string;
  title?: string;
  items: NavItem[];
}

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'main',
    items: [
      { id: 'dashboard', label: 'Dashboard', iconName: 'LayoutGrid', path: '/dashboard', pageLabel: 'Overview', aliases: ['/'] },
      {
        id: 'command',
        label: 'Command Center',
        iconName: 'Monitor',
        path: '/command',
        children: [
          { key: 'kpis', label: 'Key figures', path: '/command' },
          { key: 'exceptions', label: 'Exceptions', path: '/command/exceptions', badgeKey: 'exceptions' },
          { key: 'alerts', label: 'Alerts', path: '/command/alerts', badgeKey: 'alerts' },
          {
            key: 'mywork',
            label: 'My work',
            path: '/command/actions',
            badgeKey: 'actions',
            aliases: ['/command/approvals', '/command/value', '/command/outcomes', '/command/handed-off', '/command/prioritise'],
          },
          { key: 'signals', label: 'Signals & capacity', path: '/command/signals' },
        ],
      },
    ],
  },
  {
    id: 'product',
    title: 'PRODUCT',
    items: [
      {
        id: 'workbench',
        label: 'Decision Workbench',
        iconName: 'Layers',
        path: '/product/intelligence',
        children: [
          { key: 'intelligence', label: 'Asset intelligence', path: '/product/intelligence' },
          { key: 'received', label: 'Returned assets', path: '/product/received', aliases: ['/product/case'] },
          { key: 'expected', label: 'Expected returns', path: '/product/expected' },
          { key: 'pools', label: 'Pool optimizer', path: '/product/pools' },
          { key: 'rules', label: 'Business rules', path: '/product/rules' },
        ],
      },
      {
        id: 'analytics',
        label: 'Analytics',
        iconName: 'BarChart2',
        path: '/analytics',
        children: [
          { key: 'outcomes', label: 'Outcomes', path: '/analytics' },
          { key: 'forecast', label: 'Forecast quality', path: '/analytics/forecast' },
          { key: 'whatif', label: 'What-if', path: '/analytics/whatif' },
          { key: 'sustain', label: 'Sustainability', path: '/analytics/sustain' },
        ],
      },
    ],
  },
  {
    id: 'platform',
    title: 'PLATFORM',
    items: [
      {
        id: 'fabric',
        label: 'Connection Fabric',
        iconName: 'Network',
        path: '/integration/map',
        badgeKey: 'sources',
        aliases: ['/integration'],
        children: [
          { key: 'map', label: 'Sources', path: '/integration/map', aliases: ['/command/health'] },
          { key: 'model', label: 'Data model', path: '/integration/model' },
          { key: 'studio', label: 'Workflows', path: '/integration/studio' },
          { key: 'issues', label: 'Issues', path: '/integration/issues' },
        ],
      },
      {
        id: 'mcp',
        label: 'MCP & Tools',
        iconName: 'Box',
        path: '/mcp',
        children: [
          { key: 'catalog', label: 'Tools', path: '/mcp' },
          { key: 'agents', label: 'Agents', path: '/mcp/agents', aliases: ['/orchestration/agents'] },
          { key: 'servers', label: 'Servers', path: '/mcp/servers' },
          { key: 'calls', label: 'Call log', path: '/mcp/calls' },
        ],
      },
      {
        id: 'orchestration',
        label: 'Process Orchestration',
        iconName: 'GitFork',
        path: '/orchestration',
        pageLabel: 'Process flow',
      },
    ],
  },
  {
    id: 'governance',
    title: 'GOVERNANCE',
    items: [
      {
        id: 'audit',
        label: 'Audit & Provenance',
        iconName: 'FileCheck',
        path: '/audit',
        pageLabel: 'Audit log',
      },
      {
        id: 'access',
        label: 'Access & Governance',
        iconName: 'Lock',
        path: '/access',
        children: [
          { key: 'accounts', label: 'Users & identity', path: '/access' },
          { key: 'delegations', label: 'Delegations & thresholds', path: '/access/delegations' },
          { key: 'requests', label: 'Access requests', path: '/access/requests' },
          { key: 'agents', label: 'Agent controls', path: '/access/agents' },
        ],
      },
      { id: 'settings', label: 'Settings', iconName: 'Settings', path: '/settings', pageLabel: 'Settings' },
    ],
  },
];

/* ------------------------------------------------------------------ */
/* Role access                                                         */
/* ------------------------------------------------------------------ */

/** Per nav item: `'all'` children, or the child keys the role sees. Items not listed are hidden. */
export type NavAccess = 'all' | Record<string, 'all' | string[]>;

const PLANNER_ACCESS: Record<string, 'all' | string[]> = {
  dashboard: 'all',
  command: ['kpis', 'exceptions', 'alerts', 'mywork', 'actions', 'approvals', 'handed-off', 'outcomes', 'prioritise'],
  workbench: 'all',
  analytics: 'all',
};

/**
 * What each role sees in the sidebar. Navigation only: pages stay reachable by URL.
 * Pages may reuse this (via `canSeeNav`) to decide which links to show.
 */
export const NAV_ACCESS: Record<UserRole, NavAccess> = {
  Admin: 'all',
  Executive: 'all',
  Planner: PLANNER_ACCESS,
  Approver: {
    ...PLANNER_ACCESS,
    audit: 'all',
    access: ['requests', 'delegations', 'agents'],
  },
  'Warehouse Manager': {
    dashboard: 'all',
    command: ['exceptions', 'alerts', 'mywork', 'actions', 'signals'],
    workbench: ['received', 'expected'],
  },
  Engineer: {
    dashboard: 'all',
    command: ['mywork', 'actions', 'exceptions', 'alerts'],
    workbench: ['received', 'intelligence'],
  },
  Developer: {
    dashboard: 'all',
    command: ['alerts', 'mywork', 'actions'],
    fabric: 'all',
    mcp: 'all',
    orchestration: 'all',
    audit: 'all',
    access: ['agents'],
  },
  Finance: {
    dashboard: 'all',
    command: ['kpis', 'alerts', 'mywork', 'outcomes'],
    analytics: 'all',
  },
};

/** True when `role` sees the nav item (and, if given, the child) in the sidebar. */
export function canSeeNav(role: UserRole, itemId: string, childKey?: string): boolean {
  const access = NAV_ACCESS[role] ?? 'all';
  if (access === 'all') return true;
  const item = access[itemId];
  if (!item) return false;
  if (!childKey || item === 'all') return true;
  return item.includes(childKey);
}

/** The sidebar tree filtered to what `role` may see; empty sections are dropped. */
export function navForRole(role: UserRole): NavSection[] {
  return NAV_SECTIONS.map((section) => ({
    ...section,
    items: section.items
      .filter((item) => canSeeNav(role, item.id))
      .map((item) =>
        item.children ? { ...item, children: item.children.filter((c) => canSeeNav(role, item.id, c.key)) } : item,
      )
      .filter((item) => !item.children || item.children.length > 0),
  })).filter((section) => section.items.length > 0);
}

/* ------------------------------------------------------------------ */
/* Route matching                                                      */
/* ------------------------------------------------------------------ */

export interface NavMatch {
  item: NavItem;
  child?: NavChild;
}

const covers = (pathname: string, path: string) =>
  path === '/' ? pathname === '/' : pathname === path || pathname.startsWith(path + '/');

/**
 * The one sidebar entry a route belongs to (longest matching path wins), searched over the
 * full tree so breadcrumbs work for every role.
 */
export function matchNav(pathname: string): NavMatch | null {
  let best: NavMatch | null = null;
  let bestLen = -1;
  const consider = (path: string, match: NavMatch) => {
    if (covers(pathname, path) && path.length > bestLen) {
      best = match;
      bestLen = path.length;
    }
  };
  for (const section of NAV_SECTIONS) {
    for (const item of section.items) {
      if (item.children) {
        for (const child of item.children) {
          for (const p of [child.path, ...(child.aliases ?? [])]) consider(p, { item, child });
        }
        for (const p of item.aliases ?? []) consider(p, { item, child: item.children[0] });
      } else {
        for (const p of [item.path, ...(item.aliases ?? [])]) consider(p, { item });
      }
    }
  }
  return best;
}

/** Breadcrumb for a route: sidebar section name / sidebar item name. */
export function breadcrumbFor(pathname: string): { primary: string; secondary: string } {
  const m = matchNav(pathname);
  if (!m) return { primary: 'Circularity', secondary: 'Overview' };
  return { primary: m.item.label, secondary: m.child?.label ?? m.item.pageLabel ?? m.item.label };
}
