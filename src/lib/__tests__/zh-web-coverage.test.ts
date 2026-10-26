import { describe, it, expect } from "vitest";
import en from "../../../messages/en.json";
import zh from "../../../messages/zh-CN.json";
import coverage from "../../../docs/project/t06-localization-coverage.json";
import { englishOnlyWordingKeys } from "@/lib/mental-health/instrument-wording";

function flatten(value: unknown, prefix = ""): Record<string, string> {
  if (typeof value === "string") return { [prefix]: value };
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
      Object.entries(flatten(child, prefix ? `${prefix}.${key}` : key)),
    ),
  );
}

describe("complete Chinese Web catalog ownership", () => {
  const source = flatten(en),
    translated = flatten(zh);
  const restricted = englishOnlyWordingKeys("zh-CN");
  const exceptions = new Map(coverage.exceptions.map((e) => [e.key, e.value]));
  it("covers all eligible keys and keeps validated source wording absent", () => {
    expect(restricted).toHaveLength(79);
    expect(Object.keys(translated).sort()).toEqual(
      Object.keys(source)
        .filter((k) => !restricted.includes(k))
        .sort(),
    );
    for (const key of restricted) expect(translated[key]).toBeUndefined();
  });
  it("has an exact, reasoned owner for every unchanged source string", () => {
    const unchanged = Object.keys(translated).filter(
      (k) => translated[k] === source[k],
    );
    expect(unchanged.sort()).toEqual([...exceptions.keys()].sort());
    for (const e of coverage.exceptions) {
      expect(translated[e.key]).toBe(e.value);
      expect(e.reason.length).toBeGreaterThan(10);
    }
  });
});
