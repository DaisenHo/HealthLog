/**
 * One save model per card.
 *
 * A settings card either saves each control the moment it changes (switches,
 * selects, segmented choices) or collects a multi-field draft behind one
 * explicit Save. Never both: a card with an instant switch beside a Save
 * button leaves a person guessing which of their changes the button covers,
 * and the channel cards (Telegram, ntfy, webhook, email) did exactly that —
 * the enable switch wrote on tap while the rest of the form waited for Save.
 *
 * The guard splits every settings source into card units (each
 * `<SettingsCard>…</SettingsCard>` block; a file without one is a single
 * unit) and fails a unit that both
 *   - saves explicitly: a `type="submit"` control or the `common.save` label,
 *   - saves instantly: a Switch / NativeSelect / Select / Segmented / Checkbox
 *     whose change handler does more than set local draft state.
 *
 * Its limit, written down: the handler check is textual. It follows calls to
 * functions declared in the same file two levels deep; a write hidden behind
 * a callback handed in through props, or behind an imported helper whose
 * name carries none of the write markers, reads as a draft field.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const SETTINGS_DIR = join(ROOT, "src", "components", "settings");
const EXTRA_FILES = [
  "src/components/labs/labs-settings.tsx",
  "src/components/illness/illness-settings.tsx",
  "src/components/measurement-reminders/vorsorge-settings.tsx",
];

/**
 * `<file>#<card index>` → why the unit may mix both models. Empty on purpose;
 * an entry needs a reason a reviewer can check.
 */
const ALLOWLIST: Readonly<Record<string, string>> = {};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "__tests__") continue;
      out.push(...walk(full));
    } else if (entry.endsWith(".tsx")) {
      out.push(full);
    }
  }
  return out;
}

/** Each `<SettingsCard>` block with its nested cards counted. */
function splitCardUnits(source: string): string[] {
  const open = /<SettingsCard\b/g;
  const units: string[] = [];
  let match: RegExpExecArray | null;
  let consumedTo = 0;
  while ((match = open.exec(source)) !== null) {
    if (match.index < consumedTo) continue;
    let depth = 0;
    const token = /<SettingsCard\b|<\/SettingsCard>/g;
    token.lastIndex = match.index;
    let t: RegExpExecArray | null;
    let end = source.length;
    while ((t = token.exec(source)) !== null) {
      depth += t[0] === "</SettingsCard>" ? -1 : 1;
      if (depth === 0) {
        end = t.index + t[0].length;
        break;
      }
    }
    units.push(source.slice(match.index, end));
    consumedTo = end;
  }
  return units.length > 0 ? units : [source];
}

/** The JSX opening tag starting at `start`, braces and strings respected. */
function openingTag(source: string, start: number): string {
  let depth = 0;
  let quote: string | null = null;
  for (let i = start; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === quote && source[i - 1] !== "\\") quote = null;
      continue;
    }
    if (depth > 0 && (c === '"' || c === "'" || c === "`")) {
      quote = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === ">" && depth === 0) return source.slice(start, i + 1);
  }
  return source.slice(start);
}

/** The `{…}` expression of `attr=` inside a tag, or null. */
function attributeExpression(tag: string, attr: string): string | null {
  const at = tag.search(new RegExp(`\\b${attr}=\\{`));
  if (at < 0) return null;
  const open = tag.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < tag.length; i++) {
    if (tag[i] === "{") depth++;
    else if (tag[i] === "}") {
      depth--;
      if (depth === 0) return tag.slice(open + 1, i).trim();
    }
  }
  return null;
}

/** A call that writes to the server (or the locale) on its own. */
const WRITE_MARKER =
  /\.mutate(?:Async)?\(|\bapi(?:FetchRaw|Fetch|Get|Put|Patch|Post|Delete)\(|\bsafeFetch\(|\bpersist\w*\(/;

/** The body of a function or arrow const declared in `source`, or null. */
function localDefinition(source: string, name: string): string | null {
  const decl = new RegExp(
    `(?:function\\s+${name}\\s*\\(|(?:const|let)\\s+${name}\\s*=)`,
  ).exec(source);
  if (!decl) return null;
  // A braceless arrow (`const f = (v) => g(v);`) ends at its line.
  const rest = source.slice(decl.index);
  const arrow = /^[^\n{]*=>\s*(?!\{)([^\n]*)/.exec(rest);
  if (arrow) return arrow[0];
  const open = source.indexOf("{", decl.index);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(decl.index, i + 1);
    }
  }
  return null;
}

/**
 * True when a change handler writes on change: the handler itself carries a
 * write call, or a function it calls that is declared in the same file does
 * (followed two levels deep). A handler that only touches local state, or
 * calls a callback handed in through props, reads as a draft field.
 */
function writesOnChange(handler: string, source: string, depth = 0): boolean {
  if (WRITE_MARKER.test(handler)) return true;
  if (depth >= 2) return false;
  const names = new Set<string>();
  if (/^[A-Za-z_]\w*$/.test(handler)) names.add(handler);
  for (const m of handler.matchAll(/\b([A-Za-z_]\w*)\s*\(/g)) {
    names.add(m[1]);
  }
  for (const name of names) {
    const body = localDefinition(source, name);
    if (body && writesOnChange(body, source, depth + 1)) return true;
  }
  return false;
}

const CONTROL = /<(Switch|NativeSelect|Select|Segmented|Checkbox)\b/g;
const HANDLERS = ["onCheckedChange", "onChange", "onValueChange"];

function savesInstantly(unit: string, source: string = unit): boolean {
  CONTROL.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CONTROL.exec(unit)) !== null) {
    const tag = openingTag(unit, match.index);
    for (const attr of HANDLERS) {
      const handler = attributeExpression(tag, attr);
      if (handler !== null && writesOnChange(handler, source)) return true;
    }
  }
  return false;
}

function savesExplicitly(unit: string): boolean {
  return /type="submit"/.test(unit) || /t\("common\.save"\)/.test(unit);
}

function scan() {
  const files = [
    ...walk(SETTINGS_DIR),
    ...EXTRA_FILES.map((f) => join(ROOT, f)),
  ];
  const mixed: string[] = [];
  let units = 0;
  for (const file of files) {
    const rel = relative(ROOT, file);
    const source = readFileSync(file, "utf8");
    splitCardUnits(source).forEach((unit, index) => {
      units++;
      if (savesInstantly(unit, source) && savesExplicitly(unit)) {
        const key = `${rel}#${index}`;
        if (!ALLOWLIST[key]) mixed.push(key);
      }
    });
  }
  return { mixed, units, files: files.length };
}

describe("settings save model", () => {
  it("classifies handlers", () => {
    const source = `
      function handleToggle(next) { mutation.mutate(next); }
      function toggleItem(kind, on) { setDraft({ kind, on }); }
      const flip = (v) => handleToggle(v);
    `;
    expect(writesOnChange("setChatId", source)).toBe(false);
    expect(writesOnChange("(e) => setUrl(e.target.value)", source)).toBe(false);
    expect(writesOnChange("(v) => toggleItem('a', v)", source)).toBe(false);
    expect(
      writesOnChange("(checked) => toggleEnabled.mutate(checked)", source),
    ).toBe(true);
    expect(writesOnChange("handleToggle", source)).toBe(true);
    expect(writesOnChange("(v) => flip(v)", source)).toBe(true);
  });

  it("refuses a card that both saves on change and behind a Save button", () => {
    const mixedCard = `<SettingsCard><Switch onCheckedChange={(v) => save.mutate(v)} /><Button type="submit">{t("common.save")}</Button></SettingsCard>`;
    const draftCard = `<SettingsCard><Switch onCheckedChange={setEnabled} /><Button type="submit">{t("common.save")}</Button></SettingsCard>`;
    expect(
      savesInstantly(splitCardUnits(mixedCard)[0]) &&
        savesExplicitly(splitCardUnits(mixedCard)[0]),
    ).toBe(true);
    expect(savesInstantly(splitCardUnits(draftCard)[0])).toBe(false);
  });

  it("finds no card that mixes instant and explicit saving", () => {
    const { mixed, units, files } = scan();
    // An empty scan would pass for the wrong reason.
    expect(files).toBeGreaterThan(50);
    expect(units).toBeGreaterThan(100);
    expect(
      mixed,
      `cards mixing both save models:\n${mixed.join("\n")}`,
    ).toEqual([]);
  });

  it("keeps every allowlist entry pointing at a unit that still mixes", () => {
    for (const key of Object.keys(ALLOWLIST)) {
      const [file, index] = key.split("#");
      const source = readFileSync(join(ROOT, file), "utf8");
      const unit = splitCardUnits(source)[Number(index)];
      expect(unit, key).toBeDefined();
      expect(savesInstantly(unit, source) && savesExplicitly(unit), key).toBe(
        true,
      );
    }
  });
});
