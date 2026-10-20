"use client";

import * as React from "react";
import { Label as LabelPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * Form label. The trailing colon is an `::after` on the label itself; pass
 * `noColon` where the label is not followed by its field.
 *
 * The label is `inline-block`, not `inline-flex`. In a flex box the colon is
 * a flex item of its own, so a label that wraps (a long German or French
 * field name in a narrow column) left the colon floating beside the whole
 * text block instead of after the last word. In inline flow the colon is
 * glued to the last word and wraps with it. A call site that lays out a name
 * beside a unit sets `flex` itself and owns the colon there.
 */
function Label({
  className,
  noColon = false,
  ...props
}: React.ComponentProps<typeof LabelPrimitive.Root> & { noColon?: boolean }) {
  return (
    <LabelPrimitive.Root
      data-slot="label"
      data-no-colon={noColon}
      className={cn(
        "inline-block pl-1 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50 after:content-[':'] data-[no-colon=true]:after:content-none",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
