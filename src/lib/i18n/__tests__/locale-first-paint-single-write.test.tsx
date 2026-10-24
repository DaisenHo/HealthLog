/** First paint uses the already resolved account language without a fallback-language flash. */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { I18nProvider, useTranslations } from "@/lib/i18n/context";
import deMessages from "../../../../messages/de.json";
import zhMessages from "../../../../messages/zh-CN.json";

function Read({ k }: { k: string }) {
  const { t } = useTranslations();
  return <span>{t(k)}</span>;
}

describe("first paint carries the resolved locale, not a default", () => {
  it("renders the server-resolved locale on the very first pass", () => {
    // If this ever rendered English first, the mount effect would persist
    // English before the flip, and the race above would be real.
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="de" initialMessages={deMessages}>
        <Read k="common.save" />
      </I18nProvider>,
    );
    expect(html).toContain("Speichern");
    expect(html).not.toContain(">Save<");
  });

  it("renders the Chinese account language before client synchronization", () => {
    const html = renderToStaticMarkup(
      <I18nProvider initialLocale="zh-CN" initialMessages={zhMessages}>
        <Read k="common.save" />
      </I18nProvider>,
    );
    expect(html).toContain("保存");
    expect(html).not.toContain(">Save<");
  });
});
