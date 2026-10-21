"use client";

/**
 * Settings navigation below `md`: one button naming where the person is, and a
 * bottom sheet listing every section under its group.
 *
 * The phone used to carry every section as a chip in one horizontal strip,
 * more than twenty of them, so most of Settings sat off screen and the groups
 * the desktop sidebar shows were reduced to thin dividers. The sheet shows the
 * same groups and order as the sidebar, one 44 px row per section, and closes
 * on choice. Both read the visible-section list the shell computes, so the
 * module and record filters apply to both alike.
 */

import * as React from "react";
import Link from "next/link";
import { ChevronsUpDown } from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";
import { ResponsiveSheet } from "@/components/ui/responsive-sheet";
import { useTranslations } from "@/lib/i18n/context";

export interface SettingsNavEntry {
  slug: string;
  title: string;
  groupLabel: string;
  icon: LucideIcon;
}

export function SettingsMobileNav({
  entries,
  activeSlug,
}: {
  entries: readonly SettingsNavEntry[];
  activeSlug: string;
}) {
  const { t } = useTranslations();
  const [open, setOpen] = React.useState(false);
  const active = entries.find((entry) => entry.slug === activeSlug);
  const ActiveIcon = active?.icon;

  // Group the flat, pre-ordered list for rendering; the order of first
  // appearance is the group order.
  const groups: { label: string; entries: SettingsNavEntry[] }[] = [];
  for (const entry of entries) {
    const last = groups.at(-1);
    if (last && last.label === entry.groupLabel) last.entries.push(entry);
    else groups.push({ label: entry.groupLabel, entries: [entry] });
  }

  return (
    <nav
      aria-label={t("settings.shell.sectionsNav")}
      className="mb-4 md:hidden"
    >
      <button
        type="button"
        data-slot="settings-mobile-nav-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="border-border bg-card hover:bg-accent focus-visible:ring-ring/50 flex min-h-11 w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
      >
        {ActiveIcon ? (
          <ActiveIcon
            className="text-muted-foreground size-4 shrink-0"
            aria-hidden="true"
          />
        ) : null}
        <span className="min-w-0 flex-1">
          {active ? (
            <span className="text-muted-foreground block text-xs">
              {active.groupLabel}
            </span>
          ) : null}
          <span className="block truncate text-sm font-medium">
            {active?.title ?? t("settings.shell.allSections")}
          </span>
        </span>
        <span className="text-muted-foreground shrink-0 text-xs">
          {t("settings.shell.allSections")}
        </span>
        <ChevronsUpDown
          className="text-muted-foreground size-4 shrink-0"
          aria-hidden="true"
        />
      </button>

      <ResponsiveSheet
        open={open}
        onOpenChange={setOpen}
        title={t("settings.shell.allSections")}
      >
        <div className="space-y-4 pb-2" data-slot="settings-mobile-nav-list">
          {groups.map((group) => (
            <section key={group.label} className="space-y-1">
              <h2 className="text-muted-foreground px-1 text-xs font-medium tracking-wide uppercase">
                {group.label}
              </h2>
              <ul className="space-y-0.5">
                {group.entries.map((entry) => {
                  const isActive = entry.slug === activeSlug;
                  const Icon = entry.icon;
                  return (
                    <li key={entry.slug}>
                      <Link
                        href={`/settings/${entry.slug}`}
                        aria-current={isActive ? "page" : undefined}
                        onClick={() => setOpen(false)}
                        className={cn(
                          "flex min-h-11 items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                          isActive
                            ? "bg-primary/10 text-primary"
                            : "text-foreground hover:bg-accent",
                        )}
                      >
                        <Icon className="size-4 shrink-0" aria-hidden="true" />
                        {entry.title}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </ResponsiveSheet>
    </nav>
  );
}
