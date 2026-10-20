/**
 * @fileoverview ESLint rule — no planning tag at the head of a comment.
 *
 * Comments used to open with the identifier of the work item that produced
 * them. The identifiers point into planning notes that never ship, so a
 * reader meets something that looks like a reference and leads nowhere.
 * `scripts/strip-planning-tags.mjs` removed the existing ones; this rule
 * keeps new ones out. A release version that dates the behaviour and an
 * issue reference (`#1234`) are allowed and survive the autofix.
 *
 * The shape is defined once, in `./planning-tags.js`, which the sweep script
 * imports as well — see its header for the grammar and for what it does not
 * catch.
 */

"use strict";

const { matchPlanningTag, commentLines } = require("./planning-tags.js");

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** @type {import("eslint").Rule.RuleModule} */
const noPlanningTagsRule = {
  meta: {
    type: "suggestion",
    fixable: "code",
    docs: {
      description:
        "Disallow planning-note identifiers at the head of a comment line.",
    },
    schema: [],
    messages: {
      planningTag:
        "Planning tag {{tags}} at the head of a comment. Say what the code does; an issue reference (#123) or a release version may stay.",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();
    return {
      Program() {
        const comments = sourceCode.getAllComments();
        if (comments.length === 0) return;

        const text = sourceCode.getText();
        let codeOnly = null;
        const usedInCode = (tag) => {
          if (codeOnly === null) {
            let out = "";
            let cursor = 0;
            for (const c of comments) {
              out += text.slice(cursor, c.range[0]);
              out += " ".repeat(c.range[1] - c.range[0]);
              cursor = c.range[1];
            }
            codeOnly = out + text.slice(cursor);
          }
          return new RegExp(
            `(?<![A-Za-z0-9-])${escapeRegExp(tag)}(?![A-Za-z0-9-])`,
          ).test(codeOnly);
        };

        for (const comment of comments) {
          const raw = text.slice(comment.range[0], comment.range[1]);
          for (const line of commentLines(raw)) {
            const hit = matchPlanningTag(line.text, usedInCode);
            if (!hit) continue;
            const start = comment.range[0] + line.offset + line.prefix.length;
            const end = start + line.text.length;
            context.report({
              loc: {
                start: sourceCode.getLocFromIndex(start),
                end: sourceCode.getLocFromIndex(end),
              },
              messageId: "planningTag",
              data: { tags: hit.tags.join(", ") || "(planning word)" },
              fix: (fixer) =>
                fixer.replaceTextRange([start, end], hit.replacement),
            });
          }
        }
      },
    };
  },
};

module.exports = noPlanningTagsRule;
