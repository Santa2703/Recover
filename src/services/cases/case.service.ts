import { apiClient } from '../api/apiClient';
import { ReturnCase, CaseStage } from '@/models/case.model';
import { DispositionRouteId } from '@/models/treatment.model';

export class CaseService {
  /**
   * Fetches intake cases with optional filtering
   */
  public async getCases(params?: {
    stage?: CaseStage;
    tenant?: string;
    location?: string;
    priority?: string;
    search?: string;
  }): Promise<ReturnCase[]> {
    return apiClient.get<ReturnCase[]>('/cases', params);
  }

  /**
   * Fetches a single case by ID with full detail
   */
  public async getCaseById(id: string): Promise<ReturnCase> {
    return apiClient.get<ReturnCase>(`/cases/${id}`);
  }

  /**
   * Updates stage or disposition recommendation for a case
   */
  public async updateCaseStage(
    id: string,
    stage: CaseStage,
    notes?: string
  ): Promise<ReturnCase> {
    return apiClient.put<ReturnCase>(`/cases/${id}/stage`, { stage, notes });
  }

  /**
   * Approves or overrides a treatment route
   */
  public async submitDecision(
    caseId: string,
    route: DispositionRouteId,
    overrideReason?: string
  ): Promise<{ success: boolean; caseId: string; route: DispositionRouteId }> {
    return apiClient.post('/cases/decision', {
      caseId,
      route,
      overrideReason,
    });
  }
}

export const caseService = new CaseService();
