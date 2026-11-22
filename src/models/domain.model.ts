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
  | 'ready_for_decision'
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
  /** Inspection result recorded by the Engineer (caseLifecycleService.recordInspection). */
  inspection?: InspectionResult;
  /**
   * How many times the case was re-decided on new evidence (inspection recorded, re-evaluated).
   * Part of the evidence snapshot id, so each re-evaluation gets a new snapshot.
   */
  evaluationRound?: number;
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

/** Inspection and grading result (Engineer, "Record inspection result" on the Case page). */
export interface InspectionResult {
  grade: 'A' | 'B' | 'C' | 'D';
  test: 'pass' | 'fail' | 'conditional';
  /** Remaining-life estimate, % of design life. */
  lifePct: number;
  notes: string;
  photosReceived: boolean;
  by: string;
  /** ISO time. */
  at: string;
}

export type TaskType = 'request_evidence' | 'inspect' | 'approve' | 'prepare_decision' | 'confirm_outcome' | 'acknowledge' | 'escalation';
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
  /** Where the task is worked (defaults to the case page). Escalations about a source link to its drawer. */
  href?: string;
  hrefLabel?: string;
  /** What the task is about when it is not a case (e.g. a source name). */
  subject?: string;
  /** Message from whoever created the task (escalation text). Plain text. */
  note?: string;
  createdBy?: string;
  createdAt?: string;
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
