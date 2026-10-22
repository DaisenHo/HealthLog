/**
 * v1.25 — locale-aware crisis-resource signposting for the PHQ-9 item-9 safety
 * path. This is SUPPORT, not interpretation: when item 9 is answered with any
 * non-zero value the UI shows a calm, non-alarmist card pointing to real help.
 *
 * The list is maintained config (not hardcoded in a component) so a self-hoster
 * can localise it. Names resolve via the `mentalHealth.crisisResource.<id>.name`
 * i18n key; the contact lines (phone numbers / URLs) are literal data, never
 * translated. The emergency number is region-specific and always shown first.
 *
 * HARD RULE: showing these resources NEVER triggers any third-party alert,
 * never notifies a contact, never emails. It is private, on-device-only
 * signposting on a self-host.
 */

export interface CrisisResource {
  /** Stable id; the `mentalHealth.crisisResource.<id>.name` i18n key resolves the label. */
  id: string;
  /** Contact lines (phone / SMS / chat URL) — literal, not translated. */
  contacts: readonly string[];
}

export interface CrisisResourceSet {
  /** Region's universal emergency number, shown first ("if in immediate danger…"). */
  emergencyNumber: string;
  resources: readonly CrisisResource[];
}

/** International fallback set (used when a region has no dedicated entry). */
const INTERNATIONAL: CrisisResourceSet = {
  emergencyNumber: "112",
  resources: [
    { id: "findahelpline", contacts: ["findahelpline.com"] },
    { id: "euEmotionalSupport", contacts: ["116 123"] },
  ],
};

/** Germany (de) — TelefonSeelsorge + youth lines + acute emergency. */
const DE: CrisisResourceSet = {
  emergencyNumber: "112",
  resources: [
    {
      id: "telefonSeelsorge",
      contacts: ["0800 111 0 111", "0800 111 0 222", "telefonseelsorge.de"],
    },
    { id: "nummerGegenKummer", contacts: ["116 111"] },
    { id: "krisenchat", contacts: ["krisenchat.de"] },
    { id: "findahelpline", contacts: ["findahelpline.com"] },
  ],
};

/** Austria (at) — Telefonseelsorge Österreich + acute emergency. */
const AT: CrisisResourceSet = {
  emergencyNumber: "112",
  resources: [
    { id: "telefonSeelsorgeAt", contacts: ["142", "telefonseelsorge.at"] },
    { id: "findahelpline", contacts: ["findahelpline.com"] },
  ],
};

/** Switzerland (ch) — Die Dargebotene Hand + acute emergency. */
const CH: CrisisResourceSet = {
  emergencyNumber: "112",
  resources: [
    { id: "dargeboteneHand", contacts: ["143", "143.ch"] },
    { id: "findahelpline", contacts: ["findahelpline.com"] },
  ],
};

/**
 * Combined DE/AT/CH set — used when the locale is the bare "de" code with no
 * region hint. `User.locale` in this app is a short code ("de"/"en"/…), so a
 * de-AT or de-CH self-hoster is otherwise indistinguishable from a de-DE one.
 * Serving the Germany-only freephone numbers to them left a Swiss or
 * Austrian user in crisis staring at numbers that don't connect from their
 * country. Leads with 112 (works across all three), then every country's
 * own line grouped together so nothing here is presented as DE-only.
 */
const DE_AT_CH: CrisisResourceSet = {
  emergencyNumber: "112",
  resources: [
    // Country-specific lines first, each set's own `findahelpline` entry
    // dropped so the worldwide directory appears exactly once, at the end.
    ...DE.resources.filter((r) => r.id !== "findahelpline"),
    ...AT.resources.filter((r) => r.id !== "findahelpline"),
    ...CH.resources.filter((r) => r.id !== "findahelpline"),
    { id: "findahelpline", contacts: ["findahelpline.com"] },
  ],
};

/** United States (en-US region hint) — 988 + Crisis Text Line. */
const US: CrisisResourceSet = {
  emergencyNumber: "911",
  resources: [
    { id: "lifeline988", contacts: ["988"] },
    { id: "crisisTextLine", contacts: ["Text HOME to 741741"] },
    { id: "findahelpline", contacts: ["findahelpline.com"] },
  ],
};

/**
 * Brazil (pt-BR) — CVV by phone and chat, SAMU as the emergency number.
 * Both numbers are free and answer around the clock (cvv.org.br; the
 * Ministry of Health's SAMU 192 page).
 */
const BR: CrisisResourceSet = {
  emergencyNumber: "192",
  resources: [
    { id: "cvv", contacts: ["188", "cvv.org.br/chat"] },
    { id: "findahelpline", contacts: ["findahelpline.com"] },
  ],
};

/**
 * Resolve a crisis-resource set from the user's locale. Region detection is
 * coarse (locale prefix) and defaults to the international set — the goal is to
 * always surface SOMETHING actionable, never to be exhaustive.
 *
 * A region-qualified tag ("de-AT", "de_CH", …) resolves to the exact country
 * set when the caller has one to give us. `User.locale` today only ever
 * stores the bare short code, so in practice every "de" hits the DE_AT_CH
 * branch below — that is the safe default for an unqualified "de": never
 * assume Germany when the region is unknown.
 */
export function crisisResourcesForLocale(
  locale: string | null | undefined,
): CrisisResourceSet {
  const lc = (locale ?? "").toLowerCase();
  if (lc === "de-at" || lc === "de_at" || lc === "at") return AT;
  if (lc === "de-ch" || lc === "de_ch" || lc === "ch") return CH;
  if (lc.startsWith("de")) return DE_AT_CH;
  if (lc === "en-us" || lc.startsWith("en_us") || lc === "us") return US;
  // Brazilian Portuguese only: CVV's 188 does not connect from Portugal, so a
  // bare "pt" or "pt-PT" keeps the international set.
  if (lc === "pt-br" || lc === "pt_br" || lc === "br") return BR;
  return INTERNATIONAL;
}
