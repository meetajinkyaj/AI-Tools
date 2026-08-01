import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/**
 * House style: no em dashes, anywhere.
 *
 * WHY A TEST AND NOT A LINT RULE. ESLint sees TypeScript. Most of the copy a
 * reader actually meets lives in Markdown, SQL comments and email templates,
 * none of which ESLint parses. A repo-wide grep is the only check that covers
 * the same surface a person does.
 *
 * It caught the real failure mode too: a bulk removal that "tidied" punctuation
 * around each dash silently rewrote `[a, ...b]` into `[a...b]`, breaking the
 * build somewhere unrelated to the edit. The rule is to replace the character
 * and nothing else. See AGENTS.md.
 */

/**
 * The single legitimate use in the codebase.
 *
 * This regex STRIPS these characters so the PDF font can render the text, so
 * it necessarily contains them. Allow-listed by exact line rather than by file,
 * so a new em dash elsewhere in the same file still fails.
 */
const ALLOWED = new Set([`src/app/doctor-summary.tsx:    .replace(/[–—]/g, "-")`]);

function offendingLines(): string[] {
  let raw = "";
  try {
    raw = execFileSync(
      "grep",
      [
        "-rn",
        // Two literal patterns, NOT a character class. A class like [—–] is
        // matched byte-wise outside a UTF-8 locale, so it also matches "…",
        // "→" and curly quotes, which share the same leading bytes.
        "-e",
        "—",
        "-e",
        "–",
        "src",
        "docs",
        "supabase",
        "workers",
        "--include=*.ts",
        "--include=*.tsx",
        "--include=*.md",
        "--include=*.sql",
        "--include=*.js",
        "--exclude-dir=node_modules",
        // This file states the characters it is looking for, so it always
        // matches itself. Excluding the checker rather than allow-listing four
        // of its own lines, which would break every time it is edited.
        "--exclude=no-em-dash.test.ts",
      ],
      { encoding: "utf8", cwd: process.cwd() },
    );
  } catch (err) {
    // grep exits 1 when it finds nothing, which is the passing case.
    const e = err as { status?: number; stdout?: string };
    if (e.status === 1) return [];
    raw = e.stdout ?? "";
  }

  return raw
    .split("\n")
    .filter(Boolean)
    .filter((line) => {
      // "path:lineno:content" -> "path:content", so the allow-list survives
      // the line moving.
      const m = line.match(/^([^:]+):\d+:(.*)$/);
      if (!m) return true;
      return !ALLOWED.has(`${m[1]}:${m[2]}`);
    });
}

describe("house style", () => {
  it("has no em or en dashes in code, copy, docs or migrations", () => {
    const offenders = offendingLines();
    expect(
      offenders,
      `Em or en dash found. Replace with a comma, colon, semicolon or full stop:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
