"use client";

import type { ReactNode } from "react";
import { toast, type ExternalToast } from "sonner";

import { ErrorIdLine } from "@/components/errors/error-id-line";
import { errorIdOf } from "./error-id";

export interface ErrorToastOptions extends ExternalToast {
  /**
   * The failure behind the toast, usually the caught error. When it is a
   * server failure (an `ApiError` with a 5xx status) the toast carries its
   * error id with a copy button; otherwise the toast is the plain one.
   */
  cause?: unknown;
}

/** How long a toast that carries an error id stays, so it can be copied. */
const ERROR_ID_TOAST_DURATION_MS = 10_000;

/**
 * The one error toast of the web app.
 *
 * Every error toast goes through here so a server failure always shows the id
 * a person needs to report it (`src/__tests__/error-display-helper-guard.test.ts`
 * holds call sites to it). Without a `cause`, or with one that has no id worth
 * showing, the call is exactly `toast.error(message, options)`.
 */
export function showErrorToast(
  message: Parameters<typeof toast.error>[0],
  options: ErrorToastOptions = {},
): string | number {
  const { cause, ...rest } = options;
  const id = errorIdOf(cause);
  if (!id) {
    return Object.keys(rest).length > 0
      ? toast.error(message, rest)
      : toast.error(message);
  }
  const description =
    typeof rest.description === "function"
      ? rest.description()
      : rest.description;
  return toast.error(message, {
    ...rest,
    duration: rest.duration ?? ERROR_ID_TOAST_DURATION_MS,
    description: <ErrorToastDescription description={description} id={id} />,
  });
}

function ErrorToastDescription({
  description,
  id,
}: {
  description: ReactNode;
  id: string;
}) {
  return (
    <span className="flex flex-col gap-1">
      {description ? <span>{description}</span> : null}
      <ErrorIdLine id={id} />
    </span>
  );
}
