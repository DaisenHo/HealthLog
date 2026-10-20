"use client";

import { LayoutGrid, Table as TableIcon } from "lucide-react";

import { useTranslations } from "@/lib/i18n/context";
import { Segmented } from "@/components/ui/segmented";
import type { MedicationListView } from "@/lib/medication-list-layout";

/**
 * v1.16.10 — icon-only card/table view toggle for the /medications page
 * header. Thin wrapper over the shared `Segmented` primitive (icon-only, toggle mode); see its
 * docstring for the interaction grammar.
 */
interface MedicationViewToggleProps {
  view: MedicationListView;
  onChange: (view: MedicationListView) => void;
}

export function MedicationViewToggle({
  view,
  onChange,
}: MedicationViewToggleProps) {
  const { t } = useTranslations();

  return (
    <Segmented
      mode="toggle"
      iconOnly
      value={view}
      onChange={onChange}
      label={t("medications.viewToggleLabel")}
      optionSlot={(value) => `medications-view-${value}`}
      options={[
        {
          value: "cards",
          label: t("medications.viewCards"),
          icon: LayoutGrid,
        },
        {
          value: "table",
          label: t("medications.viewTable"),
          icon: TableIcon,
        },
      ]}
    />
  );
}
