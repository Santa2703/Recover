export type DispositionRouteId =
  | 'redeploy'
  | 'resale'
  | 'intparts'
  | 'relase'
  | 'material'
  | 'extparts'
  | 'exit';

export interface TreatmentRoute {
  id: DispositionRouteId;
  name: string;
  shortLabel: string;
  color: string;
  description: string;
  expectedNetRecovery: number;
  carbonAvoidedKg: number;
  confidenceScore: number;
  leadTimeDays: number;
  isEligible: boolean;
  ineligibilityReason?: string;
  gateNotes?: string[];
}

export interface GateCheck {
  id: string;
  label: string;
  passed: boolean;
  notes: string;
  requiredRole?: string;
}

export interface TreatmentDecision {
  caseId: string;
  selectedRoute: DispositionRouteId;
  recommendedRoute: DispositionRouteId;
  confidenceScore: number;
  gates: GateCheck[];
  netValueEstimate: number;
  overrideReason?: string;
  status: 'pending_evaluation' | 'awaiting_approval' | 'approved' | 'handed_off';
}
