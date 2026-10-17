"use client";

/**
 * The "during an illness" selector of the symptom entry and edit sheets: which
 * illness episode an occurrence is filed against. The link it writes
 * (`SymptomEvent.episodeId`) is the only thing that assigns an occurrence to
 * an illness; the episode detail lists exactly the occurrences filed there.
 *
 * It offers the episodes the server admits at the occurrence's time
 * (`isEpisodeLinkableAt`: open, or resolved with the time inside its span),
 * plus, in the edit sheet, the episode the occurrence is already filed
 * against, because the server keeps an unchanged link even after that
 * episode resolved. Moving the time so the chosen episode no longer fits
 * falls back to "not linked" rather than sending a link the server refuses.
 */
import { FieldGroup } from "@/components/ui/field-group";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { IllnessEpisodeDTO } from "@/components/illness/types";
import { useTranslations } from "@/lib/i18n/context";
import { isEpisodeLinkableAt } from "@/lib/symptoms/shared";

const NO_EPISODE = "none";

type LinkableEpisode = Pick<
  IllnessEpisodeDTO,
  "id" | "label" | "onsetAt" | "resolvedAt"
>;

/**
 * The episodes an occurrence at `occurredAt` (a `DateTimeField` value or an
 * ISO instant) may be filed against, plus `keepId` when it names one of them.
 */
export function linkableEpisodes<T extends LinkableEpisode>(
  episodes: readonly T[],
  occurredAt: string,
  keepId: string | null = null,
): T[] {
  const at = new Date(occurredAt);
  return episodes.filter(
    (episode) =>
      episode.id === keepId ||
      (!Number.isNaN(at.getTime()) && isEpisodeLinkableAt(episode, at)),
  );
}

/**
 * The link to send: `chosen` when it is still among `options`, else none. A
 * choice the time has since moved away from is dropped, not sent.
 */
export function effectiveEpisodeId(
  chosen: string | null,
  options: readonly LinkableEpisode[],
): string | null {
  return chosen !== null && options.some((episode) => episode.id === chosen)
    ? chosen
    : null;
}

export function EpisodeLinkField({
  id,
  value,
  onChange,
  options,
}: {
  id: string;
  /** The effective link (`effectiveEpisodeId`), null for none. */
  value: string | null;
  onChange: (episodeId: string | null) => void;
  /** From `linkableEpisodes`. Renders nothing when empty. */
  options: readonly LinkableEpisode[];
}) {
  const { t } = useTranslations();
  if (options.length === 0) return null;
  return (
    <FieldGroup
      htmlFor={id}
      label={
        <>
          {t("symptoms.entry.during")}
          <span className="text-muted-foreground ml-1 font-normal">
            ({t("common.optional")})
          </span>
        </>
      }
    >
      <Select
        value={value ?? NO_EPISODE}
        onValueChange={(next) => onChange(next === NO_EPISODE ? null : next)}
      >
        <SelectTrigger
          id={id}
          className="w-full"
          data-testid="symptom-episode-select"
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_EPISODE}>
            {t("symptoms.entry.duringNone")}
          </SelectItem>
          {options.map((episode) => (
            <SelectItem key={episode.id} value={episode.id}>
              {episode.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldGroup>
  );
}
