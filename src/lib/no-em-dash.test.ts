import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * House style: no em dashes, anywhere.
 *
 * WHY IT SCANS EVERY TRACKED FILE. The first version of this test took a list
 * of directories (src, docs, supabase, workers) and passed while e2e specs,
 * build scripts, the Playwright and Vitest configs, and every root config file
 * still carried them. A style rule enforced over a subset of the repo gives the
 * appearance of a guarantee without the substance, so the file list now comes
 * from `git ls-files`: if it is committed, it is checked.
 *
 * WHY A TEST AND NOT A LINT RULE. ESLint sees TypeScript. Most of the prose a
 * reader actually meets lives in Markdown, SQL comments, YAML and email
 * templates, none of which ESLint parses.
 */

/**
 * Files that must contain these characters to do their job.
 *
 * Kept to two, and both are self-evidently unavoidable: this test names the
 * characters it bans, and AGENTS.md shows before/after examples of the rule.
 */
const EXEMPT_FILES = new Set(["AGENTS.md", "src/lib/no-em-dash.test.ts"]);

/**
 * The single legitimate use inside otherwise-normal code.
 *
 * This regex STRIPS these characters so the PDF font can render the text, so it
 * necessarily contains them. Allow-listed by exact line content rather than by
 * file, so any other em dash in that same file still fails.
 */
const ALLOWED_LINES = new Set([`src/app/doctor-summary.tsx:    .replace(/[–—]/g, "-")`]);

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { encoding: "utf8", cwd: process.cwd() })
    .split("\n")
    .filter(Boolean)
    .filter((f) => !EXEMPT_FILES.has(f));
}

function offendingLines(): string[] {
  const files = trackedFiles();
  if (files.length === 0) return [];

  let raw = "";
  try {
    raw = execFileSync(
      "grep",
      [
        "-n",
        // Two literal patterns, NOT a character class. A class like [—–] is
        // matched byte-wise outside a UTF-8 locale, so it also matches "…",
        // "→" and curly quotes, which share the same leading bytes. That bug
        // made an earlier version of this test flag dozens of innocent lines.
        "-e",
        "—",
        "-e",
        "–",
        ...files,
      ],
      { encoding: "utf8", cwd: process.cwd(), maxBuffer: 32 * 1024 * 1024 },
    );
  } catch (err) {
    // grep exits 1 when it matches nothing, which is the passing case.
    const e = err as { status?: number; stdout?: string };
    if (e.status === 1) return [];
    raw = e.stdout ?? "";
  }

  return raw
    .split("\n")
    .filter(Boolean)
    .filter((line) => {
      // "path:lineno:content" -> "path:content", so the allow-list survives the
      // line moving up or down the file.
      const m = line.match(/^([^:]+):\d+:(.*)$/);
      if (!m) return true;
      return !ALLOWED_LINES.has(`${m[1]}:${m[2]}`);
    });
}

describe("house style", () => {
  it("has no em or en dashes in any tracked file", () => {
    const offenders = offendingLines();
    expect(
      offenders,
      `Em or en dash found. Replace with a comma, colon, semicolon or full stop.\n` +
        `Replace the character only: do not tidy the punctuation around it, or a rule\n` +
        `collapsing "," followed by "." will eat spread syntax ([a, ...b] -> [a...b]).\n\n` +
        offenders.join("\n"),
    ).toEqual([]);
  });

  it("actually scans the whole repo, not a hand-picked subset", () => {
    // Guards the failure this test was rewritten to fix. If the file list ever
    // narrows back to a few directories, this notices.
    const files = trackedFiles();
    expect(files.length).toBeGreaterThan(100);
    for (const dir of ["e2e/", "scripts/", "docs/", "supabase/", "src/"]) {
      expect(files.some((f) => f.startsWith(dir)), `nothing from ${dir} is scanned`).toBe(true);
    }
  });
});
