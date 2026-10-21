/**
 * The room-climate blueprint and its guide say one consistent thing.
 *
 * - The blueprint uses Home Assistant's current automation keys (`triggers`,
 *   `conditions`, `actions`, `trigger:` and `action:` inside them) and says
 *   which release it needs for them.
 * - Every interval it offers divides the hour, so "every N minutes from the
 *   full hour" is what actually happens: the trigger fires every five minutes
 *   and the condition keeps `minute % N == 0`, which for an N that does not
 *   divide 60 drifts at the hour.
 * - The guide recommends one room and never tells a reader to create one
 *   automation per room, which the readings (no room name) cannot support.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";
import { parse, Scalar, type CollectionTag, type ScalarTag } from "yaml";

const ROOT = process.cwd();
const BLUEPRINT = join(
  ROOT,
  "docs/integrations/blueprints/healthlog-room-climate.yaml",
);
const GUIDE = join(ROOT, "docs/integrations/home-assistant.md");

const inputTag: ScalarTag = {
  tag: "!input",
  resolve: (value: string) => new Scalar(`!input ${value}`),
};

function blueprint(): Record<string, unknown> {
  return parse(readFileSync(BLUEPRINT, "utf8"), {
    customTags: [inputTag as ScalarTag | CollectionTag],
  }) as Record<string, unknown>;
}

describe("room-climate blueprint", () => {
  it("uses the current automation keys and names the release they need", () => {
    const doc = blueprint();
    for (const legacy of ["trigger", "condition", "action"]) {
      expect(doc, legacy).not.toHaveProperty(legacy);
    }
    const triggers = doc.triggers as Array<Record<string, unknown>>;
    const actions = doc.actions as Array<Record<string, unknown>>;
    expect(triggers.every((t) => "trigger" in t && !("platform" in t))).toBe(
      true,
    );
    expect(actions.every((a) => "action" in a && !("service" in a))).toBe(true);
    const meta = doc.blueprint as {
      homeassistant?: { min_version?: string };
    };
    expect(meta.homeassistant?.min_version).toMatch(/^2024\.10\./);
  });

  it("offers only intervals that divide the hour", () => {
    const meta = blueprint().blueprint as {
      input: {
        interval_minutes: {
          default: string;
          selector: { select: { options: string[] } };
        };
      };
    };
    const options = meta.input.interval_minutes.selector.select.options;
    expect(options.length).toBeGreaterThan(0);
    for (const option of options) {
      expect(60 % Number(option), option).toBe(0);
    }
    expect(options).toContain(meta.input.interval_minutes.default);
  });
});

describe("room-climate guide", () => {
  const guide = readFileSync(GUIDE, "utf8");
  const section = guide.slice(
    guide.indexOf("## Room climate"),
    guide.indexOf("## Sending several readings at once"),
  );

  it("recommends one room and explains why", () => {
    expect(section.length).toBeGreaterThan(200);
    expect(section).toMatch(/Track one room/);
    expect(section).toMatch(/409/);
    expect(section).not.toMatch(/one automation per room/i);
    expect(section).not.toMatch(/several automations/i);
  });

  it("writes its examples with the current keys", () => {
    const examples = [...guide.matchAll(/```yaml\n([\s\S]*?)```/g)].map(
      (m) => m[1]!,
    );
    expect(examples.length).toBeGreaterThan(0);
    for (const example of examples) {
      expect(example).not.toMatch(/^\s+- platform:/m);
      expect(example).not.toMatch(/^\s+- service:/m);
    }
  });
});
