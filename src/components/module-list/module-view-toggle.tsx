"use client";

import { LayoutGrid, List as ListIcon } from "lucide-react";

import { useTranslations } from "@/lib/i18n/context";
import { ViewToggle } from "@/components/ui/view-toggle";
import type { ModuleListView } from "@/lib/module-list-prefs";

/**
 * v1.18.6 — icon-only card/list view toggle shared by the
 * Vorsorge / Illness / Labs settings pages. Thin wrapper over the shared
 * `ViewToggle` primitive (mirrors the medication module's
 * `MedicationViewToggle`, which is the same wrapper switching between a
 * card grid and a compact list rather than cards-vs-table).
 */
interface ModuleViewToggleProps {
  view: ModuleListView;
  onChange: (view: ModuleListView) => void;
}

export function ModuleViewToggle({ view, onChange }: ModuleViewToggleProps) {
  const { t } = useTranslations();

  return (
    <ViewToggle
      view={view}
      onChange={onChange}
      groupLabel={t("moduleList.viewToggleLabel")}
      dataSlotPrefix="module-view"
      segments={[
        {
          value: "cards",
          label: t("moduleList.viewCards"),
          icon: LayoutGrid,
        },
        {
          value: "list",
          label: t("moduleList.viewList"),
          icon: ListIcon,
        },
      ]}
    />
  );
}
