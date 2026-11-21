import { ScenarioVariables, ScenarioCalculationResult } from '@/models/scenario.model';
import { ReturnCase } from '@/models/case.model';
import { DispositionRouteId } from '@/models/treatment.model';

export class ScenarioService {
  /**
   * Client-side or Server-side mathematical simulation of recovery values based on parameter sliders
   */
  public simulate(
    caseData: ReturnCase,
    variables: ScenarioVariables
  ): ScenarioCalculationResult[] {
    const {
      purchaseMultiplier,
      refurbCostMultiplier,
      serviceLifeMultiplier,
      marketDemandFactor,
      demandOverride,
    } = variables;

    const baseVal = caseData.facts.originalPrice;
    const refurbCost = caseData.predictions.refurbishmentCost * refurbCostMultiplier;
    const secondaryMarketPrice =
      caseData.predictions.secondaryMarketPrice * purchaseMultiplier * marketDemandFactor;

    const routes: { id: DispositionRouteId; calc: () => number }[] = [
      {
        id: 'redeploy',
        calc: () => {
          if (demandOverride) return 0;
          return baseVal * 0.75 * serviceLifeMultiplier - refurbCost * 0.5;
        },
      },
      {
        id: 'relase',
        calc: () => {
          if (demandOverride) return 0;
          return baseVal * 0.65 * serviceLifeMultiplier - refurbCost * 0.6;
        },
      },
      {
        id: 'resale',
        calc: () => secondaryMarketPrice - refurbCost,
      },
      {
        id: 'intparts',
        calc: () => baseVal * 0.35 * serviceLifeMultiplier - refurbCost * 0.2,
      },
      {
        id: 'extparts',
        calc: () => baseVal * 0.28 * marketDemandFactor - refurbCost * 0.15,
      },
      {
        id: 'material',
        calc: () => baseVal * 0.08,
      },
      {
        id: 'exit',
        calc: () => -(refurbCost * 0.1), // small disposal fee
      },
    ];

    const results: ScenarioCalculationResult[] = routes.map((r) => {
      const baseline = Math.max(0, r.calc());
      const simulated = Math.max(0, r.calc());
      const delta = simulated - baseline;

      return {
        route: r.id,
        baselineNetRecovery: Math.round(baseline),
        simulatedNetRecovery: Math.round(simulated),
        variancePercent: baseline > 0 ? Math.round((delta / baseline) * 100) : 0,
        npvDelta: Math.round(delta),
        isRecommendedUnderScenario: false,
      };
    });

    // Mark the highest net recovery route as recommended under scenario
    const maxItem = results.reduce(
      (prev, curr) => (curr.simulatedNetRecovery > prev.simulatedNetRecovery ? curr : prev),
      results[0]
    );
    if (maxItem) maxItem.isRecommendedUnderScenario = true;

    return results;
  }
}

export const scenarioService = new ScenarioService();
