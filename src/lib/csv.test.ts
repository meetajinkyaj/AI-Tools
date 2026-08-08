import { describe, expect, it } from "vitest";

import { escapeCell, reportFilename, toCsv } from "./csv";

describe("escapeCell, quoting", () => {
  it("leaves an ordinary value alone", () => {
    expect(escapeCell("oura")).toBe("oura");
    expect(escapeCell(42)).toBe("42");
  });

  it("quotes a field containing a comma", () => {
    // Without this, one value with a comma shifts every column to its right,
    // for that row only, which is the kind of corruption somebody finds three
    // months later in a spreadsheet they have been deciding from.
    expect(escapeCell("oura, whoop")).toBe('"oura, whoop"');
  });

  it("doubles embedded quotes", () => {
    expect(escapeCell('he said "hi"')).toBe('"he said ""hi"""');
  });

  it("quotes newlines and carriage returns", () => {
    expect(escapeCell("line one\nline two")).toBe('"line one\nline two"');
    expect(escapeCell("a\r\nb")).toBe('"a\r\nb"');
  });

  it("writes nothing for null and undefined, not the words", () => {
    // "null" in a column reads as data. Empty reads as absent, which is true.
    expect(escapeCell(null)).toBe("");
    expect(escapeCell(undefined)).toBe("");
    expect(escapeCell("")).toBe("");
  });

  it("keeps false and zero, which are values and not absence", () => {
    expect(escapeCell(false)).toBe("false");
    expect(escapeCell(0)).toBe("0");
  });
});

describe("escapeCell, formula injection", () => {
  /**
   * The security case. Excel, LibreOffice and Sheets evaluate a cell whose text
   * starts with one of these, so a member controlling their own email or invite
   * code can write a formula into an admin's spreadsheet that runs when the
   * admin opens the export. Their data, their machine, our file.
   */
  it("neutralises every character a spreadsheet treats as a formula start", () => {
    for (const bad of ["=", "+", "-", "@"]) {
      const out = escapeCell(`${bad}HYPERLINK("http://evil.example")`);
      expect(out.startsWith("\t") || out.startsWith('"\t'), bad).toBe(true);
    }
  });

  it("neutralises a leading tab or carriage return, which also trigger it", () => {
    expect(escapeCell("\t=1+1")).toMatch(/^"?\t/);
    expect(escapeCell("\r=1+1")).toMatch(/^"/);
  });

  it("puts the guard INSIDE the quotes when the field is also quoted", () => {
    // Outside, the tab would be a stray character in the row rather than part
    // of the cell, and in a TSV it would be a separator.
    const out = escapeCell('=cmd|"/c calc"!A1');
    expect(out.startsWith('"\t')).toBe(true);
  });

  it("does not mangle a value that merely CONTAINS one of the characters", () => {
    // Only the first character matters, so ordinary data is untouched.
    expect(escapeCell("a+b")).toBe("a+b");
    expect(escapeCell("user@example.com")).toBe("user@example.com");
    expect(escapeCell("2026-08-07")).toBe("2026-08-07");
  });

  it("guards a negative number, which is the false positive worth accepting", () => {
    // "-5" starts with a formula character. Prefixing it keeps the sheet safe
    // at the cost of that cell being text, which is the right trade when the
    // alternative is executing member-supplied input.
    expect(escapeCell(-5)).toBe("\t-5");
  });
});

describe("toCsv", () => {
  it("writes a header row and CRLF line endings", () => {
    // RFC 4180, and Excel on Windows is inconsistent about a bare LF inside a
    // quoted field. Unix readers cope with CRLF; the reverse is not reliable.
    const out = toCsv(["email", "devices"], [["a@b.com", "oura"]]);
    expect(out).toBe("email,devices\r\na@b.com,oura");
  });

  it("handles an empty row set without producing a stray line", () => {
    expect(toCsv(["a", "b"], [])).toBe("a,b");
  });

  it("escapes the header too, since column names are not always ours", () => {
    expect(toCsv(["a,b"], [])).toBe('"a,b"');
  });
});

describe("reportFilename", () => {
  it("dates the file so two exports can be told apart", () => {
    expect(reportFilename("ikigaro members", "2026-08-07")).toBe("ikigaro-members-2026-08-07.csv");
  });

  it("strips anything that would be awkward in a filename", () => {
    expect(reportFilename("members/2026", "2026-08-07")).toBe("members-2026-2026-08-07.csv");
  });
});
