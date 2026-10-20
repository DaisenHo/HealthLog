/**
 * @fileoverview ESLint rule — a number shown to a person goes through the
 * app's locale, never through the JavaScript default.
 *
 * `value.toFixed(1)` always prints a full stop. A German, French, Italian,
 * Spanish, Dutch or Polish reader expects a comma (`37,5 °C`), and the same
 * screen already shows a comma wherever the value went through
 * `useFormatters()`. The mixed reading is the defect: one card says `70,5 kg`,
 * the card beside it `70.5 kg`. `toLocaleString()` without a locale is the
 * mirror image of the same mistake — it follows the browser, not the language
 * the person picked in HealthLog.
 *
 * The legitimate forms:
 *
 *   - in a component: `const fmt = useFormatters(); fmt.number(value, 1)`
 *     (`fmt.integer`, `fmt.percent` for the other shapes)
 *   - outside React: `makeFormatters(locale, …)` from `@/lib/format-locale`
 *   - rounding, not display: `Number(value.toFixed(2))` stays legal — the
 *     result is a number again and is formatted wherever it is shown
 *
 * FLAGGED, in `src/components/`, `src/app/`, `src/hooks/` and `src/lib/`
 * outside `src/app/api/` (wire formats are not display) and outside test
 * files. `src/lib/` is in scope because sentences for people are built
 * there too (a correlation hypothesis, a deterministic fallback, a narrative)
 * and the weekday correlation printed "0.8 kg" into a German sentence; a
 * machine-read string there (a prompt for the model, an operator log line,
 * SVG path data, a wire value a client re-formats) carries a reasoned
 * directive like any other.
 *
 *   - `<x>.toFixed(…)` and `<x>.toPrecision(…)`, unless the call is the
 *     argument of `Number(…)` / `parseFloat(…)` / `Number.parseFloat(…)` or
 *     the operand of a unary `+`
 *   - `<x>.toLocaleString()`, `toLocaleDateString()`, `toLocaleTimeString()`
 *     called with no locale or with `undefined` as the locale
 *   - `Intl.NumberFormat()` / `Intl.DateTimeFormat()` constructed with no
 *     locale or with `undefined` (reading `.resolvedOptions()` off it, the
 *     browser time zone lookup, formats nothing and passes)
 *   - a division rendered straight into text: `String(a / b)` and
 *     `` `${a / b}` `` — the quotient is fractional and prints with a stop
 *
 * A site where the stop is the point (SVG path data, a value written into a
 * machine-read attribute) stays, with the reason on the line above:
 *
 *   // eslint-disable-next-line healthlog/no-unlocalised-decimal -- <why>
 *
 * The rule refuses a directive for itself without a reason, or in any form
 * other than `eslint-disable-next-line`.
 *
 * WHAT THIS RULE DOES NOT CATCH
 *
 * Without type information it cannot tell a number from a string, so
 * `String(weight)` or `` `${weight} kg` `` with a fractional `weight` passes,
 * as does a quotient assigned to a variable first and rendered later. It
 * removes the idioms that print a stop by construction, not every path to
 * one.
 */

"use strict";

const RULE_NAME = "healthlog/no-unlocalised-decimal";
const ENFORCED_ROOTS = [
  "src/components/",
  "src/app/",
  "src/hooks/",
  "src/lib/",
];
const EXEMPT_ROOTS = ["src/app/api/"];
const MIN_REASON_CHARS = 8;

const FIXED_METHODS = new Set(["toFixed", "toPrecision"]);
const LOCALE_METHODS = new Set([
  "toLocaleString",
  "toLocaleDateString",
  "toLocaleTimeString",
]);
const INTL_CTORS = new Set(["NumberFormat", "DateTimeFormat"]);

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

function isEnforced(filename) {
  const posix = toPosix(filename);
  if (!ENFORCED_ROOTS.some((root) => posix.includes(root))) return false;
  if (EXEMPT_ROOTS.some((root) => posix.includes(root))) return false;
  if (isTestFile(posix)) return false;
  return true;
}

function propertyName(member) {
  if (!member || member.type !== "MemberExpression") return null;
  if (!member.computed && member.property.type === "Identifier") {
    return member.property.name;
  }
  if (member.computed && member.property.type === "Literal") {
    return String(member.property.value);
  }
  return null;
}

function isUndefined(node) {
  return (
    !node ||
    (node.type === "Identifier" && node.name === "undefined") ||
    (node.type === "UnaryExpression" && node.operator === "void")
  );
}

/** Strip TS-only wrappers and parentheses-equivalents the parser keeps. */
function unwrap(node) {
  let current = node;
  while (
    current &&
    (current.type === "TSAsExpression" ||
      current.type === "TSNonNullExpression" ||
      current.type === "TSSatisfiesExpression" ||
      current.type === "ChainExpression")
  ) {
    current = current.expression;
  }
  return current;
}

/** The call's value is turned back into a number: rounding, not display. */
function isNumericRoundTrip(callNode) {
  let child = callNode;
  let parent = callNode.parent;
  while (
    parent &&
    (parent.type === "TSAsExpression" ||
      parent.type === "TSNonNullExpression" ||
      parent.type === "ChainExpression")
  ) {
    child = parent;
    parent = parent.parent;
  }
  if (!parent) return false;
  if (parent.type === "UnaryExpression" && parent.operator === "+") {
    return true;
  }
  if (parent.type !== "CallExpression" || parent.arguments[0] !== child) {
    return false;
  }
  const callee = parent.callee;
  if (callee.type === "Identifier") {
    return callee.name === "Number" || callee.name === "parseFloat";
  }
  return (
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    callee.object.name === "Number" &&
    propertyName(callee) === "parseFloat"
  );
}

function isDivision(node) {
  const inner = unwrap(node);
  return !!inner && inner.type === "BinaryExpression" && inner.operator === "/";
}

function isIntlCtor(callee) {
  return (
    callee &&
    callee.type === "MemberExpression" &&
    callee.object.type === "Identifier" &&
    callee.object.name === "Intl" &&
    INTL_CTORS.has(propertyName(callee))
  );
}

/** @type {import("eslint").Rule.RuleModule} */
const noUnlocalisedDecimalRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Format a displayed number through useFormatters() / makeFormatters(), not toFixed() or a locale-less toLocaleString().",
    },
    schema: [],
    messages: {
      fixed:
        "`{{method}}()` prints a full stop in every language. Format the value with `useFormatters().number(value, digits)` (or `makeFormatters` outside React). For rounding, wrap it in `Number(…)`. If the stop is meant, say why: `// eslint-disable-next-line healthlog/no-unlocalised-decimal -- <reason>`.",
      localeless:
        "`{{method}}()` without a locale follows the browser, not the language picked in HealthLog. Use `useFormatters()` or pass the active locale.",
      intlLocaleless:
        "`Intl.{{ctor}}` without a locale follows the browser, not the language picked in HealthLog. Use `useFormatters()` or pass the active locale.",
      division:
        "A quotient rendered straight into text prints with a full stop. Format it with `useFormatters().number(value, digits)`.",
      missingReason:
        "A disable directive for healthlog/no-unlocalised-decimal must say why the full stop is right here: `-- <reason>` after the rule name.",
      nextLineOnly:
        "Disable healthlog/no-unlocalised-decimal only with `eslint-disable-next-line`, one site at a time, so the next occurrence is still caught.",
    },
  },
  create(context) {
    const filename = context.filename ?? context.getFilename?.();
    if (!filename || !isEnforced(filename)) {
      return {};
    }
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    function checkDirectives() {
      for (const comment of sourceCode.getAllComments()) {
        const text = comment.value.trim();
        const match = /^eslint-disable(-next-line|-line)?\b([\s\S]*)$/.exec(
          text,
        );
        if (!match || !match[2].includes(RULE_NAME)) continue;
        if (match[1] !== "-next-line") {
          context.report({
            loc: { line: 1, column: 0 },
            messageId: "nextLineOnly",
          });
          continue;
        }
        const reason = match[2].split(/\s--\s/)[1];
        if (!reason || reason.trim().length < MIN_REASON_CHARS) {
          context.report({ loc: comment.loc, messageId: "missingReason" });
        }
      }
    }

    function checkIntl(node) {
      // `Intl.DateTimeFormat().resolvedOptions().timeZone` reads the
      // browser's zone; nothing is formatted, so the missing locale is right.
      const readsOptionsOnly =
        node.parent &&
        node.parent.type === "MemberExpression" &&
        node.parent.object === node &&
        propertyName(node.parent) === "resolvedOptions";
      if (
        !readsOptionsOnly &&
        isIntlCtor(node.callee) &&
        isUndefined(node.arguments[0])
      ) {
        context.report({
          node,
          messageId: "intlLocaleless",
          data: { ctor: propertyName(node.callee) },
        });
      }
    }

    return {
      "Program:exit": checkDirectives,
      CallExpression(node) {
        const name = propertyName(node.callee);
        if (name && FIXED_METHODS.has(name)) {
          if (!isNumericRoundTrip(node)) {
            context.report({
              node,
              messageId: "fixed",
              data: { method: name },
            });
          }
          return;
        }
        if (name && LOCALE_METHODS.has(name)) {
          if (isUndefined(node.arguments[0])) {
            context.report({
              node,
              messageId: "localeless",
              data: { method: name },
            });
          }
          return;
        }
        if (
          node.callee.type === "Identifier" &&
          node.callee.name === "String" &&
          isDivision(node.arguments[0])
        ) {
          context.report({ node, messageId: "division" });
          return;
        }
        checkIntl(node);
      },
      NewExpression: checkIntl,
      TemplateLiteral(node) {
        if (node.parent && node.parent.type === "TaggedTemplateExpression") {
          return;
        }
        for (const expression of node.expressions) {
          if (isDivision(expression)) {
            context.report({ node: expression, messageId: "division" });
          }
        }
      },
    };
  },
};

module.exports = noUnlocalisedDecimalRule;
