"use client";

import type { ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useReadFailure } from "@/hooks/use-read-failure";
import { cn } from "@/lib/utils";

/**
 * Read-failure card for list / data surfaces.
 *
 * Mirrors `<ChartErrorState>`'s shape + tone (AlertTriangle, a title line, a
 * muted description, an optional Retry button) but renders inside a `Card` so
 * a list page can tell "load failed" apart from an honest empty state — a
 * failed query must never fall through to the "no data yet" copy. Defaults are
 * the generic `common.*` strings so a caller can drop it in with just
 * `onRetry`; a surface with its own "couldn't load X" string passes it through
 * `title` / `description`.
 *
 * The card reads the failure itself (`error`), exactly as `QueryErrorRow`
 * does: a refusal draws `refused` (nothing by default), a spent budget says
 * so without a retry, an ended session offers sign-in, and only a real
 * failure shows `title` / `description` with `onRetry`.
 */
export function QueryErrorCard({
  error,
  refused = null,
  title,
  description,
  onRetry,
  retryLabel,
  className,
}: {
  /** The query's error. It decides what the card offers. */
  error: unknown;
  /** What a refused (403) read draws instead of the card. */
  refused?: ReactNode;
  title?: ReactNode;
  description?: ReactNode;
  onRetry?: () => void;
  retryLabel?: string;
  className?: string;
}) {
  const failure = useReadFailure(error, { message: title, onRetry });
  if (!failure) return <>{refused}</>;
  const { action } = failure;
  // The description belongs to a real failure; a spent budget or an ended
  // session replaces the title, and the surface's own detail would not fit.
  const detail = failure.kind === "failed" ? description : null;
  return (
    <Card data-slot="query-error-card" className={cn(className)}>
      <CardContent
        role="alert"
        className="flex flex-col items-center justify-center gap-3 px-6 py-10 text-center"
      >
        <AlertTriangle
          className="text-muted-foreground h-8 w-8"
          aria-hidden="true"
        />
        <p className="text-sm font-medium">{failure.message}</p>
        {detail ? (
          <p className="text-muted-foreground text-sm">{detail}</p>
        ) : null}
        {action?.kind === "retry" ? (
          // The slot is the accessibility suite's handle on the one control
          // this card offers: the error state has to be recoverable by
          // keyboard, and asserting that against viewport text would pin the
          // copy instead of the affordance.
          <Button
            data-slot="query-error-retry"
            variant="outline"
            size="sm"
            onClick={action.onClick}
          >
            <RotateCw className="h-3.5 w-3.5" aria-hidden="true" />
            {retryLabel ?? action.label}
          </Button>
        ) : action ? (
          <Button
            data-slot="query-error-sign-in"
            variant="outline"
            size="sm"
            onClick={action.onClick}
          >
            {action.label}
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}
