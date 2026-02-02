import React, {createContext, useContext, useMemo} from 'react';
import {useColorScheme} from 'react-native';
import {lightColors, darkColors, ThemeColors} from './colors';

interface ThemeContextType {
  colors: ThemeColors;
  isDark: boolean;
}

const ThemeContext = createContext<ThemeContextType>({
  colors: lightColors,
  isDark: false,
});

export const ThemeProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';

  const value = useMemo(() => ({
    colors: isDark ? darkColors : lightColors,
    isDark,
  }), [isDark]);

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
};

export const useTheme = () => useContext(ThemeContext);
