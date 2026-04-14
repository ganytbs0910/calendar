import React, {createContext, useContext, useState, useEffect, useCallback} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {initIAP, restorePurchases, endIAP} from '../services/iapService';

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
    // First check local cache
    AsyncStorage.getItem(PREMIUM_KEY).then(async (val) => {
      if (val === 'true') {
        setIsPremium(true);
      }
      // Then verify with App Store in background
      try {
        const connected = await initIAP();
        if (connected) {
          const hasPremium = await restorePurchases();
          if (hasPremium) {
            setIsPremium(true);
            await AsyncStorage.setItem(PREMIUM_KEY, 'true');
          }
        }
      } catch {
        // If verification fails, trust local cache
      }
    }).catch(() => {});

    return () => { endIAP(); };
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
