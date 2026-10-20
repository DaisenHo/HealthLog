"use client";

import { Component, type ReactElement, type ReactNode } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useReadFailure } from "@/hooks/use-read-failure";
import { useTranslations } from "@/lib/i18n/context";
import { cn } from "@/lib/utils";

/**
 * Error-state card + per-chart error boundary.
 *
 * Two failure classes used to look like something else:
 *   - A failed data query fell into the "no data in this range" empty
 *     state (the queries swallowed per-type failures as empty success),
 *     so an outage read as "you have no measurements".
 *   - A rejected lazy chunk import (stale shell after a deploy) bubbled
 *     to the route-level `error.tsx` and replaced the WHOLE page.
 *
 * `<ChartErrorState>` is the shared presentational card — same dashed
 * footprint as `<ChartEmptyState>` so the dashboard layout never
 * reflows — with a compact action button. `<ChartErrorBoundary>` wraps
 * each lazy chart mount so a failed chunk degrades to one card with a
 * reload affordance instead of taking the page down.
 *
 * Like `QueryErrorCard` and `QueryErrorRow`, the card reads the failure
 * itself (`error`): a refusal draws `refused` (nothing by default), a spent
 * budget says so without an action, an ended session offers sign-in, and only
 * a real failure offers `onAction`.
 */

export interface ChartErrorStateProps {
  /** The failure. It decides what the card offers. */
  error: unknown;
  /** What a refused (403) read draws instead of the card. */
  refused?: ReactNode;
  /** Translated headline, e.g. "Data could not be loaded". */
  title: string;
  /** Translated action-button label, e.g. "Retry". */
  actionLabel: string;
  /** Action handler — query `refetch` or a full page reload. */
  onAction: () => void;
  /**
   * Optional explicit height in pixels for mini / mounted-in-a-strip
   * contexts. Absent, the card sizes through the same
   * `--chart-height` / `--chart-height-md` variables the painted chart
   * reads, so a per-mount override resizes the error card too.
   */
  height?: number;
  /**
   * Optional translated context (usually the chart title). Joins the
   * action label into the button's accessible name so several retry
   * buttons on one page stay distinguishable for screen-reader users.
   */
  actionContext?: string;
  /**
   * Live-region semantics. `status` (default) announces politely when
   * a data query fails inside an otherwise healthy card; the chunk
   * boundary fallback passes `alert` because the surrounding chart is
   * gone entirely.
   */
  role?: "status" | "alert";
}

export function ChartErrorState({
  error,
  refused = null,
  title,
  actionLabel,
  onAction,
  height,
  actionContext,
  role = "status",
}: ChartErrorStateProps): ReactElement {
  const failure = useReadFailure(error, { message: title, onRetry: onAction });
  if (!failure) return <>{refused}</>;
  const { action } = failure;
  const label = action?.kind === "retry" ? actionLabel : action?.label;
  return (
    <div
      data-slot="chart-error-state"
      role={role}
      className={cn(
        "border-border/40 bg-muted/10 text-muted-foreground flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 text-center",
        height === undefined &&
          "h-[var(--chart-height,240px)] md:h-[var(--chart-height-md,280px)]",
      )}
      style={height === undefined ? undefined : { height }}
    >
      <AlertTriangle
        className="text-muted-foreground size-6"
        aria-hidden="true"
      />
      <p className="text-sm font-medium">{failure.message}</p>
      {action ? (
        <Button
          variant="outline"
          size="sm"
          onClick={action.onClick}
          data-slot={
            action.kind === "signIn" ? "query-error-sign-in" : undefined
          }
          aria-label={actionContext ? `${label}: ${actionContext}` : undefined}
        >
          {action.kind === "retry" ? (
            <RotateCw className="size-3.5" aria-hidden="true" />
          ) : null}
          {label}
        </Button>
      ) : null}
    </div>
  );
}

interface BoundaryProps {
  /** Drawn once caught; a function receives the caught error. */
  fallback: ReactNode | ((error: Error) => ReactNode);
  children: ReactNode;
  /** Called once the boundary has caught, after the fallback commits. */
  onError?: (error: Error) => void;
}

interface BoundaryState {
  error: Error | null;
}

/** Exported for its unit test; mount `<ChartErrorBoundary>` instead. */
export class ChartBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    // Surface to the client-side error tracker the same way the
    // route-level boundary does — the card degrades quietly but the
    // failure still lands in monitoring.
    if (typeof window !== "undefined") {
      const g = window as typeof window & {
        __healthlog_onError?: (err: Error) => void;
      };
      g.__healthlog_onError?.(error);
    }
    this.props.onError?.(error);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const { fallback } = this.props;
    return typeof fallback === "function" ? fallback(error) : fallback;
  }
}

/**
 * Per-card boundary for lazy chart mounts. A chunk that still rejects
 * after the `importWithRetry` attempt (see `src/lib/retry-import.ts`)
 * renders this card instead of bubbling to the route boundary; the
 * reload affordance fetches the fresh shell + chunk graph (a rejected
 * lazy import is cached, so a remount alone cannot recover).
 */
export function ChartErrorBoundary({
  children,
  onError,
}: {
  children: ReactNode;
  /**
   * Lets the page settle anything that waited on the chart: a stat strip
   * that holds its cells for the chart's window would otherwise wait for a
   * report the failed chart can never send.
   */
  onError?: (error: Error) => void;
}): ReactElement {
  const { t } = useTranslations();
  return (
    <ChartBoundary
      onError={onError}
      fallback={(error) => (
        // Wrapped in the chart-card shell so a chunk failure renders
        // as one solid card among the other cards, not a bare dashed
        // box; `role="alert"` because the whole chart is gone, not
        // just its data.
        <div
          data-slot="chart-error-boundary-card"
          className="bg-card border-border rounded-xl border p-4 md:p-6"
        >
          <ChartErrorState
            error={error}
            title={t("charts.loadErrorTitle")}
            actionLabel={t("charts.loadErrorReload")}
            onAction={() => window.location.reload()}
            role="alert"
          />
        </div>
      )}
    >
      {children}
    </ChartBoundary>
  );
}
