import { useI18n } from "@/contexts/I18nContext";

export default function LocaleToggle() {
  const { locale, setLocale } = useI18n();

  return (
    <button
      type="button"
      className="workspace-locale-button shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      onClick={() => setLocale(locale === "zh" ? "en" : "zh")}
      aria-label={locale === "zh" ? "Switch to English" : "切换到中文"}
    >
      {locale === "zh" ? "EN" : "中"}
    </button>
  );
}
