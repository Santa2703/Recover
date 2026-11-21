/**
 * Colour values used by the local pages, collected so new components and charts
 * reuse them instead of inventing new ones. Mirrors the additive :root block at
 * the end of src/app/globals.css.
 */
export const tokens = {
  brand: '#FFD600',
  brandHover: '#FACC15',
  brandSoft: '#FFFBEB',
  canvas: '#F8F9FA',
  surface: '#FFFFFF',
  surface2: '#F8FAFC',
  ink: '#141416',
  ink2: '#64748B',
  ink3: '#94A3B8',
  line: '#E2E8F0',
  lineSoft: '#F1F5F9',
  sidebar: '#0C0D0E',
  success: '#059669',
  successSoft: '#ECFDF5',
  /** Text on successSoft pills (#059669 there is only 3.6:1; this meets WCAG AA 4.5:1). */
  successText: '#047857',
  warning: '#D97706',
  warningSoft: '#FEF3C7',
  danger: '#DC2626',
  dangerSoft: '#FEE2E2',
  /** Text on dangerSoft pills (#DC2626 there is only 3.95:1; this meets WCAG AA 4.5:1). */
  dangerText: '#B91C1C',
  info: '#0284C7',
  infoSoft: '#E0F2FE',
} as const;

/** Route colours already used by the app (constants/routes.constants.ts). */
export const routeColors: Record<string, string> = {
  redeploy: '#141414',
  resale: '#FFD600',
  intparts: '#8A6D00',
  relase: '#5E5652',
  material: '#9C8F84',
  extparts: '#C9B24A',
  exit: '#BDAFA3',
};

/** Categorical series for multi-series charts (validated with the dataviz palette checker). */
export const seriesColors = ['#2A78D6', '#EB6834', '#1BAF7A', '#EDA100', '#E87BA4', '#008300', '#6250D6'] as const;

/** Single-series charts: dark bars with one highlighted in the brand yellow (matches local charts). */
export const chartColors = {
  neutral: '#141416',
  neutralSoft: '#CBD5E1',
  highlight: tokens.brand,
  grid: '#F1F5F9',
  axis: tokens.ink3,
  predicted: '#BDAFA3',
  actual: '#141416',
} as const;

export const statusTone = {
  success: { fg: tokens.successText, bg: tokens.successSoft },
  warning: { fg: tokens.warning, bg: tokens.warningSoft },
  danger: { fg: tokens.dangerText, bg: tokens.dangerSoft },
  info: { fg: tokens.info, bg: tokens.infoSoft },
  neutral: { fg: '#475569', bg: tokens.lineSoft },
  brand: { fg: '#854D0E', bg: '#FEF08A' },
} as const;

export type Tone = keyof typeof statusTone;
