import { apiClient } from '../api/apiClient';
import { Asset360 } from '@/models/asset.model';

export class AssetService {
  /**
   * Fetches Asset 360 intelligence by tag or ID
   */
  public async getAsset360(assetId: string): Promise<Asset360> {
    return apiClient.get<Asset360>(`/assets/${assetId}`);
  }

  /**
   * Fetches degradation curves and telemetry points
   */
  public async getTelemetryHistory(assetId: string) {
    return apiClient.get(`/assets/${assetId}/telemetry`);
  }
}

export const assetService = new AssetService();
