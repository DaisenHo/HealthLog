/**
 * Account interface language for browser and native clients.
 * GET reads the saved preference; PUT stores an explicit choice and refreshes
 * the browser cookie. Cached browser language never writes on a read.
 */
import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { apiHandler, requireActorAuth } from "@/lib/api-handler";
import { apiError, apiSuccess, safeJson } from "@/lib/api-response";
import { annotate } from "@/lib/logging/context";
import { locales, type Locale } from "@/lib/i18n/config";
import { resolveJobLocale } from "@/lib/i18n/job-locale";
import { setLocaleCookie } from "@/lib/i18n/locale-cookie";

export const dynamic = "force-dynamic";

function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" && (locales as readonly string[]).includes(value)
  );
}

export const GET = apiHandler(async () => {
  const { user } = await requireActorAuth();
  return apiSuccess({ locale: await resolveJobLocale(user.locale) });
});

export const PUT = apiHandler(async (request: NextRequest) => {
  // An actor surface, and the clearest case for the mode existing at all: the
  // UI language belongs to the person reading the screen, never to the record
  // on it. Under a record scope this would write the delegate's choice onto
  // the OWNER's row and then send the owner's cron mail in a language they may
  // not read — a preference silently transplanted between two people.
  //
  // The switcher must also work while the actor views a shared record.
  //
  // This is a WRITE on an actor surface, which is exactly right and worth
  // naming, because the mode carries no method escalation: the row it updates
  // is the caller's own, resolved from their own session, and no grant is
  // consulted or needed.
  const { user } = await requireActorAuth();
  annotate({ action: { name: "user.locale.update" } });

  const { data: body, error: jsonError } = await safeJson(request, {
    maxBytes: 4 * 1024,
  });
  if (jsonError) return jsonError;

  const locale = (body as { locale?: unknown } | null)?.locale;
  if (!isLocale(locale)) {
    return apiError("Not a supported locale.", 422);
  }

  // Idempotent: skip the write (and the annotation noise) when the column
  // already matches.
  if (user.locale !== locale) {
    await prisma.user.update({
      where: { id: user.id },
      data: { locale },
    });
    annotate({ meta: { locale_next: locale } });
  }

  // Mirror the accepted locale into the `healthlog-locale` cookie via
  // Set-Cookie. The client's own `document.cookie` write is capped at 7
  // days by Safari ITP; the server-set copy is not, so an explicit choice
  // survives on every device. Runs on the idempotent path too — the
  // session reads also refresh it from the saved account preference.
  // Harmless no-op payload for Bearer
  // callers (native clients ignore cookies).
  const cookieStore = await cookies();
  setLocaleCookie(cookieStore, locale);

  return apiSuccess({ locale });
});
