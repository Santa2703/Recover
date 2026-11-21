/**
 * Domain types for the mock-data layer (src/data/*.json).
 * Services return these shapes; swapping mocks for a real API should not change them.
 */
import type { DispositionRouteId } from './treatment.model';
import type { UserRole } from './user.model';
import type { RouteProposal } from './decision.model';

export type CaseStageId =
  | 'awaiting_inspection'
  | 'needs_information'
  | 'awaiting_approval'
  | 'approved'
  | 'handed_off'
  | 'reevaluate'
  | 'no_viable_route';

export type RiskReasonId =
  | 'missing_evidence'
  | 'condition_deterioration'
  | 'delayed_approval'
  | 'market_price_decline'
  | 'capacity_constraint'
  | 'no_viable_route';

export type Priority = 'low' | 'medium' | 'high';
export type Severity = 'low' | 'medium' | 'high';

export interface CaseRecord {
  id: string;
  assetTag: string;
  serialNumber: string;
  productClass: 'motor' | 'pump' | 'control' | 'drill' | 'batch' | 'it';
  productName: string;
  category: string;
  manufacturer: string;
  model: string;
  quantity: number;
  location: string;
  tenant: string;
  owner: string;
  ownerId: string;
  receivedDate: string;
  dueDate: string;
  dueInDays: number;
  condition: 'A' | 'B' | 'C' | 'D' | 'Scrap';
  residualLifeMonths: number;
  stage: CaseStageId;
  recommendedRoute: DispositionRouteId;
  estimatedNetRecovery: number;
  predictedResale: number;
  refurbishmentCost: number;
  valueAtRisk: number;
  riskReason: RiskReasonId | null;
  carbonAvoidedKg: number;
  priority: Priority;
  evidenceCompleteness: number;
  blockedReason: string | null;
  exceptionId?: string;
  /** Set when an approver approves or declines with a note. */
  decisionNote?: string;
  /**
   * Named demand records (LO-, SO-, BID-, RR-, RO-) the decision uses. Set by the decision
   * engine for open cases and frozen when the case is approved, so the queue plan does not
   * give the same demand to another case.
   */
  demandIds?: string[];
  /**
   * Route sent for approval by a Planner / Engineer / Warehouse Manager (decisionService.proposeRoute).
   * Present on open cases while the proposal stands; kept on the record when the case is approved.
   */
  proposal?: RouteProposal;
  facts: {
    originalPrice: number;
    ageYears: number;
    lastServiceDate: string;
    warrantyStatus: 'active' | 'expired';
    wmsBinLocation: string;
  };
  predictions: {
    secondaryMarketPrice: number;
    refurbishmentCost: number;
    resaleDemandScore: number;
    failureRiskScore: number;
  };
}

export type ExceptionType = RiskReasonId | 'integration_failure' | 'data_quality';
export type ExceptionStatus = 'open' | 'notified' | 'assigned' | 'resolved';

export interface ExceptionRecord {
  id: string;
  type: ExceptionType;
  title: string;
  warehouse: string;
  caseIds: string[];
  itemsCount: number;
  topCaseId: string;
  valueAtRisk: number;
  severity: Severity;
  status: ExceptionStatus;
  ownerId: string;
  openedAt: string;
  lastNotifiedAt: string | null;
  resolvedAt?: string | null;
  resolutionNote?: string;
}

export type TaskType = 'request_evidence' | 'inspect' | 'approve' | 'prepare_decision' | 'confirm_outcome' | 'acknowledge';
export type TaskStatus = 'todo' | 'in_progress' | 'waiting' | 'done';

export interface TaskRecord {
  id: string;
  type: TaskType;
  title: string;
  caseId: string;
  assigneeId: string;
  role: UserRole;
  dueDate: string;
  priority: Priority;
  status: TaskStatus;
}

export interface AlertRecord {
  id: string;
  severity: 'danger' | 'warning' | 'info';
  title: string;
  body: string;
  source: string;
  link: string;
  createdAt: string;
  read: boolean;
  roles: UserRole[];
}

export interface UserRecord {
  id: string;
  name: string;
  role: UserRole;
  tenant: string;
  site: string;
  email: string;
}

export interface MonthlyHistory {
  month: string;
  predictedRecovery: number;
  actualRecovery: number;
  recoveryYield: number;
  decisionsClosed: number;
  avoidedSpend: number;
  co2AvoidedT: number;
  cycleTimeDays: number;
  routeMix: Record<DispositionRouteId, number>;
}

export interface CapacityRecord {
  id: string;
  label: string;
  site: string;
  used: number;
  capacity: number;
  unit: string;
}

export interface AppMeta {
  asOf: string;
  organisation: string;
  environment: string;
  tenants: string[];
  sites: string[];
  routes: { id: DispositionRouteId; name: string; description: string }[];
  stages: { id: CaseStageId; label: string }[];
  riskReasons: { id: RiskReasonId; label: string }[];
  journey: { id: number; label: string; phase: string }[];
}

/** Paged list result returned by every list service. */
export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
