"use client";

import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";

import { ReadFailureRow } from "@/components/ui/read-failure-row";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/use-auth";
import { queryKeys } from "@/lib/query-keys";
import { useTranslations } from "@/lib/i18n/context";
import { apiGet } from "@/lib/api/api-fetch";
import { moodTagIcon } from "./mood-tag-icons";
import { selectQuickTagKeys } from "./recent-tags";

/**
 * v1.17.0 — the always-open Quick row at the top of the mood add-sheet.
 *
 * Surfaces the caller's most-recently-used binary tags (falling back to the
 * first catalogue tags on a fresh account) as one-tap chips, so the common
 * case is a face + a couple of familiar taps + Save. A trailing "+" expands
 * the full "More tags" section for everything else.
 *
 * Reads the same `/api/mood/tags` catalogue as `MoodTagPicker` (shared query
 * key → one network round-trip). Renders nothing while the catalogue is
 * empty so a cleared taxonomy degrades gracefully. The loading placeholder
 * stays because the catalogue ships seeded and the row nearly always fills
 * it; a failed read says so with a retry rather than leaving the sheet
 * without its tags and without a word.
 */

interface CatalogTag {
  key: string;
  labelKey: string;
  label?: string | null;
  icon: string | null;
  kind: "BINARY" | "RATED";
}

interface CatalogCategory {
  tags: CatalogTag[];
}

interface CatalogResponse {
  categories: CatalogCategory[];
}

const QUICK_LIMIT = 8;

export function MoodQuickTags({
  selected,
  onToggle,
  recent,
  onExpand,
}: {
  /** Selected binary tag keys (shared with `MoodTagPicker`). */
  selected: string[];
  onToggle: (tagKey: string) => void;
  /** MRU tag keys, most-recent first (from `useRecentTags`). */
  recent: readonly string[];
  /** Opens the full "More tags" section. */
  onExpand: () => void;
}) {
  const { isAuthenticated } = useAuth();
  const { t } = useTranslations();

  const { data, error, isLoading, isError, refetch } = useQuery({
    queryKey: queryKeys.moodTagCatalog(),
    queryFn: async () => apiGet<CatalogResponse>("/api/mood/tags"),
    enabled: isAuthenticated,
    staleTime: 60 * 60 * 1000,
  });

  if (isLoading) {
    return <Skeleton className="h-11 w-full rounded-lg" />;
  }
  if (isError && !data) {
    return (
      <ReadFailureRow
        error={error}
        slot="mood-quick-tags-error"
        message={t("mood.tagCatalogLoadError")}
        onRetry={() => void refetch()}
      />
    );
  }
  if (!data || data.categories.length === 0) return null;

  // Flatten the catalogue to binary tags only; the Quick row never carries
  // rated factors (those live under the "Factors" section).
  const binaryTags = data.categories
    .flatMap((c) => c.tags)
    .filter((tag) => tag.kind !== "RATED");
  if (binaryTags.length === 0) return null;

  const tagByKey = new Map(binaryTags.map((tag) => [tag.key, tag]));
  const catalogKeys = binaryTags.map((tag) => tag.key);
  const selectedSet = new Set(selected);

  // Show the MRU/fallback quick keys, but always include any currently
  // selected key so a tap from the full picker stays visible up here too.
  const quickKeys = selectQuickTagKeys(recent, catalogKeys, QUICK_LIMIT);
  const orderedKeys = [
    ...quickKeys,
    ...selected.filter((k) => tagByKey.has(k) && !quickKeys.includes(k)),
  ];

  return (
    <div className="space-y-1.5" data-slot="mood-quick-tags">
      <p className="text-muted-foreground text-xs">{t("mood.quickTagsHelp")}</p>
      <div className="flex flex-wrap gap-1.5">
        {orderedKeys.map((key) => {
          const tag = tagByKey.get(key);
          if (!tag) return null;
          const TagIcon = moodTagIcon(tag.icon);
          const label = tag.label ?? t(tag.labelKey);
          const isActive = selectedSet.has(key);
          return (
            <button
              key={key}
              type="button"
              onClick={() => onToggle(key)}
              aria-pressed={isActive}
              data-slot="mood-quick-tag"
              className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 py-2 text-xs transition-colors ${
                isActive
                  ? "border-primary bg-primary/15 text-primary"
                  : "border-border/70 bg-muted text-foreground/75 hover:bg-accent hover:text-foreground"
              }`}
            >
              <TagIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {label}
            </button>
          );
        })}
        <button
          type="button"
          onClick={onExpand}
          aria-label={t("mood.quickTagsExpand")}
          title={t("mood.quickTagsExpand")}
          data-slot="mood-quick-tags-expand"
          className="border-border/70 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 inline-flex min-h-11 items-center gap-1 rounded-full border border-dashed px-3 py-2 text-xs transition-colors focus-visible:ring-2 focus-visible:outline-none"
        >
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          {t("mood.quickTagsExpand")}
        </button>
      </div>
    </div>
  );
}
