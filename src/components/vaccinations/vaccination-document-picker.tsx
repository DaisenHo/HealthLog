"use client";

/**
 * The from-the-record document link: attach the scanned page a dose was
 * transcribed from. The shared {@link EntityLinkPicker} — an inline summary
 * (removable chips + an add button) over a searchable, month-grouped sheet.
 *
 * The whole vault is reachable, not only the pages dated near the dose: one
 * childhood record commonly covers a dozen doses given years apart, and it
 * belongs on every one of them. The picker opens on the pages around the
 * dose's date, the ones within the upload suggestion's window on top as
 * suggestions, and pages older and newer or searches the vault from there.
 *
 * **The gate blanks the block, it does not post-filter it.** When the
 * `inboundDocuments` module is off, this renders nothing — no heading, no empty
 * list — because an empty picker for a switched-off module advertises a feature
 * that is not there. The same shape the visit form's link pickers use.
 *
 * Nothing here can block a save: the list starts empty and stays valid empty,
 * and linking is optional, capped and idempotent behind the link facade.
 *
 * On an edit the selection is what the dose is filed against on the server,
 * read from the dose's detail route; the block waits for that read rather
 * than showing an empty set, which would both hide the links and offer to
 * save their removal.
 */
import { useMemo } from "react";
import { FolderOpen } from "lucide-react";

import { useFormatters, useTranslations } from "@/lib/i18n/context";
import { EntityLinkPicker } from "@/components/links/entity-link-picker";
import {
  linkedDocumentOption,
  useVaultDocumentOptions,
} from "@/components/links/vault-document-options";
import { ImportFromSourceButton } from "@/components/documents/sources/import-from-source-button";
import { mergeIds } from "@/components/documents/sources/merge-ids";

export function VaccinationDocumentPicker({
  enabled,
  anchor,
  documentIds,
  linkedDocuments,
  seedPending = false,
  seedError = false,
  onRetrySeed,
  onChange,
}: {
  /** The `inboundDocuments` module flag — false blanks the block entirely. */
  enabled: boolean;
  /** The dose's own date (ISO), for the suggestions on top. */
  anchor: string | null;
  documentIds: string[];
  /**
   * The pages the dose is filed against, as its own read names them, so their
   * chips show whatever part of the vault is loaded.
   */
  linkedDocuments?: ReadonlyArray<{
    id: string;
    label: string | null;
    date: string | null;
  }>;
  /** The dose's own links are still loading. */
  seedPending?: boolean;
  /** Reading the dose's own links failed. */
  seedError?: boolean;
  onRetrySeed?: () => void;
  onChange: (documentIds: string[]) => void;
}) {
  const { t } = useTranslations();
  const format = useFormatters();
  const vault = useVaultDocumentOptions({ enabled, anchor });
  const known = useMemo(
    () =>
      (linkedDocuments ?? [])
        .map((link) => linkedDocumentOption(link, (iso) => format.date(iso)))
        .filter((option) => option !== null),
    [linkedDocuments, format],
  );

  if (!enabled) return null;

  return (
    <div className="border-t pt-4" data-slot="vaccination-document-picker">
      <EntityLinkPicker
        icon={FolderOpen}
        title={t("vaccinations.form.linkDocuments")}
        slot="vaccination-document"
        pending={vault.pending || seedPending}
        error={vault.error || seedError}
        errorLabel={t("links.picker.loadError")}
        onRetry={() => {
          if (vault.error) vault.retry();
          if (seedError) onRetrySeed?.();
        }}
        selected={documentIds}
        onChange={onChange}
        options={vault.options}
        server={vault.server}
        knownOptions={known}
        searchPlaceholder={t("links.picker.searchPlaceholder")}
        emptyLabel={t("vaccinations.form.linkNothingToOffer")}
        extraAction={
          // Joins the form's selection; the dose's save writes the links.
          <ImportFromSourceButton
            className="min-h-9"
            kind="VACCINATION"
            onImported={(ids) => onChange(mergeIds(documentIds, ids))}
          />
        }
      />
    </div>
  );
}
