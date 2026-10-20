import type { CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight, type LucideIcon } from "lucide-react";

import { Card } from "@/components/ui/card";
import { TileHeader } from "@/components/insights/tile-header";
import { cn } from "@/lib/utils";

/**
 * A whole card that points to another page: the tile header, one meta line,
 * and the call to action. The pulse page's way to VO₂ max and the ECG pointer
 * on the heart pages were two hand-rolled copies of it, one of them without
 * the `md:p-6` step every other card on the page has.
 *
 * The link is the outer element and carries the focus ring; the surface is a
 * `Card`, so padding, radius and shadow are the card contract. The compact
 * card rhythm (`gap-1.5`) keeps the three lines together.
 */
export function CrossLinkCard({
  href,
  slot,
  icon,
  title,
  body,
  cta,
  className,
  cardClassName,
  style,
}: {
  href: string;
  slot: string;
  icon: LucideIcon;
  title: string;
  body: string;
  cta: string;
  className?: string;
  /** Classes on the card surface (an identity edge such as `metric-accent`). */
  cardClassName?: string;
  style?: CSSProperties;
}) {
  return (
    <Link
      href={href}
      data-slot={slot}
      className={cn(
        "group focus-visible:ring-ring/50 block rounded-xl focus-visible:ring-2 focus-visible:outline-none",
        className,
      )}
    >
      <Card
        className={cn(
          "group-hover:bg-accent/40 gap-1.5 px-4 transition-colors md:gap-1.5 md:px-6",
          cardClassName,
        )}
        style={style}
      >
        <TileHeader icon={icon} title={title} />
        <span className="text-muted-foreground block text-xs leading-snug">
          {body}
        </span>
        <span className="text-primary inline-flex shrink-0 items-center gap-1 text-xs font-medium">
          {cta}
          <ArrowRight className="size-4" aria-hidden="true" />
        </span>
      </Card>
    </Link>
  );
}
