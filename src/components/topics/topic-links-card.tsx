"use client";

import Link from "next/link";
import { ChevronRight, Info, Lightbulb } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { TileHeader } from "@/components/insights/tile-header";
import { useRecordCapabilities } from "@/hooks/use-record-capabilities";
import { useTranslations } from "@/lib/i18n/context";
import type { TopicDetail } from "@/lib/topics/build";

import { TOPIC_EXTRA_HREF, topicSourcesKey } from "./topic-meta";
import { useSignalFormat } from "./use-signal-format";

interface PageLink {
  href: string;
  label: string;
  value: string | null;
}

/**
 * The single-metric pages behind the topic, unchanged and one tap away: a
 * topic is an overview, never a replacement for any of them.
 */
export function TopicLinksCard({ detail }: { detail: TopicDetail }) {
  const { t } = useTranslations();
  const format = useSignalFormat();
  const links: PageLink[] = [];
  const seen = new Set<string>();
  const add = (link: PageLink) => {
    if (seen.has(link.href)) return;
    seen.add(link.href);
    links.push(link);
  };
  for (const signal of detail.signals) {
    if (!signal.href || !signal.latest) continue;
    add({
      href: signal.href,
      label: format.label(signal.key),
      value: format.value(signal.key, signal.latest.value),
    });
  }
  if (detail.labs) {
    add({ href: TOPIC_EXTRA_HREF.labs, label: t("nav.labs"), value: null });
  }
  if (detail.training?.status === "ok") {
    add({
      href: TOPIC_EXTRA_HREF.training,
      label: t("topics.links.workouts"),
      value: null,
    });
  }
  if (links.length === 0) return null;

  return (
    <Card data-slot="topic-links">
      <CardHeader>
        <TileHeader
          icon={Lightbulb}
          titleAs="h2"
          title={t("topics.links.title")}
        />
      </CardHeader>
      <CardContent>
        <ul className="divide-border flex flex-col divide-y">
          {links.map((link) => (
            <li key={link.href}>
              <Link
                href={link.href}
                data-slot="topic-link"
                className="hover:bg-accent/40 focus-visible:ring-ring/50 flex min-h-11 items-center gap-3 rounded-md py-2 transition-colors focus-visible:ring-2 focus-visible:outline-none"
              >
                <span className="min-w-0 flex-1 text-sm font-medium">
                  {link.label}
                </span>
                {link.value ? (
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {link.value}
                  </span>
                ) : null}
                <ChevronRight
                  className="text-muted-foreground size-4 shrink-0"
                  aria-hidden="true"
                />
              </Link>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

/**
 * What the topic could show but holds nothing for yet, and where such values
 * come from. Never a zero, never an empty chart.
 */
export function TopicMissingCard({ detail }: { detail: TopicDetail }) {
  const { t } = useTranslations();
  const format = useSignalFormat();
  const { inSharedRecord } = useRecordCapabilities();
  if (detail.missing.length === 0) return null;
  return (
    <Card
      data-slot="topic-missing"
      className="border-dashed shadow-none"
      density="compact"
    >
      <CardContent className="flex flex-col gap-2">
        <p className="flex items-start gap-2 text-sm font-medium">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>
            {t("topics.missing.title", {
              signals: detail.missing.map((k) => format.label(k)).join(", "),
            })}
          </span>
        </p>
        <p className="text-muted-foreground text-xs">
          {t(topicSourcesKey(detail.key))}
        </p>
        {inSharedRecord ? null : (
          <Button asChild variant="outline" size="sm" className="self-start">
            <Link href="/settings/integrations">
              {t("topics.missing.connect")}
            </Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
