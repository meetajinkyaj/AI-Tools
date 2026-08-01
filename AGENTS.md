<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes. APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# House style

## Never use em dashes

No `—` (em dash) and no `–` (en dash) anywhere: user-facing copy, emails, docs,
code comments, commit messages, PR descriptions.

Use a comma, a colon, a semicolon, brackets, or a full stop. Almost every em
dash is doing a job one of those does better:

| Instead of | Write |
|---|---|
| `Plain text — blank lines become paragraphs.` | `Plain text. Blank lines become paragraphs.` |
| `Sleep, steps and HRV — from your ring.` | `Sleep, steps and HRV, from your ring.` |
| `Two reasons — speed and cost.` | `Two reasons: speed and cost.` |

For a "no value" placeholder in a table or field, use a plain hyphen `-`.

`src/lib/no-em-dash.test.ts` enforces this across the repo and will fail the
build. Check before committing:

```bash
grep -rn -e "—" -e "–" src docs supabase workers *.md --exclude-dir=node_modules
```

That grep will report this file and the test, because both have to spell out
the characters they ban. Those two are the only expected hits.

### The one legitimate exception

`src/app/doctor-summary.tsx` contains `.replace(/[–—]/g, "-")`. That regex
*strips* these characters so the PDF font can render the text, so it has to
contain them. It is allow-listed in the test. Do not "fix" it.

### If you are doing a bulk removal

Replace the dash characters only. Do not "tidy" the punctuation around them
afterwards: a cleanup pass collapsing `,` followed by `.` will silently eat
JavaScript spread syntax (`[a, ...b]` becomes `[a...b]`), which breaks the
build in a way that looks unrelated to the edit.
