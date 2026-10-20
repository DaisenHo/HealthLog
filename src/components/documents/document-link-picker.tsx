"use client";

/**
 * "Verknüpfen" — link existing vault documents to an illness episode from
 * the episode's detail page. The shared `DocumentPickerSheet` lists and
 * searches the vault; toggling a row fires the bulk link/unlink action for
 * that single id (idempotent by contract, no-op-success on already-in-state
 * rows) and refreshes every document read through the `["documents"]`
 * prefix.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { showErrorToast } from "@/lib/errors/error-toast";

import { apiPost } from "@/lib/api/api-fetch";
import { useTranslations } from "@/lib/i18n/context";
import { invalidateKeys, queryKeys } from "@/lib/query-keys";
import type { DocumentBulkResultDto } from "@/lib/validations/inbound-documents";
import { DocumentPickerSheet } from "./document-picker-sheet";

export function DocumentLinkPicker({
  episodeId,
  open,
  onOpenChange,
}: {
  episodeId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslations();
  const queryClient = useQueryClient();

  const toggle = useMutation({
    mutationFn: (input: { documentId: string; linked: boolean }) =>
      apiPost<{ results: DocumentBulkResultDto[] }>(
        "/api/documents/inbound/bulk",
        {
          ids: [input.documentId],
          action: input.linked ? "unlinkEpisode" : "linkEpisode",
          episodeId,
        },
      ),
    onSuccess: (data) => {
      if (data.results.some((r) => !r.ok)) {
        showErrorToast(t("documents.bulk.failed"));
      }
    },
    onError: (failure) =>
      showErrorToast(t("documents.bulk.failed"), { cause: failure }),
    onSettled: () => {
      void invalidateKeys(queryClient, [queryKeys.documents()]);
    },
  });

  return (
    <DocumentPickerSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t("documents.linkPicker.title")}
      description={t("documents.linkPicker.description")}
      searchPlaceholder={t("documents.linkPicker.searchPlaceholder")}
      emptyLabel={t("documents.linkPicker.empty")}
      isPicked={(doc) =>
        doc.conditionLinks.some((l) => l.episodeId === episodeId)
      }
      isDisabled={() => toggle.isPending}
      onToggle={(doc, _title, linked) =>
        toggle.mutate({ documentId: doc.id, linked })
      }
    />
  );
}
