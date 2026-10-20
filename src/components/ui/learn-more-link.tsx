"use client";

import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";

import { learnLinkForMetric, learnUrl } from "@/lib/learn-links";
import { useTranslations } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/**
 * v1.21.0 — discreet "Learn more" pointer to a public /learn guide.
 *
 * One small, calm anchor (no new colour, no card chrome) that links a concept
 * out to its plain-language guide. Fail-closed by construction:
 *
 *   - the href is resolved through `learnLinkForMetric` — a closed-set,
 *     registry-backed URL, never user/model content — so there is no XSS
 *     surface and no invented link;
 *   - an unmapped concept resolves to `null` and the component renders
 *     nothing, so a surface that wires a concept with no guide simply shows
 *     no pointer rather than a broken one.
 *
 * It is a literal `<a>` (no markdown library): `target="_blank"` with
 * `rel="noopener noreferrer"`, the guide title as the accessible label.
 */
export interface LearnMoreLinkProps {
  /**
   * A `LearnConcept` key (or any metric id) to resolve. Anything unmapped
   * renders nothing.
   */
  concept: string;
  className?: string;
}

export function LearnMoreLink({ concept, className }: LearnMoreLinkProps) {
  const { t } = useTranslations();
  const guide = learnLinkForMetric(concept);
  if (guide == null) return null;

  const label = t("common.learnMore");

  return (
    <a
      href={guide.url}
      target="_blank"
      rel="noopener noreferrer"
      data-slot="learn-more-link"
      aria-label={`${label}: ${guide.title}`}
      className={cn(
        "text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs underline-offset-2 transition-colors hover:underline",
        className,
      )}
    >
      {label}
      <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
    </a>
  );
}

/**
 * v1.22 — inline, catalog-whitelisted Learn anchor for AI prose.
 *
 * Where `LearnMoreLink` resolves a *concept* to its guide for a deterministic
 * UI surface, this variant linkifies a `/learn/<slug>` reference that already
 * appears in trusted prose (the Coach reply, post-filtered server-side by
 * `scrubUnknownLearnLinks`). The slug is resolved through `learnUrl` — the same
 * closed-set, registry-backed builder — so an unknown slug renders the children
 * as plain text (fail-closed): a drifted post-filter can never produce a
 * clickable invented href, and there is no markdown / HTML parsing involved.
 *
 * The visible label is the caller's `children` (the original URL text), keeping
 * the reference verbatim; the safe attributes (`target="_blank"`,
 * `rel="noopener noreferrer"`) mirror `LearnMoreLink`.
 */
export interface InlineLearnLinkProps {
  /** The `/learn/<slug>` path segment to resolve and link. */
  slug: string;
  /** Visible anchor text (typically the matched URL substring). */
  children: ReactNode;
  className?: string;
}

export function InlineLearnLink({
  slug,
  children,
  className,
}: InlineLearnLinkProps) {
  const url = learnUrl(slug);
  if (url == null) return <>{children}</>;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      data-slot="inline-learn-link"
      className={cn(
        "text-primary underline decoration-from-font underline-offset-2 hover:no-underline",
        className,
      )}
    >
      {children}
    </a>
  );
}
