import type { UserRole } from '@/models/user.model';

/**
 * Which dashboard shortcuts each role sees. The app has no central route-permission
 * map yet, so this mirrors the role descriptions in constants/roles.constants.ts.
 */
export type ModuleId = 'operations' | 'intelligence' | 'integrations' | 'governance';

const ALL: ModuleId[] = ['operations', 'intelligence', 'integrations', 'governance'];

export const ROLE_MODULES: Record<UserRole, ModuleId[]> = {
  Admin: ALL,
  Planner: ['operations', 'intelligence', 'governance'],
  Approver: ['operations', 'intelligence', 'governance'],
  Engineer: ['operations', 'intelligence', 'governance'],
  Finance: ['operations', 'intelligence'],
  Developer: ['operations', 'integrations', 'governance'],
  Executive: ['operations', 'intelligence'],
  'Warehouse Manager': ['operations', 'intelligence'],
};

export const canOpen = (role: UserRole, module: ModuleId) => (ROLE_MODULES[role] ?? ALL).includes(module);
