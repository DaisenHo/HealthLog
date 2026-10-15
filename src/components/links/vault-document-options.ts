"use client";

/**
 * The vault as a link-picker option list, with the documents near the
 * record's own date on top.
 *
 * The visit and vaccination forms used to fetch their document options with a
 * page size the list route refuses (`limit=200` against a ceiling of 100). The
 * 422 read as an empty list, so the picker said "No documents yet." to a
 * person with a full vault. The next version walked the whole vault, ten
 * pages deep, and anything past the thousandth document was out of reach.
 *
 * Now the picker opens on the documents filed around the record's date and
 * pages older and newer from there, and the search box asks the list route
 * itself, so a document is reachable wherever it sits in a vault of any size
 * (`useLinkPickerPages`). A read failure says so instead of pretending the
 * vault is empty. The documents dated within the same
 * ±{@link ENCOUNTER_SUGGEST_WINDOW_DAYS}-day window the upload suggestion uses
 * stay on top under their own heading, so the common case is still one tap;
 * everything else follows, grouped by month.
 *
 * A document whose filing date was cleared falls outside every date window;
 * the search still finds it by title, file name or content.
 */
import { useMemo } from "react";

import {
  serverPagingFrom,
  type EntityLinkOption,
} from "@/components/links/entity-link-picker";
import { documentPickerUrl } from "@/components/links/picker-requests";
import {
  pickerPivot,
  useLinkPickerPages,
  type PickerPage,
  type PickerPageRequest,
} from "@/components/links/use-link-picker-pages";
import { apiGet } from "@/lib/api/api-fetch";
import { ENCOUNTER_SUGGEST_WINDOW_DAYS } from "@/lib/encounters/suggest-window";
import { useFormatters, useTranslations } from "@/lib/i18n/context";
import { queryKeys } from "@/lib/query-keys";
import type { InboundDocumentDto } from "@/lib/validations/inbound-documents";
import { daysBetweenDateKeys } from "@/lib/tz/format";

/** The fields the option list reads off a document. */
export type VaultDocument = Pick<
  InboundDocumentDto,
  "id" | "title" | "filename" | "documentDate" | "reportDate" | "createdAt"
>;

interface ListPage {
  documents: InboundDocumentDto[];
  nextCursor: string | null;
}

/** One picker page of the vault. */
export async function fetchVaultPage(
  request: PickerPageRequest,
): Promise<PickerPage<VaultDocument>> {
  const result = await apiGet<ListPage>(documentPickerUrl(request));
  return { items: result.documents, next: result.nextCursor };
}

/**
 * Is a document dated within the suggestion window of the record's anchor?
 * Day-granular and inclusive on both edges, like the upload suggestion. A
 * document with no date of its own is never "near" anything.
 */
export function isNearAnchor(
  documentDay: string | null,
  anchorIso: string | null,
): boolean {
  if (!documentDay || !anchorIso) return false;
  const gap = daysBetweenDateKeys(
    anchorIso.slice(0, 10),
    documentDay.slice(0, 10),
  );
  if (Number.isNaN(gap)) return false;
  return Math.abs(gap) <= ENCOUNTER_SUGGEST_WINDOW_DAYS;
}

/**
 * Build the option list: suggestions first, under one heading, then the rest
 * of the vault in the route's order (newest filing date first), by month.
 *
 * `labels` carries the already-localised strings, so this stays a pure
 * function a test can call without a provider.
 */
export function documentOptionsWithSuggestions(
  documents: readonly VaultDocument[],
  anchorIso: string | null,
  labels: {
    suggested: string;
    month: (iso: string) => string;
    date: (iso: string) => string;
  },
): EntityLinkOption[] {
  const suggested: EntityLinkOption[] = [];
  const rest: EntityLinkOption[] = [];
  for (const doc of documents) {
    const own = doc.documentDate ?? doc.reportDate;
    const date = own ?? doc.createdAt;
    const base = {
      id: doc.id,
      label: doc.title ?? doc.filename ?? doc.id,
      dateLabel: date ? labels.date(date) : null,
      // The vault opens a document's sheet from `?doc=`.
      href: `/documents?doc=${encodeURIComponent(doc.id)}`,
    };
    if (isNearAnchor(own, anchorIso)) {
      suggested.push({
        ...base,
        group: { key: "suggested", label: labels.suggested },
      });
    } else {
      rest.push({
        ...base,
        group: date
          ? { key: date.slice(0, 7), label: labels.month(date) }
          : null,
      });
    }
  }
  return [...suggested, ...rest];
}

/**
 * The picker's data: the vault around the record's date as options, the
 * suggestion group on top when the record has a date, the paging the sheet
 * offers, and the query state an error row needs.
 */
export function useVaultDocumentOptions({
  enabled,
  anchor,
}: {
  enabled: boolean;
  /** The record's own date (ISO), or null when it has none yet. */
  anchor: string | null;
}) {
  const { t } = useTranslations();
  const format = useFormatters();
  const pages = useLinkPickerPages<VaultDocument>({
    enabled,
    pivot: pickerPivot(anchor),
    queryKey: queryKeys.inboundDocumentVaultPicker,
    fetchPage: fetchVaultPage,
  });

  const options = useMemo(
    () =>
      documentOptionsWithSuggestions(pages.items, anchor, {
        suggested: t("links.picker.suggested"),
        month: (iso) => `${format.monthShort(iso)} ${iso.slice(0, 4)}`,
        date: (iso) => format.date(iso),
      }),
    [pages.items, anchor, t, format],
  );

  return {
    options,
    pending: pages.pending,
    error: pages.error,
    retry: pages.retry,
    server: serverPagingFrom(pages),
  };
}

/** A linked document as the record's own read names it, for its chip. */
export function linkedDocumentOption(
  link: { id: string; label: string | null; date: string | null },
  date: (iso: string) => string,
): EntityLinkOption | null {
  if (link.label === null) return null;
  return {
    id: link.id,
    label: link.label,
    dateLabel: link.date ? date(link.date) : null,
    href: `/documents?doc=${encodeURIComponent(link.id)}`,
  };
}
