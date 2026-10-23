"use client";

import { useAuth } from "@/hooks/use-auth";
import type { PreviewFeatures } from "@/lib/settings/preview-features";

/**
 * The person's own preview opt-ins, off the cached account payload, or null
 * while it has not answered. Every reader treats null as "off": a preview
 * appears only once the server has said yes, never on a guess.
 */
export function usePreviewFeatures(): PreviewFeatures | null {
  const { user } = useAuth();
  return user?.previewFeatures ?? null;
}
