"use client";

import type { RefObject } from "react";
import Link from "next/link";
import { Upload, Wrench } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useTranslations } from "@/lib/i18n/context";

import { ImportFromSourceButton } from "../sources/import-from-source-button";

/**
 * The page header's actions (rendered only when one of them applies): the display-settings wrench (the caller's own
 * settings, so never inside somebody else's record), the source import and
 * the upload button, which an empty vault's empty state carries instead.
 */
export function VaultPageActions({
  canManageDocuments,
  inSharedRecord,
  hideUpload,
  uploadInputRef,
}: {
  canManageDocuments: boolean;
  inSharedRecord: boolean;
  hideUpload: boolean;
  uploadInputRef: RefObject<HTMLInputElement | null>;
}) {
  const { t } = useTranslations();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* The wrench left of the primary action, as on the illness
        journal: it opens this vault's display settings. `/settings`
        is the caller's own, so it never shows inside somebody
        else's record. */}
      {!inSharedRecord ? (
        <Button
          asChild
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11 sm:min-h-9 sm:min-w-9"
        >
          <Link
            href="/settings/layout/documents"
            aria-label={t("documents.customize")}
            title={t("documents.customize")}
            data-slot="documents-customize"
          >
            <Wrench className="size-4" aria-hidden />
          </Link>
        </Button>
      ) : null}
      {canManageDocuments ? (
        <>
          {/* Renders only with a connected Paperless-ngx or Papra. */}
          <ImportFromSourceButton className="min-h-11 sm:min-h-9" />
          {/* An empty vault's empty state carries the upload. */}
          {hideUpload ? null : (
            <Button
              className="min-h-11 sm:min-h-9"
              onClick={() => uploadInputRef.current?.click()}
            >
              <Upload className="size-4" aria-hidden />
              {t("documents.pageUpload")}
            </Button>
          )}
        </>
      ) : null}
    </div>
  );
}
