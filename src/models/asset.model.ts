import { AssetCondition } from './case.model';

export interface AssetComponent {
  partNumber: string;
  name: string;
  condition: AssetCondition;
  harvestValue: number;
  hazardous: boolean;
}

export interface AssetTelemetryPoint {
  timestamp: string;
  vibration: number;
  temperature: number;
  operatingHours: number;
  efficiencyIndex: number;
}

export interface Asset360 {
  id: string;
  assetTag: string;
  productName: string;
  category: string;
  manufacturer: string;
  model: string;
  purchaseDate: string;
  initialValue: number;
  currentBookValue: number;
  condition: AssetCondition;
  operatingHoursTotal: number;
  degradationScore: number;
  components: AssetComponent[];
  telemetryHistory: AssetTelemetryPoint[];
}
