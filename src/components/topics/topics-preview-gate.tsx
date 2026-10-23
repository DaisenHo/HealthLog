"use client";

import { useEffect, type ReactNode } from "react";
import { useRouter } from "next/navigation";

import { PageAuthGate } from "@/components/ui/page-auth-gate";
import { useAuth } from "@/hooks/use-auth";

/**
 * The Topics area exists only for a person who switched the preview on.
 *
 * Until the account payload answers, the page shows the shell's loading
 * state; signed out, it goes to sign-in like every page; with the preview off
 * (an old bookmark, a link from someone else) it leaves for Insights, where
 * the person's pages are. The routes refuse on their own (404
 * `topics.preview_off`), so this is the friendly end, not the guard.
 */
export function TopicsPreviewGate({ children }: { children: ReactNode }) {
  const { user, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const enabled = user?.previewFeatures?.topics === true;

  useEffect(() => {
    if (isLoading) return;
    if (!isAuthenticated) router.replace("/auth/login");
    else if (!enabled) router.replace("/insights");
  }, [isLoading, isAuthenticated, enabled, router]);

  if (isLoading || !isAuthenticated || !enabled) return <PageAuthGate />;
  return <>{children}</>;
}
