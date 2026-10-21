"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/ui/confirm-button";
import { Button } from "@/components/ui/button";
import { SettingsCardActions } from "@/components/settings/_card-actions";
import { SettingsCard } from "@/components/settings/settings-card";
import { SettingsCardHeader } from "@/components/settings/_card-header";
import { useTranslations } from "@/lib/i18n/context";
import { apiFetchRaw } from "@/lib/api/api-fetch";
import {
  recentProofErrorMessage,
  throwIfReproofRequired,
  useRecentProof,
} from "@/components/settings/security-section/use-recent-proof";
import { loadDocument } from "@/lib/navigation/load-document";

/**
 * Settings → Advanced.
 *
 * v1.4.16: every export path (CSV, JSON, doctor-report PDF)
 * moved out into the dedicated `<ExportSection>` under `/settings/export`.
 * What stays here is the irreversible danger-zone — the "wipe all my
 * data" surface that should never live next to a single-click export
 * button.
 *
 * v1.4.25 added a Research Mode opt-in here, gating the estimated GLP-1
 * drug-level curve behind an acknowledged disclaimer version. The chart
 * stopped reading the flag some releases ago and has painted for everyone
 * since, so the toggle governed nothing: flipping it off changed no screen.
 * The curve is simply part of the medication page now, and the switch, its
 * acknowledgment dialog, the endpoint behind it and the three user columns
 * it stamped are gone. This page is the destructive controls.
 */
export function AdvancedSection() {
  // v1.18.6 — the visible heading + subtitle now come from the shared
  // `<SettingsSectionFrame>` in the route; this body is the advanced cards.
  // v1.18.6.1 — the guided tour replay card was removed: the tour now exists
  // only as the first-time auto-start after onboarding. This page is the
  // data/account destructive controls.
  return (
    <div className="space-y-6">
      <DataResetCard />
      <AccountDeleteCard />
    </div>
  );
}

function DataResetCard() {
  const { t } = useTranslations();
  const queryClient = useQueryClient();
  const recentProof = useRecentProof({
    description: t("settings.reproof.descriptionChange"),
  });
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgType, setMsgType] = useState<"success" | "error" | null>(null);

  async function handleDeleteAllData() {
    if (deleting) return;
    setDeleting(true);
    setMsg(null);
    setMsgType(null);
    try {
      // An account with a second factor wipes its record only with that
      // factor proved within five minutes; the shared dialog collects it when
      // the server asks and the wipe is sent again.
      const res = await recentProof.run(async () =>
        throwIfReproofRequired(
          await apiFetchRaw("/api/settings/data", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirm: "DELETE" }),
          }),
        ),
      );
      const json = await res.json();
      if (!res.ok) {
        setMsg(json.error || t("settings.dangerZoneDeleteFailed"));
        setMsgType("error");
        return;
      }

      await queryClient.invalidateQueries();
      setMsg(t("settings.dangerZoneSuccess"));
      setMsgType("success");
      setConfirmOpen(false);
    } catch (err) {
      const message = recentProofErrorMessage(
        err,
        t("settings.dangerZoneDeleteFailed"),
      );
      if (message === null) return;
      setMsg(message);
      setMsgType("error");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <SettingsCard data-slot="settings-data-reset-card">
      {recentProof.dialog}
      {/* v1.4.43 — dropped the `AlertTriangle` icon and
          neutralised the title colour so the danger-zone shaping is
          GitHub-style (red CTA only) rather than red-on-red-on-red.
          The protective gate (confirmation dialog) is unchanged; this
          is purely a visual-tone fix per the v1.4.43 audit. */}
      <SettingsCardHeader
        anchor="danger-zone"
        icon={Trash2}
        title={t("settings.dangerZone")}
        description={t("settings.dangerZoneDescription")}
      />
      <p className="text-sm">{t("settings.dangerZoneDetail")}</p>

      {msg && (
        <p
          role="alert"
          className={`text-sm ${msgType === "success" ? "text-success" : "text-destructive"}`}
        >
          {msg}
        </p>
      )}
      <SettingsCardActions>
        <Button
          type="button"
          onClick={() => setConfirmOpen(true)}
          variant="destructive"
          size="sm"
          disabled={deleting}
          className="min-h-11 w-full shrink-0 sm:min-h-9 sm:w-auto"
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
          {t("settings.dangerZone")}
        </Button>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={(open) => {
            // Hold the dialog open while the request runs so the pending
            // state stays on screen and a stray dismissal cannot fire it twice.
            if (deleting) return;
            setConfirmOpen(open);
          }}
          title={t("settings.dangerZoneConfirm")}
          body={t("settings.dangerZoneConfirmDescription")}
          confirmLabel={t("settings.finalDelete")}
          onConfirm={() => void handleDeleteAllData()}
          pending={deleting}
          slot="settings-data-reset"
          holdOpen
          destructive
        />
      </SettingsCardActions>
    </SettingsCard>
  );
}

/**
 * v1.4.43 — separate destructive action for the full account
 * delete. Pre-fix, the only "danger zone" CTA wiped the user's health
 * data but left the user row, passkeys, audit log, and sessions
 * intact — half of what a user reading "Danger Zone" expects per
 * GDPR Article 17. The route `DELETE /api/settings/account` already
 * cascades User + passkeys + audit log + sessions (and is rate-limited
 * by the API handler); this card is its UI front door.
 *
 * Visually the card mirrors the data-reset shaping (neutral title,
 * red CTA only) but the dialog copy is explicit: this deletes the
 * account, not just the data, and the user will be signed out
 * immediately.
 */
function AccountDeleteCard() {
  const { t } = useTranslations();
  const recentProof = useRecentProof({
    description: t("settings.reproof.descriptionChange"),
  });
  const [deleting, setDeleting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [msgType, setMsgType] = useState<"success" | "error" | null>(null);

  async function handleDeleteAccount() {
    if (deleting) return;
    setDeleting(true);
    setMsg(null);
    setMsgType(null);
    try {
      // Same gate as the wipe: a second factor proved within five minutes on
      // an account that has one, collected by the shared dialog.
      const res = await recentProof.run(async () =>
        throwIfReproofRequired(
          await apiFetchRaw("/api/settings/account", {
            method: "DELETE",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ confirm: "DELETE_ACCOUNT" }),
          }),
        ),
      );
      if (!res.ok) {
        try {
          const json = await res.json();
          setMsg(json.error || t("settings.deleteAccountFailed"));
        } catch {
          setMsg(t("settings.deleteAccountFailed"));
        }
        setMsgType("error");
        setDeleting(false);
        return;
      }
      setMsg(t("settings.deleteAccountSuccess"));
      setMsgType("success");
      // The route destroyed every session before deleting the row;
      // give the toast a beat to paint, then bounce to the login page.
      // Leave `deleting` set so the confirm button keeps its pending
      // state through the redirect — the row is gone, nothing to undo.
      setTimeout(() => {
        loadDocument("/auth/login");
      }, 1_500);
    } catch (err) {
      setDeleting(false);
      const message = recentProofErrorMessage(
        err,
        t("settings.deleteAccountFailed"),
      );
      if (message === null) return;
      setMsg(message);
      setMsgType("error");
    }
  }

  return (
    <SettingsCard data-slot="settings-account-delete-card">
      {recentProof.dialog}
      <SettingsCardHeader
        anchor="delete-account"
        icon={Trash2}
        title={t("settings.deleteAccountCardTitle")}
        description={t("settings.deleteAccountCardDescription")}
      />
      <p className="text-sm">{t("settings.deleteAccountCardDetail")}</p>

      {msg && (
        <p
          role="alert"
          className={`text-sm ${msgType === "success" ? "text-success" : "text-destructive"}`}
        >
          {msg}
        </p>
      )}
      <SettingsCardActions>
        <Button
          type="button"
          onClick={() => setConfirmOpen(true)}
          variant="destructive"
          size="sm"
          disabled={deleting}
          className="min-h-11 w-full shrink-0 sm:min-h-9 sm:w-auto"
          data-slot="settings-account-delete-trigger"
        >
          {deleting ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
          {t("settings.deleteAccountCta")}
        </Button>
        <ConfirmDialog
          open={confirmOpen}
          onOpenChange={(open) => {
            // Hold the dialog open while the request runs so the pending
            // state stays on screen and a stray dismissal cannot fire it twice.
            if (deleting) return;
            setConfirmOpen(open);
          }}
          title={t("settings.deleteAccountConfirmTitle")}
          body={t("settings.deleteAccountConfirmDescription")}
          confirmLabel={t("settings.deleteAccountFinal")}
          onConfirm={() => void handleDeleteAccount()}
          pending={deleting}
          slot="settings-account-delete"
          holdOpen
          destructive
        />
      </SettingsCardActions>
    </SettingsCard>
  );
}
