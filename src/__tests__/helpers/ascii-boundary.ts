/**
 * Find `\b` word boundaries that sit next to an accented letter in a regular
 * expression's source.
 *
 * JavaScript defines `\b` over ASCII `\w`, so `santé\b` never matches before a
 * space and `\bépisode` never matches after one; an alternative that starts or
 * ends that way is dead. The check looks at what the source puts on each side
 * of the boundary: a literal letter, a character class, or a group whose
 * alternatives start (or end) with one. It is a text heuristic over the
 * pattern source, not a regex engine: a boundary next to a backreference or a
 * lookaround it does not unwrap is not judged.
 */
function isAccentedLetter(char: string | undefined): boolean {
  return char !== undefined && char.charCodeAt(0) > 127 && /\p{L}/u.test(char);
}

function classEnd(source: string, open: number): number {
  let i = open + 1;
  while (i < source.length && !(source[i] === "]" && source[i - 1] !== "\\")) {
    i += 1;
  }
  return i;
}

function classHasAccent(source: string, open: number): boolean {
  return [...source.slice(open, classEnd(source, open))].some(isAccentedLetter);
}

/** Top-level alternatives of the group opening at `open`, and its close. */
function alternatives(source: string, open: number): string[] {
  const prefix = /^\(\?(?:<[=!]|[:=!])/.exec(source.slice(open))?.[0] ?? "(";
  const alts: string[] = [];
  let depth = 0;
  let start = open + prefix.length;
  for (let i = open; i < source.length; i += 1) {
    const c = source[i];
    if (c === "\\") {
      i += 1;
    } else if (c === "[") {
      i = classEnd(source, i);
    } else if (c === "(") {
      depth += 1;
    } else if (c === ")") {
      depth -= 1;
      if (depth === 0) {
        alts.push(source.slice(start, i));
        return alts;
      }
    } else if (c === "|" && depth === 1) {
      alts.push(source.slice(start, i));
      start = i + 1;
    }
  }
  return alts;
}

function opensWithAccent(text: string): boolean {
  if (text.startsWith("[")) return classHasAccent(text, 0);
  if (text.startsWith("(")) return alternatives(text, 0).some(opensWithAccent);
  return isAccentedLetter(text[0]);
}

function closesWithAccent(text: string): boolean {
  const trimmed = text.replace(/(?:[?*+]|\{\d+(?:,\d*)?\})+\??$/, "");
  const last = trimmed[trimmed.length - 1];
  if (last === "]") {
    let open = trimmed.length - 2;
    while (
      open >= 0 &&
      !(trimmed[open] === "[" && trimmed[open - 1] !== "\\")
    ) {
      open -= 1;
    }
    return classHasAccent(trimmed, open);
  }
  if (last === ")") {
    let depth = 0;
    for (let i = trimmed.length - 1; i >= 0; i -= 1) {
      if (trimmed[i - 1] === "\\") continue;
      if (trimmed[i] === ")") depth += 1;
      else if (trimmed[i] === "(" && --depth === 0) {
        return alternatives(trimmed, i).some(closesWithAccent);
      }
    }
    return false;
  }
  return isAccentedLetter(last);
}

/** Offsets of every `\b` in `source` that touches an accented letter. */
export function accentedBoundaries(source: string): number[] {
  const hits: number[] = [];
  for (
    let i = source.indexOf("\\b");
    i >= 0;
    i = source.indexOf("\\b", i + 2)
  ) {
    if (source[i - 1] === "\\") continue;
    if (
      opensWithAccent(source.slice(i + 2)) ||
      closesWithAccent(source.slice(0, i))
    ) {
      hits.push(i);
    }
  }
  return hits;
}
