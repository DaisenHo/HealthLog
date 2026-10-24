"use client";

import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { locales, localeLabels, type Locale } from "@/lib/i18n/config";
import { useTranslations } from "@/lib/i18n/context";

export function LanguageSelect({ id = "language-select" }: { id?: string }) {
  const router = useRouter();
  const { t, locale, setLocale, pendingLocale, localeErrorKey } =
    useTranslations();
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{t("settings.language")}</Label>
      <NativeSelect
        id={id}
        value={pendingLocale ?? locale}
        disabled={pendingLocale !== null}
        aria-busy={pendingLocale !== null}
        aria-describedby={`${id}-description${localeErrorKey ? ` ${id}-error` : ""}`}
        onChange={async (event) => {
          if (await setLocale(event.target.value as Locale)) router.refresh();
        }}
      >
        {locales.map((option) => (
          <option key={option} value={option}>
            {localeLabels[option]}
          </option>
        ))}
      </NativeSelect>
      <p id={`${id}-description`} className="text-muted-foreground text-xs">
        {t("settings.languageDescription")}
      </p>
      {localeErrorKey ? (
        <p id={`${id}-error`} role="alert">
          {t(localeErrorKey)}
        </p>
      ) : null}
    </div>
  );
}
