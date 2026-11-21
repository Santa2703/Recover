import { apiClient } from '../api/apiClient';
import { TreatmentRoute, DispositionRouteId, TreatmentDecision } from '@/models/treatment.model';

export class TreatmentService {
  /**
   * Retrieves all 7 disposition routes and their baseline parameters
   */
  public async getAvailableRoutes(): Promise<TreatmentRoute[]> {
    return apiClient.get<TreatmentRoute[]>('/treatments/routes');
  }

  /**
   * Evaluates the optimal circularity route for an asset return
   */
  public async evaluateRoute(caseId: string): Promise<TreatmentDecision> {
    return apiClient.post<TreatmentDecision>(`/treatments/evaluate`, { caseId });
  }

  /**
   * Submits an evidence request for missing provenance or re-testing
   */
  public async requestEvidence(
    caseId: string,
    evidenceType: string,
    notes: string
  ): Promise<{ success: boolean; requestId: string }> {
    return apiClient.post(`/treatments/evidence-request`, {
      caseId,
      evidenceType,
      notes,
    });
  }
}

export const treatmentService = new TreatmentService();
