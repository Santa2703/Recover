/**
 * Tenant scoping for the header tenant selector.
 *
 * - Admin, Executive, Approver, Finance and Developer see every customer tenant.
 * - Planner and Engineer see their home tenant (the tenant on their account) plus tenants
 *   granted to them by an approved access request that has not expired.
 * - Warehouse Managers are site-scoped and see the tenants with returned assets at their site.
 *
 * Ungranted tenants can be requested (governanceService.requestTenantAccess); the request joins
 * the Tenant access queue on /access/requests and, once approved, unlocks the tenant here.
 */
import type { UserRecord } from '@/models/domain.model';
import type { UserRole } from '@/models/user.model';
import { caseStore, meta } from './mock/stores';
import { governanceService, type AccessRequest, type Actor, type TenantGrantDuration } from './governanceService';

export const ALL_TENANT_ROLES: ReadonlySet<UserRole> = new Set<UserRole>(['Admin', 'Executive', 'Approver', 'Finance', 'Developer']);

export interface TenantAccess {
  /** Every customer tenant in the dataset (menu order). */
  tenants: string[];
  /** Tenants this user may select. */
  allowed: string[];
  /** True when the user may pick "All customer tenants". */
  canSeeAll: boolean;
  /** Tenant to fall back to when the current one is no longer allowed. */
  home: string;
  /** Tenants granted by an approved request (not part of the home scope), with their expiry. */
  grants: { tenant: string; requestId: string; expiresAt: string | null }[];
}

/** Tenants that have returned assets at a site (Warehouse Manager scope). */
function tenantsAtSite(site: string): string[] {
  const at = new Set(caseStore.all().filter((c) => c.location === site).map((c) => c.tenant));
  return meta.tenants.filter((t) => at.has(t));
}

export const tenantAccessService = {
  /** Re-render when requests are raised or decided. */
  subscribe: governanceService.subscribeRequests,
  version: governanceService.requestsVersion,

  /** Which tenants `user` (acting as `role`, working at `site`) may select now. */
  access(role: UserRole, user: Pick<UserRecord, 'id' | 'tenant'>, site: string): TenantAccess {
    const tenants = meta.tenants;
    if (ALL_TENANT_ROLES.has(role)) return { tenants, allowed: tenants, canSeeAll: true, home: 'All', grants: [] };
    const base = role === 'Warehouse Manager' ? tenantsAtSite(site) : user.tenant === 'All' ? tenants : [user.tenant];
    const grants = governanceService
      .activeTenantGrants(user.id, Date.now())
      .filter((g) => !base.includes(g.target))
      .map((g) => ({ tenant: g.target, requestId: g.id, expiresAt: g.expiresAt ?? null }));
    const allowedSet = new Set([...base, ...grants.map((g) => g.tenant)]);
    const allowed = tenants.filter((t) => allowedSet.has(t));
    const canSeeAll = allowed.length === tenants.length;
    const home = role === 'Warehouse Manager' && canSeeAll ? 'All' : (base[0] ?? allowed[0] ?? tenants[0]);
    return { tenants, allowed, canSeeAll, home, grants };
  },

  /** True when `tenant` ('All' or a tenant name) is selectable under `access`. */
  isAllowed(access: TenantAccess, tenant: string): boolean {
    return tenant === 'All' ? access.canSeeAll : access.allowed.includes(tenant);
  },

  /** The user's own tenant requests, newest first. */
  myRequests(userId: string): AccessRequest[] {
    return governanceService.tenantRequestsFor(userId);
  },

  request(input: { tenant: string; reason: string; duration: TenantGrantDuration; site?: string }, actor: Actor): Promise<AccessRequest> {
    return governanceService.requestTenantAccess(input, actor);
  },
};
