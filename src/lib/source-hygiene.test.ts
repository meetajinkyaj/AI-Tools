import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Source files must be plain text that ordinary tools can read.
 *
 * WHY THIS EXISTS. A dedupe key was written with a literal NUL byte in a
 * template string, `\`${date}<NUL>${metric}\``, instead of the escape. It
 * worked: TypeScript compiled it, every test passed, eslint was happy and the
 * build succeeded. Nothing in the toolchain cares.
 *
 * What DOES care is every text tool in the repo. `grep` treats a file
 * containing a NUL as binary and prints "binary file matches" instead of the
 * line, so that file silently drops out of every repo-wide search. Including
 * the em dash sweep that `AGENTS.md` tells everyone to run before committing:
 * the one file with a control character in it is the one file the house style
 * check cannot see. `git diff` degrades the same way, and a reviewer reads
 * "Binary files differ" instead of the change.
 *
 * It survived a merge because a passing build is not the same as a readable
 * repo, and no check existed for the difference. This is that check.
 *
 * TAB AND NEWLINE ARE FINE, obviously. Everything else below 0x20, plus the
 * DEL at 0x7f, is a control character with no business in source.
 */

const ROOTS = ["src", "scripts", "workers", "supabase"];
const EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".sql", ".json", ".md", ".css"]);
const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".git", ".open-next"]);

/** Allowed control characters: tab, line feed, carriage return. */
const ALLOWED = new Set([0x09, 0x0a, 0x0d]);

function sourceFiles(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // a root that does not exist in this checkout
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (EXTENSIONS.has(extname(name))) out.push(full);
  }
  return out;
}

describe("source files are plain text", () => {
  const files = ROOTS.flatMap((r) => sourceFiles(join(process.cwd(), r)));

  it("finds files to check, so a broken walk cannot pass vacuously", () => {
    // Without this, a typo in ROOTS turns the whole suite into a no-op that
    // reports success, which is the failure mode of every filesystem test.
    expect(files.length).toBeGreaterThan(100);
  });

  it("contains no control characters that make tools treat them as binary", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const buf = readFileSync(file);
      for (let i = 0; i < buf.length; i++) {
        const byte = buf[i];
        if (byte < 0x20 && !ALLOWED.has(byte)) {
          const line = buf.subarray(0, i).toString("utf8").split("\n").length;
          offenders.push(
            `${relative(process.cwd(), file)}:${line} has 0x${byte.toString(16).padStart(2, "0")}`,
          );
          break;
        }
        if (byte === 0x7f) {
          const line = buf.subarray(0, i).toString("utf8").split("\n").length;
          offenders.push(`${relative(process.cwd(), file)}:${line} has DEL`);
          break;
        }
      }
    }
    // Named rather than counted: "3 files failed" sends somebody hunting.
    expect(offenders, offenders.join("\n")).toEqual([]);
  });

  it("is valid UTF-8 throughout", () => {
    // A file saved as UTF-16 or Latin-1 also compiles and also breaks grep.
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const bad: string[] = [];
    for (const file of files) {
      try {
        decoder.decode(readFileSync(file));
      } catch {
        bad.push(relative(process.cwd(), file));
      }
    }
    expect(bad, bad.join("\n")).toEqual([]);
  });
});
