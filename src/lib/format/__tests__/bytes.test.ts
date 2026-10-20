import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { formatBytes } from "../bytes";

describe("formatBytes", () => {
  it("scales units and keeps one decimal below 100", () => {
    expect(formatBytes(0, "en")).toBe("0 B");
    expect(formatBytes(512, "en")).toBe("512 B");
    expect(formatBytes(1_310_720, "en")).toBe("1.3 MB");
    expect(formatBytes(26_214_400, "en")).toBe("25 MB");
    expect(formatBytes(1_288_490_189, "en")).toBe("1.2 GB");
    expect(formatBytes(150 * 1024 * 1024, "en")).toBe("150 MB");
  });

  it("prints the digits in the reader's locale", () => {
    expect(formatBytes(1_288_490_189, "de")).toBe("1,2 GB");
    expect(formatBytes(1_288_490_189, "de-DE")).toBe("1,2 GB");
    expect(formatBytes(1_310_720, "fr")).toBe("1,3 MB");
  });

  it("never prints a negative size", () => {
    expect(formatBytes(-5, "en")).toBe("0 B");
  });
});

/**
 * One byte formatter. A second definition is how the admin area and the
 * document vault came to print the same size two ways.
 */
describe("a single byte formatter", () => {
  it("is defined only in src/lib/format/bytes.ts", () => {
    const root = join(__dirname, "../../..");
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        if (name === "node_modules" || name === "generated") continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) {
          walk(path);
        } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
          const source = readFileSync(path, "utf8");
          if (/function\s+formatBytes\b|const\s+formatBytes\s*=/.test(source)) {
            hits.push(path.slice(root.length + 1));
          }
        }
      }
    };
    walk(root);
    expect(hits).toEqual(["lib/format/bytes.ts"]);
  });
});
