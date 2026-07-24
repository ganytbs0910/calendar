import React, {createContext, useContext, useMemo, useState, useEffect} from 'react';
import {useColorScheme} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {lightColors, ThemeColors, ACCENTS, AccentKey, DEFAULT_ACCENT, buildColors} from './colors';

type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeContextType {
  colors: ThemeColors;
  isDark: boolean;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  accentColor: AccentKey;
  setAccentColor: (accent: AccentKey) => void;
}

const THEME_STORAGE_KEY = '@theme_mode';
const ACCENT_STORAGE_KEY = '@accent_color';

const ThemeContext = createContext<ThemeContextType>({
  colors: lightColors,
  isDark: false,
  themeMode: 'system',
  setThemeMode: () => {},
  accentColor: DEFAULT_ACCENT,
  setAccentColor: () => {},
});

export const ThemeProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [accentColor, setAccentColorState] = useState<AccentKey>(DEFAULT_ACCENT);

  useEffect(() => {
    AsyncStorage.getItem(THEME_STORAGE_KEY).then(saved => {
      if (saved === 'light' || saved === 'dark' || saved === 'system') {
        setThemeModeState(saved);
      }
    }).catch(() => {});
    AsyncStorage.getItem(ACCENT_STORAGE_KEY).then(saved => {
      if (saved && saved in ACCENTS) {
        setAccentColorState(saved as AccentKey);
      }
    }).catch(() => {});
  }, []);

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
    AsyncStorage.setItem(THEME_STORAGE_KEY, mode).catch(() => {});
  };

  const setAccentColor = (accent: AccentKey) => {
    setAccentColorState(accent);
    AsyncStorage.setItem(ACCENT_STORAGE_KEY, accent).catch(() => {});
  };

  const isDark = useMemo(() => {
    if (themeMode === 'system') {
      return systemColorScheme === 'dark';
    }
    return themeMode === 'dark';
  }, [themeMode, systemColorScheme]);

  const value = useMemo(() => ({
    colors: buildColors(isDark, accentColor),
    isDark,
    themeMode,
    setThemeMode,
    accentColor,
    setAccentColor,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [isDark, themeMode, accentColor]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
