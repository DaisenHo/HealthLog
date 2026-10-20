/**
 * @fileoverview ESLint rule — a card surface is a `<Card>` (or one of the
 * shell primitives), not a hand-rolled `bg-card` + `border` + `rounded-xl`.
 *
 * UI standards §1: "New surfaces compose `<Card>` (or `SettingsCard` in
 * Settings)". A hand-rolled shell drifts on its own: one had `p-4` with no
 * `md:p-6`, one `py-6` with no horizontal inset, one a header row of its own
 * instead of `TileHeader`, and every one of them sat beside real cards whose
 * padding, gap and shadow it did not share.
 *
 * FLAGGED, under `src/components/` and `src/app/` outside
 * `src/components/ui/` and test files: one string literal whose class list
 * carries `bg-card` (the opaque card colour; a translucent `bg-card/NN` is an
 * inner tile or the sanctioned hero glass), a `border` utility, and
 * `rounded-xl` (the card radius; `rounded-lg` / `rounded-md` are inner tiles
 * and controls, §1).
 *
 * The files where a shell is the point (the shell primitives themselves, the
 * hero identity surface, popovers, the sign-in card that renders outside the
 * app shell, the chart frame its skeleton and error state share) are passed
 * in the `allow` option, each with its reason in the flat config. There is no
 * inline escape: a new exception is a reviewed change to that list.
 *
 * WHAT THIS RULE DOES NOT CATCH
 *
 * A shell assembled from separate literals (`cn("bg-card", "border",
 * "rounded-xl")`), one painted through a CSS class, or one in another radius.
 * It holds the idiom the sweep removed, not every way to draw a box.
 */

"use strict";

const ENFORCED_ROOTS = ["src/components/", "src/app/"];
const EXEMPT_ROOTS = ["src/components/ui/"];

const BG_CARD_RE = /(?:^|\s)bg-card(?=\s|$)/;
const BORDER_RE = /(?:^|\s)border(?:-[a-z0-9]|(?=\s|$))/;
const RADIUS_RE = /(?:^|\s)rounded-xl(?=\s|$)/;

function toPosix(filename) {
  return filename.replace(/\\/g, "/");
}

function isTestFile(posix) {
  return (
    /\.test\.[cm]?[jt]sx?$/.test(posix) ||
    /\.spec\.[cm]?[jt]sx?$/.test(posix) ||
    posix.includes("/__tests__/") ||
    posix.includes("/__mocks__/")
  );
}

function isShell(value) {
  return (
    typeof value === "string" &&
    BG_CARD_RE.test(value) &&
    BORDER_RE.test(value) &&
    RADIUS_RE.test(value)
  );
}

/** @type {import("eslint").Rule.RuleModule} */
const noRawCardShellRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Compose <Card> (or a shell primitive) instead of a hand-rolled bg-card + border + rounded-xl shell.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allow: { type: "array", items: { type: "string" } },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      rawShell:
        "Hand-rolled card shell (bg-card + border + rounded-xl). Compose <Card> (with TileHeader inside), SettingsCard in Settings, or TrendTile for a trend tile (UI standards §1). A deliberate exception goes into the rule's `allow` list in eslint.config.mjs with its reason.",
    },
  },
  create(context) {
    const filename = toPosix(context.filename ?? context.getFilename?.() ?? "");
    if (!ENFORCED_ROOTS.some((root) => filename.includes(root))) return {};
    if (EXEMPT_ROOTS.some((root) => filename.includes(root))) return {};
    if (isTestFile(filename)) return {};
    const allow = (context.options[0] && context.options[0].allow) || [];
    if (allow.some((suffix) => filename.endsWith(suffix))) return {};

    function check(node, value) {
      if (isShell(value)) context.report({ node, messageId: "rawShell" });
    }

    return {
      Literal(node) {
        check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked ?? node.value.raw);
      },
    };
  },
};

module.exports = noRawCardShellRule;
