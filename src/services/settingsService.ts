/**
 * Platform & governance settings (tenant profile, sites, workflow rules, notifications,
 * data policies, integration quotas). JSON-backed, editable in memory while the user navigates.
 */
import settingsJson from '@/data/settings.json';
import { createCollection, delay } from './mock/mockUtils';

export interface SiteRecord {
  id: string;
  name: string;
  location: string;
  capacityPct: number;
  baysCount: number;
  manager: string;
  status: string;
}

export interface TenantProfile {
  name: string;
  uid: string;
  currency: string;
  timezone: string;
}
/** Approval value thresholds are not here: they live in governanceService.getApprovalThresholds() (edited on /access/delegations). */
export interface WorkflowRules {
  /** Role that pending approvals escalate to (must be an existing role). */
  escalateToRole: string;
  requireEngineeringSignoff: boolean;
  escalateAfterHours: number;
  strictCarbonTracking: boolean;
}
export interface NotificationSettings {
  emailAlerts: boolean;
  slackAlerts: boolean;
  slackWebhookUrl: string;
}
export interface DataPolicies {
  description: string;
  auditRetention: string;
  payloadPurge: string;
}
export interface IntegrationLimit {
  id: string;
  name: string;
  limit: string;
}
export interface SettingsOptions {
  currencies: { value: string; label: string }[];
  timezones: { value: string; label: string }[];
  auditRetention: string[];
  payloadPurge: string[];
}
export interface SettingsSnapshot {
  tenant: TenantProfile;
  workflow: WorkflowRules;
  notifications: NotificationSettings;
  policies: DataPolicies;
  integrations: IntegrationLimit[];
  sites: SiteRecord[];
  options: SettingsOptions;
}

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));

const siteStore = createCollection<SiteRecord>(settingsJson.sites as SiteRecord[]);
let tenant: TenantProfile = clone(settingsJson.tenant);
let workflow: WorkflowRules = clone(settingsJson.workflow);
let notifications: NotificationSettings = clone(settingsJson.notifications);
let policies: DataPolicies = clone(settingsJson.policies);
const integrations: IntegrationLimit[] = clone(settingsJson.integrations);
const options: SettingsOptions = clone(settingsJson.options);

const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
siteStore.subscribe(emit);

export const settingsService = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },

  async get(): Promise<SettingsSnapshot> {
    await delay();
    return clone({ tenant, workflow, notifications, policies, integrations, sites: siteStore.all(), options });
  },

  async updateTenant(patch: Partial<Pick<TenantProfile, 'name' | 'currency' | 'timezone'>>): Promise<TenantProfile> {
    await delay(200);
    tenant = { ...tenant, ...patch };
    emit();
    return tenant;
  },

  async updateWorkflow(patch: Partial<WorkflowRules>): Promise<WorkflowRules> {
    await delay(200);
    workflow = { ...workflow, ...patch };
    emit();
    return workflow;
  },

  async updateNotifications(patch: Partial<NotificationSettings>): Promise<NotificationSettings> {
    await delay(200);
    notifications = { ...notifications, ...patch };
    emit();
    return notifications;
  },

  async updatePolicies(patch: Partial<Pick<DataPolicies, 'auditRetention' | 'payloadPurge'>>): Promise<DataPolicies> {
    await delay(200);
    policies = { ...policies, ...patch };
    emit();
    return policies;
  },

  async saveSite(site: Omit<SiteRecord, 'id'> & { id?: string }): Promise<SiteRecord> {
    await delay(250);
    const status = site.capacityPct > 85 ? 'Warning - High Load' : 'Active';
    if (site.id && siteStore.get(site.id)) return siteStore.update(site.id, { ...site, status } as Partial<SiteRecord>);
    const n = siteStore.all().length + 1;
    const id = site.id?.trim() || `WH-${String(n).padStart(2, '0')}`;
    if (siteStore.get(id)) throw new Error(`Facility code ${id} is already used`);
    return siteStore.insert({ ...site, id, status });
  },

  async removeSite(id: string): Promise<void> {
    await delay(200);
    siteStore.remove(id);
  },

  /** Restores the shipped defaults. */
  async reset(): Promise<void> {
    await delay(250);
    tenant = clone(settingsJson.tenant);
    workflow = clone(settingsJson.workflow);
    notifications = clone(settingsJson.notifications);
    policies = clone(settingsJson.policies);
    for (const s of siteStore.all()) if (!settingsJson.sites.some((x) => x.id === s.id)) siteStore.remove(s.id);
    for (const s of settingsJson.sites as SiteRecord[]) {
      if (siteStore.get(s.id)) siteStore.update(s.id, s);
      else siteStore.insert(s);
    }
    emit();
  },
};
