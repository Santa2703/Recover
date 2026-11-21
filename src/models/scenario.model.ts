import { DispositionRouteId } from './treatment.model';

export interface ScenarioVariables {
  purchaseMultiplier: number;
  refurbCostMultiplier: number;
  serviceLifeMultiplier: number;
  marketDemandFactor: number;
  demandOverride: boolean;
}

export interface ScenarioCalculationResult {
  route: DispositionRouteId;
  baselineNetRecovery: number;
  simulatedNetRecovery: number;
  variancePercent: number;
  npvDelta: number;
  isRecommendedUnderScenario: boolean;
}
