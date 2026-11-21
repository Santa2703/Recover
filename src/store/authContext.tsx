'use client';

/**
 * Demo session: the signed-in role, tenant and site. Authentication itself is out
 * of scope for the prototype; switching role re-scopes navigation and data.
 */
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { UserRole } from '@/models/user.model';
import type { UserRecord } from '@/models/domain.model';
import { USER_ROLES } from '@/constants/roles.constants';
import { userService } from '@/services/userService';

interface AuthContextType {
  currentRole: UserRole;
  setRole: (role: UserRole) => void;
  /** Tenant filter. Planners are locked to their own tenant. */
  currentTenant: string;
  setTenant: (tenant: string) => void;
  /** Site the user works at (Warehouse Managers are scoped to it). */
  currentSite: string;
  setSite: (site: string) => void;
  user: UserRecord;
  /** Data scope to pass to services. */
  scope: { tenant?: string; site?: string };
  canSwitchTenant: boolean;
  isApprover: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);
const STORAGE_KEY = 'circ-session';

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [currentRole, setRoleState] = useState<UserRole>('Planner');
  const [currentTenant, setTenant] = useState<string>('Customer A');
  const [currentSite, setSite] = useState<string>('Warehouse 1');
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
        const s = JSON.parse(raw) as { role?: UserRole; tenant?: string; site?: string };
        if (s.role && USER_ROLES[s.role]) setRoleState(s.role);
        if (s.tenant) setTenant(s.tenant);
        if (s.site) setSite(s.site);
      }
    } catch {
      /* storage unavailable: keep defaults */
    }
    setRestored(true);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  useEffect(() => {
    if (!restored) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ role: currentRole, tenant: currentTenant, site: currentSite }));
    } catch {
      /* ignore */
    }
  }, [restored, currentRole, currentTenant, currentSite]);

  const setRole = useCallback((role: UserRole) => {
    setRoleState(role);
    const u = userService.forRole(role);
    if (u) {
      setTenant(role === 'Planner' ? u.tenant : 'All');
      setSite(u.site);
    }
  }, []);

  const value = useMemo<AuthContextType>(() => {
    // The demo account is always Santa (the admin); the role switcher only changes what Santa sees.
    // id/role/tenant still come from the role's record so tasks and scope stay role-based.
    const roleUser = userService.forRole(currentRole, currentTenant) ?? userService.all()[0];
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
      canSwitchTenant: currentRole !== 'Planner',
      isApprover: currentRole === 'Approver' || currentRole === 'Admin',
      isAdmin: currentRole === 'Admin',
    };
  }, [currentRole, currentTenant, currentSite, setRole]);

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
