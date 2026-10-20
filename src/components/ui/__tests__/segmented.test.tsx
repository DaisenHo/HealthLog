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
