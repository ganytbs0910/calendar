import React, {createContext, useContext, useMemo, useState, useEffect} from 'react';
import {useColorScheme} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {lightColors, darkColors, ThemeColors, SKINS} from './colors';

type ThemeMode = 'system' | 'light' | 'dark';

interface ThemeContextType {
  colors: ThemeColors;
  isDark: boolean;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  skinId: string;
  setSkinId: (id: string) => void;
}

const THEME_STORAGE_KEY = '@theme_mode';
const SKIN_STORAGE_KEY = '@skin_id';

const ThemeContext = createContext<ThemeContextType>({
  colors: lightColors,
  isDark: false,
  themeMode: 'system',
  setThemeMode: () => {},
  skinId: 'default',
  setSkinId: () => {},
});

export const ThemeProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const systemColorScheme = useColorScheme();
  const [themeMode, setThemeModeState] = useState<ThemeMode>('system');
  const [skinId, setSkinIdState] = useState('default');

  // Load saved theme mode and skin
  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(THEME_STORAGE_KEY),
      AsyncStorage.getItem(SKIN_STORAGE_KEY),
    ]).then(([savedTheme, savedSkin]) => {
      if (savedTheme === 'light' || savedTheme === 'dark' || savedTheme === 'system') {
        setThemeModeState(savedTheme);
      }
      if (savedSkin) {
        setSkinIdState(savedSkin);
      }
    }).catch(() => {});
  }, []);

  const setThemeMode = (mode: ThemeMode) => {
    setThemeModeState(mode);
    AsyncStorage.setItem(THEME_STORAGE_KEY, mode).catch(() => {});
  };

  const setSkinId = (id: string) => {
    setSkinIdState(id);
    AsyncStorage.setItem(SKIN_STORAGE_KEY, id).catch(() => {});
  };

  const isDark = useMemo(() => {
    if (themeMode === 'system') {
      return systemColorScheme === 'dark';
    }
    return themeMode === 'dark';
  }, [themeMode, systemColorScheme]);

  const colors = useMemo(() => {
    const base = isDark ? darkColors : lightColors;
    const skin = SKINS.find(s => s.id === skinId);
    if (!skin) return base;
    const overrides = isDark ? skin.dark : skin.light;
    return {...base, ...overrides};
  }, [isDark, skinId]);

  const value = useMemo(() => ({
    colors,
    isDark,
    themeMode,
    setThemeMode,
    skinId,
    setSkinId,
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [colors, isDark, themeMode, skinId]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
