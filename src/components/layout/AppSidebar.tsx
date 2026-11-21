'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Layout, Popover, Tooltip } from 'antd';
// Consistent icons from Lucide
import {
  LayoutGrid,
  Monitor,
  Layers,
  BarChart2,
  Network,
  Box,
  GitFork,
  FileCheck,
  Lock,
  Settings as SettingsIcon,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useAuth, SESSION_USER } from '@/store/authContext';
import { useMediaQuery, BREAKPOINTS } from '@/hooks/useMediaQuery';
import { useServiceQuery } from '@/hooks/useServiceQuery';
import { commandService, subscribeNav } from '@/services/commandService';
import { sourceService } from '@/services/sourceService';
import {
  matchNav,
  navForRole,
  NAV_BADGE_COLOR,
  type NavBadgeKey,
  type NavItem,
} from '@/constants/navigation.constants';

const { Sider } = Layout;

const ICONS: Record<string, React.ReactNode> = {
  LayoutGrid: <LayoutGrid size={18} />,
  Monitor: <Monitor size={18} />,
  Layers: <Layers size={18} />,
  BarChart2: <BarChart2 size={18} />,
  Network: <Network size={18} />,
  Box: <Box size={18} />,
  GitFork: <GitFork size={18} />,
  FileCheck: <FileCheck size={18} />,
  Lock: <Lock size={18} />,
  Settings: <SettingsIcon size={18} />,
};

const RED = '#DC2626';

interface Badge {
  label: string;
  count: number;
  color: string;
}

/** Pill badge (same style for top-level and sub items). */
function CountPill({ count, color }: { count: number; color: string }) {
  return (
    <span
      style={{ backgroundColor: color, color: color === RED ? '#FFFFFF' : '#000000' }}
      className="inline-flex items-center justify-center px-1.5 h-4.5 min-w-4.5 rounded-full text-[10px] font-extrabold shadow-sm"
    >
      {count}
    </span>
  );
}

interface AppSidebarProps {
  /** 'rail' = docked sidebar (auto icon-rail below 1280px); 'drawer' = slide-out menu on tablets/phones. */
  variant?: 'rail' | 'drawer';
}

export function AppSidebar({ variant = 'rail' }: AppSidebarProps = {}) {
  const pathname = usePathname() || '/dashboard';
  const { currentRole, currentTenant, scope, user } = useAuth();

  // Live badge counts: the same numbers the Command Center pages and Source Map show.
  const { data: counts } = useServiceQuery(
    () => commandService.navCounts(currentRole, currentTenant, scope),
    [currentRole, currentTenant, scope.tenant, scope.site],
    { subscribe: subscribeNav },
  );
  const { data: sources } = useServiceQuery(() => sourceService.summary(), [], { subscribe: sourceService.subscribe });
  const countOf = (key: NavBadgeKey | undefined): number => {
    if (!key) return 0;
    if (key === 'sources') return sources?.attention ?? 0;
    return counts?.[key] ?? 0;
  };

  // Docked sidebar collapses to icons on laptops (< 1280px) so content never needs to scroll sideways.
  // The user can still toggle it; their choice resets when the screen crosses the breakpoint.
  const isWide = useMediaQuery(BREAKPOINTS.wide);
  const [userCollapsed, setCollapsed] = useState<boolean | null>(null);
  const [prevWide, setPrevWide] = useState(isWide);
  if (prevWide !== isWide) {
    setPrevWide(isWide);
    setCollapsed(null);
  }
  const collapsed = variant === 'drawer' ? false : userCollapsed ?? !isWide;

  // The one sidebar entry this route belongs to: drives highlighting (one item only) and the open subtree.
  const match = matchNav(pathname);
  const routeGroup = match?.item.children ? match.item.id : null;

  // Single expanded subtree (opening one closes another). Routes without a subtree (Dashboard, Settings) open nothing.
  const [openSubtreeId, setOpenSubtreeId] = useState<string | null>(routeGroup);
  // Sync expanded state when the route changes (adjusted during render, not in an effect).
  const [prevPath, setPrevPath] = useState(pathname);
  if (prevPath !== pathname) {
    setPrevPath(pathname);
    setOpenSubtreeId(routeGroup);
  }

  const sections = navForRole(currentRole);

  /** Badges an item carries: its own, or those of its visible children. */
  const badgesOf = (item: NavItem): Badge[] => {
    const out: Badge[] = [];
    const own = countOf(item.badgeKey);
    if (item.badgeKey && own) out.push({ label: item.label, count: own, color: NAV_BADGE_COLOR[item.badgeKey] });
    for (const c of item.children ?? []) {
      const n = countOf(c.badgeKey);
      if (c.badgeKey && n) out.push({ label: c.label, count: n, color: NAV_BADGE_COLOR[c.badgeKey] });
    }
    return out;
  };

  return (
    <Sider
      collapsible
      collapsed={collapsed}
      onCollapse={setCollapsed}
      trigger={null}
      width={variant === 'drawer' ? '100%' : 240}
      collapsedWidth={68}
      style={{
        backgroundColor: '#0C0D0E',
        borderRight: variant === 'drawer' ? 'none' : '1px solid rgba(255, 255, 255, 0.08)',
        height: '100vh',
        flexShrink: 0,
      }}
      className="flex flex-col select-none text-white font-sans overflow-hidden"
    >
      {/* 1. Brand Header */}
      <div
        className={`h-16 shrink-0 flex items-center ${collapsed ? 'flex-col justify-center gap-1 px-2 pt-2 pb-1' : 'justify-between px-3.5 pt-3 pb-2'
          }`}
      >
        <Link href="/dashboard" className="flex items-center gap-2.5 overflow-hidden group min-w-0">
          {/* Circular Yellow Spiral Icon */}
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0">
            <svg
              width="26"
              height="26"
              viewBox="0 0 32 32"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className="transition-transform group-hover:rotate-12 duration-200"
            >
              <circle cx="16" cy="16" r="14" stroke="#FFD600" strokeWidth="2.5" strokeLinecap="round" strokeDasharray="60 20" />
              <circle cx="16" cy="16" r="9" stroke="#FFD600" strokeWidth="2.2" strokeLinecap="round" strokeDasharray="35 15" />
              <circle cx="16" cy="16" r="4" fill="#FFD600" />
            </svg>
          </div>
          {!collapsed && (
            <span
              style={{ color: '#FFFFFF' }}
              className="font-bold text-[17px] tracking-tight font-sans leading-none truncate"
            >
              Circularity
            </span>
          )}
        </Link>

        {/* Top Collapse Button (not shown in the slide-out drawer) */}
        {variant === 'rail' && <button
          onClick={() => setCollapsed(!collapsed)}
          className="w-7 h-7 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-white/70 hover:text-white flex items-center justify-center transition-colors duration-150 shrink-0 cursor-pointer"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <ChevronRight size={16} />
          ) : (
            <ChevronLeft size={16} />
          )}
        </button>}
      </div>

      {/* 2. Navigation Sections with Independent Scrolling (Scrollbar hidden) */}
      <nav
        aria-label="Main navigation"
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain no-scrollbar px-2.5 py-1 space-y-4"
      >
        {sections.map((section, sIdx) => (
          <div key={section.id} className="space-y-1">
            {/* Section Title */}
            {!collapsed && section.title && (
              <div className="px-3 pt-2 pb-1 text-[11px] font-bold text-[#94A3B8] tracking-[1.2px] uppercase">
                {section.title}
              </div>
            )}
            {collapsed && sIdx > 0 && <div className="my-2 border-t border-white/[0.08]" />}

            {/* Section Items */}
            {section.items.map((item) => {
              const active = match?.item.id === item.id;
              const children = item.children ?? [];
              const hasSubmenu = children.length > 0;
              const isExpanded = hasSubmenu && openSubtreeId === item.id;
              const badges = badgesOf(item);
              // Expanded sidebar: an item's own badge always shows; child badges show on their
              // sub-items, and on the parent only while its subtree is closed.
              const pill = item.badgeKey
                ? badges.find((b) => b.label === item.label)
                : !isExpanded
                  ? badges[0]
                  : undefined;
              // Collapsed rail: a dot plus "<label> · <count>" tooltip for every badge.
              const dotColor = badges.some((b) => b.color === RED) ? RED : badges[0]?.color;
              const railTip = badges.length
                ? badges.map((b) => `${b.label} · ${b.count}`).join('\n')
                : item.label;
              const railTitle =
                badges.length && !(badges.length === 1 && badges[0].label === item.label) ? `${item.label}\n${railTip}` : railTip;

              return (
                <div key={item.id} className="space-y-1">
                  {(() => {
                    const rowStyle = {
                      backgroundColor: active ? '#FFD600' : 'transparent',
                      color: active ? '#000000' : 'rgba(255, 255, 255, 0.85)',
                    };
                    const rowClass = `w-full text-left cursor-pointer flex items-center gap-3 px-3 py-2 rounded-xl text-[13px] transition-all duration-150 ${active
                      ? 'font-bold shadow-sm'
                      : 'font-medium hover:!text-white hover:bg-white/[0.07]'
                      }`;
                    const inner = (
                    <>
                      {/* Icon (+ badge dot on the collapsed rail) */}
                      <span
                        className="relative shrink-0 flex items-center justify-center"
                        style={{
                          color: active ? '#000000' : 'rgba(255, 255, 255, 0.85)',
                        }}
                      >
                        {ICONS[item.iconName]}
                        {collapsed && dotColor && (
                          <span
                            aria-hidden
                            style={{ backgroundColor: dotColor, boxShadow: `0 0 0 2px ${active ? '#FFD600' : '#0C0D0E'}` }}
                            className="absolute -top-1 -right-1 w-2 h-2 rounded-full"
                          />
                        )}
                      </span>

                      {/* Label & Badges & Chevrons */}
                      {!collapsed && (
                        <div className="flex items-center justify-between flex-1 min-w-0">
                          <span
                            style={{
                              color: active ? '#000000' : 'rgba(255, 255, 255, 0.85)',
                            }}
                            className={`truncate ${active ? 'font-bold' : 'font-medium'}`}
                          >
                            {item.label}
                          </span>

                          <div className="flex items-center gap-1.5 shrink-0 ml-1">
                            {/* Pill Badges */}
                            {pill && <CountPill count={pill.count} color={pill.color} />}

                            {/* Chevron Right (rotates 90deg down when expanded) */}
                            {hasSubmenu && (
                              <span
                                className="inline-flex items-center justify-center transition-transform duration-200"
                                style={{
                                  transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
                                  color: active ? '#000000' : 'rgba(255, 255, 255, 0.6)',
                                }}
                              >
                                <ChevronRight size={16} />
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </>
                    );
                    // Items with sub-pages only open/close their list; the user picks the page.
                    if (hasSubmenu && collapsed) {
                      return (
                        <Popover
                          placement="rightTop"
                          trigger={['hover', 'click']}
                          arrow={false}
                          title={item.label}
                          content={
                            <div className="flex flex-col gap-0.5 min-w-44">
                              {children.map((sub) => {
                                const subActive = active && match?.child?.key === sub.key;
                                const n = countOf(sub.badgeKey);
                                return (
                                  <Link
                                    key={sub.key}
                                    href={sub.path}
                                    aria-current={subActive ? 'page' : undefined}
                                    className={`flex items-center justify-between gap-2 px-2 py-1.5 rounded-md text-[13px] text-[#141416] hover:bg-[#F1F5F9] ${subActive ? 'font-semibold bg-[#FFF8CC]' : ''}`}
                                  >
                                    <span className="truncate">{sub.label}</span>
                                    {sub.badgeKey && n > 0 && <CountPill count={n} color={NAV_BADGE_COLOR[sub.badgeKey]} />}
                                  </Link>
                                );
                              })}
                            </div>
                          }
                        >
                          <button type="button" aria-haspopup="menu" aria-label={railTitle.replace(/\n/g, ', ')} style={rowStyle} className={rowClass}>
                            {inner}
                          </button>
                        </Popover>
                      );
                    }
                    if (hasSubmenu) {
                      return (
                        <button
                          type="button"
                          aria-expanded={isExpanded}
                          onClick={() => setOpenSubtreeId((current) => (current === item.id ? null : item.id))}
                          style={rowStyle}
                          className={rowClass}
                        >
                          {inner}
                        </button>
                      );
                    }
                    return (
                      <Tooltip
                        title={collapsed ? <span className="whitespace-pre-line">{railTitle}</span> : ''}
                        placement="right"
                      >
                        <Link
                          href={item.path}
                          aria-label={collapsed ? railTitle.replace(/\n/g, ', ') : undefined}
                          aria-current={active ? 'page' : undefined}
                          style={rowStyle}
                          className={rowClass}
                        >
                          {inner}
                        </Link>
                      </Tooltip>
                    );
                  })()}

                  {/* Generic Nested Sub-tree */}
                  {hasSubmenu && !collapsed && isExpanded && (
                    <div className="relative ml-4.5 pl-2.5 border-l border-white/10 space-y-0.5 pt-0.5 pb-0.5">
                      {children.map((sub) => {
                        const subActive = active && match?.child?.key === sub.key;
                        const n = countOf(sub.badgeKey);

                        return (
                          <Link
                            key={sub.key}
                            href={sub.path}
                            aria-current={subActive ? 'page' : undefined}
                            style={{
                              backgroundColor: subActive ? 'rgba(255, 214, 0, 0.14)' : 'transparent',
                              color: subActive ? '#FFD600' : 'rgba(255, 255, 255, 0.70)',
                              border: subActive ? '1px solid rgba(255, 214, 0, 0.28)' : '1px solid transparent',
                            }}
                            className={`flex items-center justify-between gap-2 px-3 py-1.5 rounded-lg text-[13px] transition-all ${subActive
                              ? 'font-semibold shadow-xs'
                              : 'font-normal hover:text-white hover:bg-white/[0.05]'
                              }`}
                          >
                            <span className="truncate">{sub.label}</span>
                            {sub.badgeKey && n > 0 && <CountPill count={n} color={NAV_BADGE_COLOR[sub.badgeKey]} />}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </nav>

      {/* 3. Footer User Profile */}
      <div
        style={{
          borderTop: '1px solid rgba(255, 255, 255, 0.08)',
          backgroundColor: '#0C0D0E',
        }}
        className="p-3 shrink-0 flex items-center justify-between text-white/70"
      >
        <div className={`flex items-center gap-2.5 min-w-0 ${collapsed ? 'mx-auto' : ''}`}>
          {/* Avatar circle with the signed-in user's initials */}
          <div
            title={user.name}
            className="w-8 h-8 rounded-full bg-[#4B5563] text-white flex items-center justify-center font-bold text-xs shrink-0 select-none shadow-sm"
          >
            {SESSION_USER.initials}
          </div>
          {!collapsed && (
            <div className="flex items-center gap-2 min-w-0 cursor-pointer group">
              <span className="text-[13px] font-semibold text-white/90 group-hover:text-white truncate">
                {user.name}
              </span>
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-white/40 group-hover:text-white/70 transition-colors"
              >
                <polyline points="6 9 12 15 18 9"></polyline>
              </svg>
            </div>
          )}
        </div>
      </div>
    </Sider>
  );
}
