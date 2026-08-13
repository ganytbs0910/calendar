export const lightColors = {
  background: '#f5f5f5',
  surface: '#ffffff',
  surfaceSecondary: '#f8f9fa',
  primary: '#007AFF',
  text: '#333333',
  textSecondary: '#666666',
  // #999999 measured 2.85:1 on surface and 2.61:1 on background — below WCAG AA
  // for normal text (4.5:1) and below even the large-text floor (3.0:1), and
  // this token carries de-emphasised but still load-bearing text (the week
  // view's free hours, counts, sublabels). #707070 is the lightest grey that
  // clears 4.5:1 against both: 4.95:1 and 4.54:1. The dark theme already passed.
  textTertiary: '#707070',
  border: '#eeeeee',
  borderLight: '#f0f0f0',
  sunday: '#FF3B30',
  saturday: '#007AFF',
  today: '#E8F4FD',
  selected: '#BBDEFB',
  dragRange: '#B3E5FC',
  error: '#FF3B30',
  overlay: 'rgba(0, 0, 0, 0.4)',
  inputBackground: '#f0f0f0',
  delete: '#FF3B30',
  errorBackground: '#FFF3F3',
  onPrimary: '#ffffff',
  onEvent: '#ffffff',
  pickerHighlight: 'rgba(0, 122, 255, 0.05)',
  pickerText: '#999999',
  pickerTextSelected: '#000000',
  currentTimeIndicator: '#FF3B30',
  disabled: '#cccccc',
  allDayEvent: '#E8F4FD',
  allDayEventText: '#007AFF',
};

export const darkColors = {
  background: '#000000',
  surface: '#1c1c1e',
  surfaceSecondary: '#2c2c2e',
  primary: '#0A84FF',
  text: '#ffffff',
  textSecondary: '#ababab',
  textTertiary: '#8e8e93',
  border: '#38383a',
  borderLight: '#2c2c2e',
  sunday: '#FF453A',
  saturday: '#0A84FF',
  today: '#1c3a4d',
  selected: '#1f5b8a',
  dragRange: '#1c3a4d',
  error: '#FF453A',
  overlay: 'rgba(0, 0, 0, 0.6)',
  inputBackground: '#2c2c2e',
  delete: '#FF453A',
  errorBackground: '#3a1c1c',
  onPrimary: '#ffffff',
  onEvent: '#ffffff',
  pickerHighlight: 'rgba(10, 132, 255, 0.1)',
  pickerText: '#8e8e93',
  pickerTextSelected: '#ffffff',
  currentTimeIndicator: '#FF453A',
  disabled: '#48484a',
  allDayEvent: '#1c3a4d',
  allDayEventText: '#0A84FF',
};

export type ThemeColors = typeof lightColors;

// --- Accent color (selectable theme color) ---
export const ACCENTS = {
  blue: {label: 'ブルー', light: '#007AFF', dark: '#0A84FF'},
  green: {label: 'グリーン', light: '#34C759', dark: '#30D158'},
  indigo: {label: 'インディゴ', light: '#5856D6', dark: '#5E5CE6'},
  purple: {label: 'パープル', light: '#AF52DE', dark: '#BF5AF2'},
  pink: {label: 'ピンク', light: '#FF2D55', dark: '#FF375F'},
  orange: {label: 'オレンジ', light: '#FF9500', dark: '#FF9F0A'},
  teal: {label: 'ティール', light: '#30B0C7', dark: '#40C8E0'},
  graphite: {label: 'グラファイト', light: '#48484a', dark: '#8e8e93'},
} as const;

export type AccentKey = keyof typeof ACCENTS;
export const DEFAULT_ACCENT: AccentKey = 'blue';

const hexToRgba = (hex: string, alpha: number) => {
  const h = hex.replace('#', '');
  const r = parseInt(h.substring(0, 2), 16);
  const g = parseInt(h.substring(2, 4), 16);
  const b = parseInt(h.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

// Returns the full color palette for a given mode + accent.
// Non-accent colors come from the base light/dark palettes; the
// accent-derived ones (primary + its tints) are recomputed per accent.
export const buildColors = (isDark: boolean, accent: AccentKey): ThemeColors => {
  const base = isDark ? darkColors : lightColors;
  const a = ACCENTS[accent] ?? ACCENTS[DEFAULT_ACCENT];
  const p = isDark ? a.dark : a.light;
  return {
    ...base,
    primary: p,
    saturday: p,
    today: hexToRgba(p, isDark ? 0.22 : 0.1),
    selected: hexToRgba(p, isDark ? 0.4 : 0.25),
    dragRange: hexToRgba(p, isDark ? 0.3 : 0.18),
    pickerHighlight: hexToRgba(p, isDark ? 0.12 : 0.06),
    allDayEvent: hexToRgba(p, isDark ? 0.22 : 0.12),
    allDayEventText: p,
  };
};
