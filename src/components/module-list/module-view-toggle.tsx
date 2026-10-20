"use client";

import { LayoutGrid, List as ListIcon } from "lucide-react";

import { useTranslations } from "@/lib/i18n/context";
import { Segmented } from "@/components/ui/segmented";
import type { ModuleListView } from "@/lib/module-list-prefs";

/**
 * v1.18.6 — icon-only card/list view toggle shared by the
 * Vorsorge / Illness / Labs settings pages. Thin wrapper over the shared
 * `Segmented` primitive, icon-only (mirrors the medication module's
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
    <Segmented
      mode="toggle"
      iconOnly
      value={view}
      onChange={onChange}
      label={t("moduleList.viewToggleLabel")}
      optionSlot={(value) => `module-view-${value}`}
      options={[
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
