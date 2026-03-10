import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Locale } from "@/lib/types";

type I18nContextType = {
  locale: Locale;
  isZh: boolean;
  setLocale: (next: Locale) => void;
  text: (zh: string, en: string) => string;
};

const I18N_STORAGE_KEY = "digestdesk-locale";

const I18nContext = createContext<I18nContextType | null>(null);

function detectInitialLocale(): Locale {
  try {
    const stored = localStorage.getItem(I18N_STORAGE_KEY);
    if (stored === "zh" || stored === "en") return stored;
  } catch {
    // ignore
  }

  const navLang = navigator.language.toLowerCase();
  return navLang.startsWith("zh") ? "zh" : "en";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(detectInitialLocale);

  useEffect(() => {
    try {
      localStorage.setItem(I18N_STORAGE_KEY, locale);
    } catch {
      // ignore
    }
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);

  const text = useCallback(
    (zh: string, en: string) => (locale === "zh" ? zh : en),
    [locale],
  );

  const value = useMemo(
    () => ({
      locale,
      isZh: locale === "zh",
      setLocale,
      text,
    }),
    [locale, text],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within an I18nProvider");
  }
  return context;
}
