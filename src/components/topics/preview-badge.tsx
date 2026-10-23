import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

/**
 * The "Beta" mark beside a preview: the nav entry, the More tile, the page
 * title and the Settings switch. A status, so a `Badge`, in the one accent a
 * preview carries. Its text is part of the accessible name of whatever it
 * sits in, which is what a visible label should be.
 */
export function PreviewBadge({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      data-slot="preview-badge"
      className={cn(
        "border-primary/40 text-primary text-2xs px-1.5 py-0 tracking-wide uppercase",
        className,
      )}
    >
      {label}
    </Badge>
  );
}
