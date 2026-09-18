import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import mobileAr from './locales/ar.json';
import webAr from './locales/web-ar.json';
const ar = { ...mobileAr, ...webAr };
type Locale = 'en' | 'ar';
const Context = createContext<{
  locale: Locale;
  t: (text: string) => string;
  setLocale: (l: Locale) => void;
}>({ locale: 'en', t: (x) => x, setLocale: () => {} });
export function LanguageProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() =>
    (localStorage.getItem('clinic-language') || navigator.language).startsWith('ar') ? 'ar' : 'en',
  );
  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'ar' ? 'rtl' : 'ltr';
    localStorage.setItem('clinic-language', locale);
  }, [locale]);
  const t = (text: string) =>
    locale === 'ar' ? (ar as Record<string, string>)[text] || text : text;
  return <Context value={{ locale, t, setLocale }}>{children}</Context>;
}
export const useLanguage = () => useContext(Context);
