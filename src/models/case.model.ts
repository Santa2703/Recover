import { DispositionRouteId } from './treatment.model';

export type CaseStage =
  | 'received'
  | 'triage'
  | 'testing'
  | 'awaiting_approval'
  | 'approved'
  | 'handed_off'
  | 'reconciled';

export type AssetCondition = 'A' | 'B' | 'C' | 'D' | 'Scrap';

export interface ReturnCase {
  id: string;
  assetTag: string;
  serialNumber: string;
  productClass: 'motor' | 'pump' | 'control' | 'drill' | 'batch' | 'it';
  productName: string;
  manufacturer: string;
  model: string;
  location: string;
  tenant: string;
  receivedDate: string;
  condition: AssetCondition;
  residualLifeMonths: number;
  stage: CaseStage;
  recommendedRoute: DispositionRouteId;
  estimatedNetRecovery: number;
  carbonAvoidedKg: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  blockedReason?: string | null;
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
