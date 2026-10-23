"use client";

import { ChevronDown, Pencil } from "lucide-react";

import { DeleteButton } from "@/components/data-list";
import { Button } from "@/components/ui/button";
import { useTranslations } from "@/lib/i18n/context";

import { MEASUREMENT_TYPE_LABEL_KEYS as TYPE_LABEL_KEYS } from "../measurement-list-meta";

import type { Measurement } from "./list-model";

type Translate = ReturnType<typeof useTranslations>["t"];

/** A type's name, or the raw type for one the catalogue does not know. */
export function typeLabel(type: string, t: Translate): string {
  return TYPE_LABEL_KEYS[type] ? t(TYPE_LABEL_KEYS[type]) : type;
}

/**
 * A row's controls: the chevron into a day's or night's samples for a
 * grouped row; edit (owner only) and delete for a reading. The table's
 * buttons are 40 px, the phone list's the large icon size.
 */
export function MeasurementRowActions({
  m,
  isGrouped,
  isExpanded,
  drilldownId,
  canManage,
  layout,
  toggleExpand,
  startEdit,
  onDelete,
}: {
  m: Measurement;
  isGrouped: boolean;
  isExpanded: boolean;
  drilldownId: string;
  canManage: boolean;
  layout: "desktop" | "mobile";
  toggleExpand: (dayKey: string) => void;
  startEdit: (m: Measurement) => void;
  onDelete: (id: string) => void;
}) {
  const { t } = useTranslations();
  const desktop = layout === "desktop";
  const size = desktop ? "icon" : "icon-lg";
  const className = desktop ? "h-10 w-10" : undefined;
  return isGrouped ? (
    <Button
      variant="ghost"
      size={size}
      className={className}
      data-testid="measurement-day-expand"
      onClick={() => toggleExpand(m.dayKey as string)}
      aria-expanded={isExpanded}
      aria-controls={drilldownId}
      aria-label={
        isExpanded ? t("measurements.collapseDay") : t("measurements.expandDay")
      }
    >
      <ChevronDown
        className={`h-4 w-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
      />
    </Button>
  ) : (
    <>
      {canManage && (
        <Button
          variant="ghost"
          size={size}
          className={className}
          onClick={() => startEdit(m)}
          aria-label={t("common.edit")}
        >
          <Pencil className={desktop ? "h-3.5 w-3.5" : "h-4 w-4"} />
        </Button>
      )}
      <DeleteButton
        domain="measurements"
        iconClassName={desktop ? undefined : "h-4 w-4"}
        onConfirm={() => onDelete(m.id)}
        title={t("measurements.deleteConfirmTitle")}
        description={t("measurements.deleteConfirmDescription")}
      />
    </>
  );
}
