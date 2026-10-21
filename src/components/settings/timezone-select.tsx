"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { toastWrittenOutcome } from "@/components/outcome/outcome-toast";
import { resolveInitialTimezone } from "@/components/settings/account-section/account-section-utils";
import { TimezonePicker } from "@/components/settings/timezone-picker";
import { InlineAction } from "@/components/ui/inline-action";
import { useAuth } from "@/hooks/use-auth";
import { useMounted } from "@/hooks/use-mounted";
import { apiFetchRaw } from "@/lib/api/api-fetch";
import { showErrorToast } from "@/lib/errors/error-toast";
import { useTranslations } from "@/lib/i18n/context";
import { queryKeys } from "@/lib/query-keys";
import { storeTimezone } from "@/lib/timezone-mirror";
import { DEFAULT_TIMEZONE, detectBrowserTimezone } from "@/lib/tz/format";

/**
 * The profile timezone as a Display preference: it saves the moment it
 * changes, like the language, units and formats beside it.
 *
 * Until v1.44 it sat in the profile form and waited for that form's Save,
 * which made it the one display preference that did not take effect on
 * change. Persistence is unchanged (`PUT /api/auth/me/timezone`, the route
 * that owns the IANA validation). The local mirror is written on success so
 * every rendered timestamp repaints in the same tab before the `/me`
 * refetch confirms it (issue #490).
 *
 * The select shows the stored zone: a value on screen is a value that is
 * saved. The form used to pre-fill the device's zone over the untouched
 * default and save it with the next profile save; that suggestion stays,
 * as a one-tap offer under the select (`resolveInitialTimezone` decides
 * when), instead of an unsaved value dressed as the current one.
 */
export function TimezoneSelect({
  isAuthenticated,
}: {
  isAuthenticated: boolean;
}) {
  const { t } = useTranslations();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [optimistic, setOptimistic] = useState<string | null>(null);

  const value = optimistic ?? user?.timezone ?? DEFAULT_TIMEZONE;

  const mutation = useMutation({
    mutationFn: async (next: string) => {
      const res = await apiFetchRaw("/api/auth/me/timezone", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ timezone: next }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return next;
    },
    onSuccess: (next) => {
      storeTimezone(next);
      toastWrittenOutcome("success", t("settings.timezoneSaved"));
      void queryClient.invalidateQueries({ queryKey: queryKeys.authMe() });
      setOptimistic(null);
    },
    onError: (err) => {
      setOptimistic(null);
      showErrorToast(t("settings.timezoneInvalid"), { cause: err });
    },
  });

  function handleChange(next: string) {
    if (next === value || mutation.isPending || !isAuthenticated) return;
    setOptimistic(next);
    mutation.mutate(next);
  }

  // The device zone is read after hydration so both renders agree.
  const mounted = useMounted();
  const suggestion = mounted
    ? resolveInitialTimezone(user?.timezone, detectBrowserTimezone())
    : value;

  return (
    <div className="space-y-1">
      <TimezonePicker value={value} onChange={handleChange} />
      {suggestion !== value && optimistic === null ? (
        <InlineAction
          tone="primary"
          size="xs"
          data-slot="timezone-use-device"
          disabled={mutation.isPending || !isAuthenticated}
          onClick={() => handleChange(suggestion)}
        >
          {t("settings.timezoneUseDevice", { zone: suggestion })}
        </InlineAction>
      ) : null}
    </div>
  );
}
