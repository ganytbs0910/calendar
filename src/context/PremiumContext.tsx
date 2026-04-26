import React, {createContext, useContext, useState, useEffect, useCallback} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PREMIUM_KEY = '@is_premium';

interface PremiumContextType {
  isPremium: boolean;
  setPremium: (value: boolean) => void;
}

const PremiumContext = createContext<PremiumContextType>({
  isPremium: false,
  setPremium: () => {},
});

export const PremiumProvider: React.FC<{children: React.ReactNode}> = ({children}) => {
  const [isPremium, setIsPremium] = useState(false);

  useEffect(() => {
    // Only check local cache on mount - no IAP verification
    // IAP verification happens when paywall is opened
    AsyncStorage.getItem(PREMIUM_KEY).then(val => {
      if (val === 'true') {
        setIsPremium(true);
      }
    }).catch(() => {});
  }, []);

  const setPremium = useCallback((value: boolean) => {
    setIsPremium(value);
    AsyncStorage.setItem(PREMIUM_KEY, value ? 'true' : 'false').catch(() => {});
  }, []);

  return (
    <PremiumContext.Provider value={{isPremium, setPremium}}>
      {children}
    </PremiumContext.Provider>
  );
};

export const usePremium = () => useContext(PremiumContext);
