import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/**
 * Every tappable thing in the member app is at least 44px.
 *
 * WHY THIS IS A TEST AND NOT A CSS RULE. The handoff asks for a 44px minimum on
 * touch targets, and the obvious way to deliver that is one blanket rule:
 * `button { min-height: 44px }`. It was tried and it is wrong here. Half the
 * controls in this app sit in dense rows, next to a value they annotate, and
 * growing the BOX by 14px pushes those rows apart everywhere at once. The
 * design's own screens show tight rows and large hit areas at the same time,
 * which a box rule cannot give you.
 *
 * So the 44px lives in `.iki-tap`, which centres a 44px pseudo-element on a
 * control without changing the space the control occupies. That is opt-in, and
 * opt-in is exactly the kind of guarantee that decays: the next small ✕ someone
 * adds will not have it, nothing will look broken on a desktop mouse, and the
 * only person who finds out is a member on a phone missing the button twice.
 *
 * Hence this. It reads the source and asserts that every `<button>` in the
 * member-facing app carries either `.iki-tap` or a class that is already at
 * least 44px tall on its own. It is a lint rule that happens to be written in
 * Vitest, in the same spirit as `no-em-dash.test.ts`.
 */

/**
 * Class markers that mean "this control is already tall enough".
 *
 * Two kinds: the component classes in `globals.css` whose declared min-height
 * is >= 44px, and Tailwind heights that resolve to >= 44px (h-11 is 44). If you
 * change one of those component classes to be shorter, change it here too.
 */
const SAFE = [
  "iki-tap", //            the 44px halo itself
  "iki-btn", //            48 primary, 46 secondary, 44 ceremonial
  "primaryButtonClass", //  h-11 in ui.tsx
  "secondaryButtonClass", // h-11 in ui.tsx
  "iki-nav-item", //       54
  "iki-nav-fab", //        --spacing-fab
  "iki-row-sheet", //      --spacing-sheet-row
  "iki-tile", //           --spacing-tile
  "iki-segmented-option", // 44
  "iki-energy-cell", //    46
  "iki-code", //           44
  "iki-switch", //         28 tall, carries its own halo (see globals.css)
  "min-h-tap",
  "min-h-ctl",
  "h-11",
  "h-12",
  "h-14",
  "h-16",
];

/**
 * The admin console is exempt.
 *
 * It is a desktop tool behind an allow-list, used by one person with a mouse,
 * and its tables are dense on purpose. Applying a phone's touch minimum to a
 * spreadsheet is not an improvement; it is a different product. If admin ever
 * gets a phone layout, delete these two lines and do the work.
 */
const EXEMPT = /^admin-/;

const APP_DIR = join(process.cwd(), "src", "app");

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(path));
    else if (entry.name.endsWith(".tsx") && !EXEMPT.test(entry.name)) out.push(path);
  }
  return out;
}

/**
 * Every `<button ...>` opening tag in a file, with its line number.
 *
 * Braces are counted so that a `>` inside an arrow function in a prop, which
 * is how nearly every handler in this codebase is written, does not end the tag
 * early. A naive regex stops at `onClick={() =>` and then reads a className
 * that is not there, which passes everything and tests nothing.
 */
function buttonTags(source: string): { tag: string; line: number }[] {
  const out: { tag: string; line: number }[] = [];
  let i = 0;
  while ((i = source.indexOf("<button", i)) >= 0) {
    let depth = 0;
    let j = i + "<button".length;
    for (; j < source.length; j += 1) {
      const c = source[j];
      if (c === "{") depth += 1;
      else if (c === "}") depth -= 1;
      else if (c === ">" && depth === 0) break;
    }
    out.push({ tag: source.slice(i, j + 1), line: source.slice(0, i).split("\n").length });
    i = j + 1;
  }
  return out;
}

describe("touch targets", () => {
  it("gives every button in the member app a 44px hit area", () => {
    const offenders: string[] = [];
    let checked = 0;

    for (const file of tsxFiles(APP_DIR)) {
      const source = readFileSync(file, "utf8");
      for (const { tag, line } of buttonTags(source)) {
        checked += 1;
        if (SAFE.some((marker) => tag.includes(marker))) continue;
        offenders.push(`${file.replace(process.cwd() + "/", "")}:${line}`);
      }
    }

    // A guard on the scanner itself. If a refactor moved every button behind a
    // component and this found none, the assertion below would pass while
    // checking nothing at all.
    expect(checked).toBeGreaterThan(50);
    expect(
      offenders,
      "Add `iki-tap` to these, or a class that is already 44px tall. See docs/DESIGN_TOKENS.md section 7.",
    ).toEqual([]);
  });

  it("finds the whole tag, not just up to the first arrow function", () => {
    // The bug the brace counting exists to prevent.
    const [found] = buttonTags(
      `<button type="button" onClick={() => go()} className="iki-tap px-2">x</button>`,
    );
    expect(found.tag).toContain("iki-tap");
  });
});
