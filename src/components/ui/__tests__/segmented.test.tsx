import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { LayoutGrid, Table } from "lucide-react";

import { Segmented, type SegmentedProps } from "../segmented";

const OPTIONS = [
  { value: "recent", label: "Last 90 days" },
  { value: "all", label: "All" },
] as const;

type Props = SegmentedProps<"recent" | "all">;

function html(props: Partial<Props> = {}) {
  return renderToStaticMarkup(
    <Segmented
      options={OPTIONS}
      value="recent"
      onChange={() => {}}
      label="History"
      slot="history-view"
      {...props}
    />,
  );
}

/** The segment buttons of a rendered tree, for driving their handlers. */
function buttons(node: ReactNode): ReactElement<{ onClick: () => void }>[] {
  const out: ReactElement<{ onClick: () => void }>[] = [];
  const walk = (n: ReactNode) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (!isValidElement(n)) return;
    const el = n as ReactElement<{ children?: ReactNode; onClick: () => void }>;
    if (el.type === "button") out.push(el);
    walk(el.props.children);
  };
  walk(node);
  return out;
}

vi.mock("@/hooks/use-roving-radio-group", () => ({
  useRovingRadioGroup: () => ({
    getRadioProps: (i: number) => ({ tabIndex: i === 0 ? 0 : -1 }),
  }),
}));

describe("<Segmented>", () => {
  it("is a radiogroup with one checked radio by default", () => {
    const out = html();
    expect(out).toContain('role="radiogroup"');
    expect(out).toContain('aria-label="History"');
    expect(out.match(/role="radio"/g)?.length).toBe(2);
    expect(out.match(/aria-checked="true"/g)?.length).toBe(1);
    expect(out).toContain('data-slot="history-view-all"');
  });

  it("gives every segment the 44 px floor on a coarse pointer", () => {
    const out = html();
    expect(out.match(/pointer-coarse:min-h-11/g)?.length).toBe(2);
    expect(out).toContain("min-h-9");
  });

  it("fills the chosen segment in the primary colour, on no track", () => {
    const out = html();
    const segments = out.match(/<button[^>]*>/g) ?? [];
    expect(segments).toHaveLength(2);
    const chosen = segments.filter((b) => b.includes('aria-checked="true"'));
    expect(chosen).toHaveLength(1);
    expect(chosen[0]).toContain("bg-primary text-primary-foreground");
    const other = segments.find((b) => b.includes('aria-checked="false"'));
    expect(other).not.toContain("bg-primary");
    const group = out.match(/<div[^>]*role="radiogroup"[^>]*>/)?.[0];
    expect(group).not.toContain("bg-muted");
  });

  it("sets a chart header's range row in the small type", () => {
    expect(html()).toContain("text-sm");
    const small = html({ size: "sm" });
    expect(small).toContain("text-xs");
    expect(small).not.toContain("text-sm");
    expect(small.match(/pointer-coarse:min-h-11/g)?.length).toBe(2);
  });

  it("renders pressed buttons in toggle mode", () => {
    const out = html({ mode: "toggle" });
    expect(out).toContain('role="group"');
    expect(out).not.toContain('role="radio"');
    expect(out).toContain('aria-pressed="true"');
    expect(out).toContain('aria-pressed="false"');
  });

  it("names icon-only segments and sizes them square", () => {
    const out = renderToStaticMarkup(
      <Segmented
        mode="toggle"
        iconOnly
        options={[
          { value: "cards", label: "Cards", icon: LayoutGrid },
          { value: "table", label: "Table", icon: Table },
        ]}
        value="cards"
        onChange={() => {}}
        label="View"
        optionSlot={(v) => `medications-view-${v}`}
      />,
    );
    expect(out).toContain('aria-label="Cards"');
    expect(out).toContain('title="Table"');
    expect(out.match(/pointer-coarse:size-11/g)?.length).toBe(2);
    expect(out).toContain('data-slot="medications-view-table"');
    expect(out).not.toContain(">Cards<");
  });

  it("re-fires the chosen segment in radio mode, which can open something", () => {
    const onChange = vi.fn();
    const tree = Segmented({
      options: OPTIONS,
      value: "recent",
      onChange,
      label: "History",
    });
    buttons(tree)[0].props.onClick();
    expect(onChange).toHaveBeenCalledWith("recent");
  });

  it("ignores a press on the active segment in toggle mode", () => {
    const onChange = vi.fn();
    const tree = Segmented({
      options: OPTIONS,
      value: "recent",
      onChange,
      label: "History",
      mode: "toggle",
    });
    const [active, other] = buttons(tree);
    active.props.onClick();
    expect(onChange).not.toHaveBeenCalled();
    other.props.onClick();
    expect(onChange).toHaveBeenCalledWith("all");
  });
});

describe("one segmented control", () => {
  it("is the only segmented-control component in the tree", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { walkSourceFiles } =
      await import("@/__tests__/helpers/source-files");
    const src = join(__dirname, "../../..");
    const defining = walkSourceFiles(src, { floor: 2000 })
      .filter((p) => !p.includes("__tests__/"))
      .filter((p) =>
        /export function (?:Segmented\w*|ViewToggle|\w*SegmentedToggle)\b/.test(
          readFileSync(join(src, p), "utf8"),
        ),
      );
    expect(defining).toEqual(["components/ui/segmented.tsx"]);
  });
});

/**
 * A row of buttons whose `aria-pressed` compares a state to each button's
 * value is a segmented control spelled by hand: six of them sat beside
 * `Segmented` (the narrative period, the lab result type, both admin filters,
 * the chart range tabs, the mood chart's copy of them), each with its own
 * size, fill and gap. New ones are refused; the ones that remain are not one
 * choice on one track, and say why.
 */
describe("no hand-built segmented control", () => {
  const PRESSED_BY_VALUE = /aria-pressed=\{[^}]*===[^}]*\}/g;

  const NOT_A_SEGMENT: Record<string, string> = {
    "components/settings/security-section/passkey-list-section.tsx":
      "one method is disabled while the account has no passkey; Segmented disables the whole track",
    "components/medications/units-per-dose-field.tsx":
      "a chip row that opens a free-number field for any other count",
    "components/body-sites/body-sites-section.tsx":
      "wrapping side chips under a body-site picker, not a track",
    "components/illness/log-day-sheet.tsx":
      "a graded severity scale per symptom, one square per level",
    "components/cycle/log-day-sheet.tsx":
      "a graded severity scale per symptom, one circle per level",
    "components/charts/chart-overlay-controls.tsx":
      "baselines stay pressable while greyed, with a tooltip saying why there is no data",
    "components/timeline/timeline-view.tsx":
      "a single button that opens the range sheet, beside the zoom Segmented",
  };

  function pressedByValue(source: string): number {
    return (source.match(PRESSED_BY_VALUE) ?? []).length;
  }

  it("finds none outside the reasoned exceptions", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { stripComments, walkSourceFiles } =
      await import("@/__tests__/helpers/source-files");
    const src = join(__dirname, "../../..");
    const found = walkSourceFiles(src, { floor: 2000 })
      .filter((p) => /^(components|app)\//.test(p))
      .filter((p) => !p.includes("__tests__/"))
      .filter((p) => p !== "components/ui/segmented.tsx")
      .filter(
        (p) =>
          pressedByValue(stripComments(readFileSync(join(src, p), "utf8"))) > 0,
      )
      .sort();
    expect(found).toEqual(Object.keys(NOT_A_SEGMENT).sort());
  });

  it("counter-check: catches a hand-built pair, not an on/off toggle", () => {
    expect(
      pressedByValue(`<Button aria-pressed={filter === "all"}>All</Button>
<Button aria-pressed={filter === "failed"}>Failed</Button>`),
    ).toBe(2);
    expect(pressedByValue(`<Button aria-pressed={open}>Show</Button>`)).toBe(0);
  });
});
