import { DispositionRouteId } from '@/models/treatment.model';

export interface RouteMeta {
  id: DispositionRouteId;
  name: string;
  shortLabel: string;
  color: string;
  description: string;
}

export const DISPOSITION_ROUTES: Record<DispositionRouteId, RouteMeta> = {
  redeploy: {
    id: 'redeploy',
    name: 'Internal Redeploy',
    shortLabel: 'Redeploy',
    color: '#141414',
    description: 'Transfer directly to another internal plant, facility, or operating line',
  },
  resale: {
    id: 'resale',
    name: 'Whole-Asset Resale',
    shortLabel: 'Resale',
    color: '#FFDD00',
    description: 'Sell certified pre-owned complete unit on secondary commercial markets',
  },
  intparts: {
    id: 'intparts',
    name: 'Internal Parts Harvest',
    shortLabel: 'Internal parts',
    color: '#8A6D00',
    description: 'Dismantle asset to harvest high-value components for internal service fleet',
  },
  relase: {
    id: 'relase',
    name: 'Secondary Re-lease',
    shortLabel: 'Re-lease',
    color: '#5E5652',
    description: 'Refurbish asset and place into a new customer operating lease',
  },
  material: {
    id: 'material',
    name: 'Material Recovery',
    shortLabel: 'Material',
    color: '#9C8F84',
    description: 'Closed-loop recycling and raw metal/polymer reclamation',
  },
  extparts: {
    id: 'extparts',
    name: 'External Parts Sale',
    shortLabel: 'External parts',
    color: '#C9B24A',
    description: 'Sell harvested certified parts to third-party repair networks',
  },
  exit: {
    id: 'exit',
    name: 'Responsible Exit',
    shortLabel: 'Exit',
    color: '#BDAFA3',
    description: 'Certified environmental disposal and hazardous waste neutralization',
  },
};
