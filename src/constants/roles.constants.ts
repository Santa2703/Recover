import { UserRole } from '@/models/user.model';

export interface RoleConfig {
  role: UserRole;
  label: string;
  desc: string;
  /** Where the role lands after switching to it (RoleSwitcher navigates here). */
  landingPath: string;
  warehouseScoped?: boolean;
}

export const USER_ROLES: Record<UserRole, RoleConfig> = {
  Planner: {
    role: 'Planner',
    label: 'Planner',
    desc: 'Evaluates returned units, compares disposition options, runs scenarios, and prioritises cases.',
    landingPath: '/command/actions',
  },
  Approver: {
    role: 'Approver',
    label: 'Approver',
    desc: 'Approves or declines high-value decisions, policy overrides, MCP servers, and tenant access.',
    landingPath: '/command/actions?tab=approvals',
  },
  Engineer: {
    role: 'Engineer',
    label: 'Engineer',
    desc: 'Inspects assets, records assessments and test results, and owns technical eligibility.',
    landingPath: '/command/actions',
  },
  Finance: {
    role: 'Finance',
    label: 'Finance',
    desc: 'Confirms outcomes, tracks value recovery, avoided spend, and margin variance.',
    landingPath: '/analytics',
  },
  Developer: {
    role: 'Developer',
    label: 'Developer',
    desc: 'Connects data sources, builds workflow pipelines, and governs MCP agent tools.',
    landingPath: '/integration/map',
  },
  Executive: {
    role: 'Executive',
    label: 'Executive',
    desc: 'Strategic overview: value realised, portfolio health, ESG metrics, and ranked exceptions.',
    landingPath: '/dashboard',
  },
  'Warehouse Manager': {
    role: 'Warehouse Manager',
    label: 'Warehouse Manager',
    desc: 'Runs warehouse intake: local inventory, inbound capacity, and items awaiting handoff.',
    landingPath: '/product/expected',
    warehouseScoped: true,
  },
  Admin: {
    role: 'Admin',
    label: 'Admin',
    desc: 'Full administrative access across all modules, tenants, accounts, and delegations.',
    landingPath: '/dashboard',
  },
};
