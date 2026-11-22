'use client';

/**
 * Demo session: the signed-in role, tenant and site. Authentication itself is out
 * of scope for the prototype; switching role re-scopes navigation and data.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { UserRole } from '@/models/user.model';
import type { UserRecord } from '@/models/domain.model';
import { USER_ROLES } from '@/constants/roles.constants';
import { userService } from '@/services/userService';
import { tenantAccessService, type TenantAccess } from '@/services/tenantAccessService';

interface AuthContextType {
  currentRole: UserRole;
  setRole: (role: UserRole) => void;
  /**
   * Tenant filter. Always one the user may see (tenantAccessService): when the stored tenant is
   * no longer allowed (role switch, grant expired) it falls back to the home tenant.
   */
  currentTenant: string;
  setTenant: (tenant: string) => void;
  /** Site the user works at (Warehouse Managers are scoped to it). */
  currentSite: string;
  setSite: (site: string) => void;
  user: UserRecord;
  /** Data scope to pass to services. */
  scope: { tenant?: string; site?: string };
  canSwitchTenant: boolean;
  /** Tenants this user may select, their home tenant and active grants. */
  tenantAccess: TenantAccess;
  isApprover: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const STORAGE_KEY = 'circ-session';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentRole, setRoleState] = useState<UserRole>('Planner');
  const [storedTenant, setTenant] = useState<string>('Customer A');
  const [currentSite, setSite] = useState<string>('Warehouse 1');
  // The person behind the role (their account carries the home tenant and any grants). Kept
  // separate from the tenant so selecting a granted tenant does not change who is signed in.
  const [userId, setUserId] = useState<string | null>(null);
  const requestsVersion = useSyncExternalStore(tenantAccessService.subscribe, tenantAccessService.version, tenantAccessService.version);
  // Persist only after the saved session has been read; otherwise the first persist (with the
  // defaults) overwrites storage before a Strict Mode re-run of the restore effect reads it.
  const [restored, setRestored] = useState(false);

  // Restore the demo session after hydration. localStorage is client-only, so reading it
  // in a lazy initialiser would make the server and client render different roles.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- one-time restore from browser storage */
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const s = JSON.parse(raw) as { role?: UserRole; tenant?: string; site?: string; userId?: string };
        if (s.role && USER_ROLES[s.role]) {
          setRoleState(s.role);
          // Sessions saved before userId existed: the tenant picks the role's account (e.g. Planner · Customer B).
          const saved = s.userId ? userService.get(s.userId) : undefined;
          const u = saved?.role === s.role ? saved : userService.forRole(s.role, s.tenant);
          if (u) setUserId(u.id);
        }
        if (s.tenant) setTenant(s.tenant);
        if (s.site) setSite(s.site);
      }
    } catch {
      /* storage unavailable: keep defaults */
    }
    setRestored(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // The role's account: the one picked at sign-in / role switch, else the role's first account.
  const roleUser = useMemo(() => {
    const picked = userId ? userService.get(userId) : undefined;
    return (picked?.role === currentRole ? picked : userService.forRole(currentRole, storedTenant)) ?? userService.all()[0];
  }, [userId, currentRole, storedTenant]);
  // Derived on every render (not stored), so a grant approved or expired elsewhere applies at once.
  const tenantAccess = useMemo(
    () => tenantAccessService.access(currentRole, roleUser, currentSite),
    // requestsVersion: recompute when access requests are raised or decided.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentRole, roleUser, currentSite, requestsVersion],
  );
  const currentTenant = tenantAccessService.isAllowed(tenantAccess, storedTenant) ? storedTenant : tenantAccess.home;

  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ role: currentRole, tenant: currentTenant, site: currentSite, userId: roleUser.id }));
    } catch {
      /* ignore */
    }
  }, [restored, currentRole, currentTenant, currentSite, roleUser.id]);

  const setRole = useCallback((role: UserRole) => {
    setRoleState(role);
    const u = userService.forRole(role);
    if (u) {
      setUserId(u.id);
      setTenant(tenantAccessService.access(role, u, u.site).home);
      setSite(u.site);
    }
  }, []);

  const value = useMemo<AuthContextType>(() => {
    // The demo account is always Santa (the admin); the role switcher only changes what Santa sees.
    // id/role/tenant still come from the role's record so tasks and scope stay role-based.
    const user: UserRecord = { ...roleUser, name: SESSION_USER.name };
    const scope: AuthContextType['scope'] = {
      tenant: currentTenant === 'All' ? undefined : currentTenant,
      site: USER_ROLES[currentRole]?.warehouseScoped ? currentSite : undefined,
    };
    return {
      currentRole,
      setRole,
      currentTenant,
      setTenant,
      currentSite,
      setSite,
      user,
      scope,
      canSwitchTenant: tenantAccess.allowed.length > 1 || tenantAccess.tenants.length > tenantAccess.allowed.length,
      tenantAccess,
      isApprover: currentRole === 'Approver' || currentRole === 'Admin',
      isAdmin: currentRole === 'Admin',
    };
  }, [currentRole, currentTenant, currentSite, setRole, roleUser, tenantAccess]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** The signed-in demo account, shown in the header, sidebar, greeting and audit entries. */
export const SESSION_USER = { name: 'Santa', initials: 'SN' } as const;

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
