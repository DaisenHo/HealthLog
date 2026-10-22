/**
 * @fileoverview ESLint rule — import direction between the layers of `src`.
 *
 * Two boundaries, both checked per import statement so the mistake shows up
 * in the editor rather than in a later sweep:
 *
 *   1. `src/lib/**` never imports from `src/components/**` or `src/app/**`.
 *      The direction is `app → components → hooks → lib`. A lib module that
 *      reaches upward drags a component folder into server jobs and makes
 *      the layers impossible to split. Type-only imports count too: the
 *      dependency is the same, only erased at build time.
 *
 *   2. A `"use client"` file never makes a value import of a server-only
 *      module: the database client, the crypto module, the Prisma client
 *      entry, the job queue, `pg`, `next/headers`. Type-only imports are
 *      erased and stay legal, and the Prisma `enums` entry is browser-safe.
 *      The transitive version of this check is
 *      `src/__tests__/client-bundle-server-import-guard.test.ts`, which walks
 *      the whole client graph; this rule is the direct, local half.
 *
 * Existing lib → components imports are listed in the `allow` option, file
 * by file, each with the reason it has not moved yet. A listed file that no
 * longer imports upward is reported too, so the list can only shrink.
 *
 * WHAT THIS DOES NOT CATCH
 *
 * A dependency through a re-export in a package outside `src`, and a
 * `require()` call. Neither occurs in the tree today.
 */

"use strict";

const path = require("node:path");

function toPosix(filename) {
  return filename.replace(/\\/g, "/");
}

function isTestFile(filename) {
  return (
    /\/__tests__\//.test(filename) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(filename) ||
    /\/__mocks__\//.test(filename)
  );
}

/** Path of `filename` relative to the repository's `src/`, or null. */
function srcRelative(filename) {
  const idx = filename.lastIndexOf("/src/");
  return idx === -1 ? null : filename.slice(idx + 1);
}

/** Where a specifier lands inside `src/`, or null for a package. */
function targetInSrc(spec, filename) {
  if (spec.startsWith("@/")) return `src/${spec.slice(2)}`;
  if (spec.startsWith(".")) {
    const abs = toPosix(path.resolve(path.dirname(filename), spec));
    return srcRelative(abs);
  }
  return null;
}

const SERVER_ONLY_PACKAGES = [
  /^pg$/,
  /^pg-boss$/,
  /^@prisma\//,
  /^next\/headers$/,
];

const SERVER_ONLY_SRC = [
  /^src\/lib\/db(-session)?$/,
  /^src\/lib\/crypto(\/|$)/,
  /^src\/lib\/jobs\//,
  /^src\/generated\/prisma\/(client|internal|models)(\/|$)/,
];

function isServerOnly(spec, filename) {
  if (SERVER_ONLY_PACKAGES.some((re) => re.test(spec))) return true;
  const target = targetInSrc(spec, filename);
  if (!target) return false;
  const bare = target.replace(/\.(ts|tsx|js|mjs)$/, "");
  return SERVER_ONLY_SRC.some((re) => re.test(bare));
}

function isTypeOnly(node) {
  if (node.importKind === "type" || node.exportKind === "type") return true;
  const specifiers = node.specifiers ?? [];
  return (
    specifiers.length > 0 &&
    specifiers.every((s) => s.importKind === "type" || s.exportKind === "type")
  );
}

function hasUseClient(program) {
  for (const stmt of program.body) {
    if (stmt.type !== "ExpressionStatement" || !stmt.directive) break;
    if (stmt.directive === "use client") return true;
  }
  return false;
}

/** @type {import("eslint").Rule.RuleModule} */
const importBoundariesRule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Keep src/lib below components and app, and server-only modules out of client files.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allow: {
            type: "object",
            additionalProperties: { type: "string", minLength: 1 },
          },
        },
        additionalProperties: false,
      },
    ],
    messages: {
      libUpward:
        "src/lib must not import {{target}}. Move the shared piece into src/lib (or the importer into the component folder); an exception goes into the rule's `allow` map in eslint.config.mjs with its reason.",
      staleAllow:
        "This file is in the import-boundaries `allow` map but no longer imports from src/components or src/app. Remove the entry so the list keeps shrinking.",
      clientServerOnly:
        'A "use client" file must not import {{spec}}: it is server-only and would ship to the browser. Import a type with `import type`, or move the call behind an API route or a server component.',
    },
  },

  create(context) {
    const filename = toPosix(context.filename ?? context.getFilename?.() ?? "");
    const rel = srcRelative(filename);
    if (!rel || isTestFile(filename)) return {};

    const allow = (context.options[0] && context.options[0].allow) || {};
    const inLib = rel.startsWith("src/lib/");
    const allowed = inLib && Object.hasOwn(allow, rel);
    let upwardSeen = false;
    let isClient = false;

    function check(node, source) {
      if (!source || typeof source.value !== "string") return;
      const spec = source.value;
      if (inLib) {
        const target = targetInSrc(spec, filename);
        if (
          target &&
          (target.startsWith("src/components/") ||
            target.startsWith("src/app/"))
        ) {
          upwardSeen = true;
          if (!allowed) {
            context.report({
              node: source,
              messageId: "libUpward",
              data: { target: spec },
            });
          }
        }
      }
      if (isClient && !isTypeOnly(node) && isServerOnly(spec, filename)) {
        context.report({
          node: source,
          messageId: "clientServerOnly",
          data: { spec },
        });
      }
    }

    return {
      Program(program) {
        isClient = hasUseClient(program);
      },
      ImportDeclaration(node) {
        check(node, node.source);
      },
      ExportNamedDeclaration(node) {
        if (node.source) check(node, node.source);
      },
      ExportAllDeclaration(node) {
        check(node, node.source);
      },
      ImportExpression(node) {
        if (node.source && node.source.type === "Literal") {
          check(node, node.source);
        }
      },
      "Program:exit"(program) {
        if (allowed && !upwardSeen) {
          context.report({ node: program, messageId: "staleAllow" });
        }
      },
    };
  },
};

module.exports = importBoundariesRule;
