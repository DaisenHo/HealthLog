/**
 * The topic pages build several message keys at run time (one per topic,
 * range, state, tone, verdict). The call-site coverage guard sees literal keys
 * only, so this holds every built key against every locale.
 */
import { describe, expect, it } from "vitest";

import { locales } from "@/lib/i18n/config";
import { TOPIC_KEYS, TOPIC_RANGES } from "@/lib/topics/registry";

import {
  topicDescriptionKey,
  topicSourcesKey,
  topicTitleKey,
} from "../topic-meta";

function resolve(bundle: unknown, key: string): unknown {
  return key
    .split(".")
    .reduce<unknown>(
      (node, part) =>
        node && typeof node === "object"
          ? (node as Record<string, unknown>)[part]
          : undefined,
      bundle,
    );
}

const BUILT_KEYS = [
  ...TOPIC_KEYS.flatMap((key) => [
    topicTitleKey(key),
    topicDescriptionKey(key),
    topicSourcesKey(key),
  ]),
  ...TOPIC_RANGES.map((range) => `topics.range.${range}`),
  ...["within", "above", "below", "learning"].map((s) => `topics.state.${s}`),
  ...["steady", "watch", "learning"].map((s) => `topics.tone.${s}`),
  ...["improved", "worsened", "within_threshold"].map(
    (v) => `topics.screeners.${v}`,
  ),
  ...["above", "below"].map((s) => `topics.labs.${s}`),
  ...["SameDay", "NextDay"].flatMap((lag) =>
    ["Higher", "Lower"].map(
      (dir) => `topics.relationships.correlation${lag}${dir}`,
    ),
  ),
];

describe("topic message keys", () => {
  it.each(locales)("every built key resolves to text in %s", async (locale) => {
    const bundle = (await import(`../../../../messages/${locale}.json`))
      .default;
    const missing = BUILT_KEYS.filter(
      (key) => typeof resolve(bundle, key) !== "string",
    );
    expect(missing).toEqual([]);
  });

  it("checks a non-empty set", () => {
    expect(BUILT_KEYS.length).toBeGreaterThan(40);
  });
});
