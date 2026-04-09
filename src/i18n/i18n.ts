import i18n from 'i18next';
import {initReactI18next} from 'react-i18next';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {NativeModules, Platform} from 'react-native';

import ja from './locales/ja';
import en from './locales/en';
import zhHans from './locales/zh-Hans';
import zhHant from './locales/zh-Hant';
import ko from './locales/ko';
import es from './locales/es';
import fr from './locales/fr';
import de from './locales/de';
import pt from './locales/pt';
import th from './locales/th';
import id from './locales/id';

const LANGUAGE_KEY = '@app_language';

export const LANGUAGES = [
  {code: 'auto', label: ''},
  {code: 'ja', label: '日本語'},
  {code: 'en', label: 'English'},
  {code: 'zh-Hans', label: '简体中文'},
  {code: 'zh-Hant', label: '繁體中文'},
  {code: 'ko', label: '한국어'},
  {code: 'es', label: 'Español'},
  {code: 'fr', label: 'Français'},
  {code: 'de', label: 'Deutsch'},
  {code: 'pt', label: 'Português'},
  {code: 'th', label: 'ภาษาไทย'},
  {code: 'id', label: 'Bahasa Indonesia'},
];

function getDeviceLanguage(): string {
  let deviceLang = 'ja';
  try {
    if (Platform.OS === 'ios') {
      const settings = NativeModules.SettingsManager?.settings;
      const langs = settings?.AppleLanguages;
      if (langs && langs.length > 0) {
        deviceLang = langs[0];
      }
    } else {
      deviceLang = NativeModules.I18nManager?.localeIdentifier || 'ja';
    }
  } catch {
    deviceLang = 'ja';
  }

  // Map device language to supported language
  if (deviceLang.startsWith('ja')) return 'ja';
  if (deviceLang.startsWith('en')) return 'en';
  if (deviceLang === 'zh-Hans' || deviceLang.startsWith('zh-Hans') || deviceLang === 'zh-CN') return 'zh-Hans';
  if (deviceLang === 'zh-Hant' || deviceLang.startsWith('zh-Hant') || deviceLang === 'zh-TW' || deviceLang === 'zh-HK') return 'zh-Hant';
  if (deviceLang.startsWith('zh')) return 'zh-Hans';
  if (deviceLang.startsWith('ko')) return 'ko';
  if (deviceLang.startsWith('es')) return 'es';
  if (deviceLang.startsWith('fr')) return 'fr';
  if (deviceLang.startsWith('de')) return 'de';
  if (deviceLang.startsWith('pt')) return 'pt';
  if (deviceLang.startsWith('th')) return 'th';
  if (deviceLang.startsWith('id') || deviceLang.startsWith('in')) return 'id';

  return 'ja';
}

i18n.use(initReactI18next).init({
  resources: {
    ja: {translation: ja},
    en: {translation: en},
    'zh-Hans': {translation: zhHans},
    'zh-Hant': {translation: zhHant},
    ko: {translation: ko},
    es: {translation: es},
    fr: {translation: fr},
    de: {translation: de},
    pt: {translation: pt},
    th: {translation: th},
    id: {translation: id},
  },
  lng: getDeviceLanguage(),
  fallbackLng: 'ja',
  interpolation: {
    escapeValue: false,
  },
  returnObjects: true,
});

// Load saved language preference
export async function loadSavedLanguage() {
  try {
    const saved = await AsyncStorage.getItem(LANGUAGE_KEY);
    if (saved === 'auto' || saved === null) {
      i18n.changeLanguage(getDeviceLanguage());
    } else {
      i18n.changeLanguage(saved);
    }
  } catch {
    // Use default
  }
}

export async function setAppLanguage(code: string) {
  await AsyncStorage.setItem(LANGUAGE_KEY, code);
  if (code === 'auto') {
    i18n.changeLanguage(getDeviceLanguage());
  } else {
    i18n.changeLanguage(code);
  }
}

export async function getSavedLanguageCode(): Promise<string> {
  try {
    const saved = await AsyncStorage.getItem(LANGUAGE_KEY);
    return saved || 'auto';
  } catch {
    return 'auto';
  }
}

export default i18n;
