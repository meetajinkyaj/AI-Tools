#!/usr/bin/env node
/**
 * Check our Oura field mappings against Oura's own sandbox.
 *
 * WHY THIS EXISTS. Every adapter in this repo was written from documentation,
 * and four of four turned out wrong: a field read from the wrong place, so the
 * metric was silently never emitted and nothing failed. Oura is the only vendor
 * that offers a way to catch that without owning the hardware.
 *
 * `/v2/sandbox/usercollection/<collection>` mirrors the production endpoints
 * and returns deterministic sample data with no connected ring.
 *
 * WHAT IT PROVES AND WHAT IT DOES NOT. It proves the field PATHS we read exist
 * and carry numbers of a plausible shape. It cannot prove the SEMANTICS: that
 * `stress_high` is seconds rather than minutes, or that `vascular_age` means
 * what we think, are still claims from their docs. A missing path is a
 * certainty; a present path is only encouraging.
 *
 * WHERE IT RUNS. `.github/workflows/oura-contract.yml` runs it on every change
 * to the adapter and weekly on a schedule, because most of what this guards
 * against does not arrive as a pull request: a vendor can rename a field on a
 * Tuesday and nothing in any diff explains why a metric stopped.
 *
 * It needs network access to `api.ouraring.com`. GitHub's runners have it; the
 * dev container's network policy denies that host outright, so running it there
 * reports INCONCLUSIVE rather than pretending to a result.
 *
 *     node scripts/verify-oura-sandbox.mjs
 *     node scripts/verify-oura-sandbox.mjs --token <an-oura-access-token>
 *
 * NO TOKEN IS NEEDED, BUT THE HEADER IS. The sandbox ignores what the
 * Authorization header contains and refuses the request when it is absent:
 * `400 {"detail":"Missing auth token. Include any string in 'Authorization'
 * header."}`. The first CI run said exactly that, nine times. "Ignored" and
 * "optional" are not the same thing, and reading the docs as the second cost a
 * round trip. A placeholder is sent when no token is given.
 *
 * Pass a real one only if the sandbox ever starts checking, and never commit
 * it.
 *
 * Exit codes, kept distinct so a caller can tell a finding from a failure to
 * look: 0 every required path found, 1 a required path is genuinely missing,
 * 2 something could not be reached so nothing was proven.
 */

const BASE = "https://api.ouraring.com/v2/sandbox/usercollection";

/**
 * Every field the Oura adapter actually reads, by collection.
 *
 * KEEP THIS IN STEP WITH src/lib/wearables/providers.ts. It is a hand-kept
 * mirror rather than an import because that module is server-only and pulls in
 * the whole app; the cost is that adding a field there means adding it here,
 * and this comment is the reminder.
 *
 * `optional` marks the collections whose OAuth scope strings are undocumented
 * (Oura's newer portal grants `Stress` and `Heart Health` separately). Their
 * absence is information, not failure.
 */
const CHECKS = [
  { path: "daily_sleep", fields: ["day", "score"] },
  { path: "daily_readiness", fields: ["day", "score"] },
  { path: "daily_activity", fields: ["day", "steps", "active_calories"] },
  { path: "daily_spo2", fields: ["day", "spo2_percentage.average"] },
  {
    path: "sleep",
    fields: ["bedtime_end", "total_sleep_duration", "average_hrv", "lowest_heart_rate"],
  },
  { path: "daily_stress", fields: ["day", "stress_high", "recovery_high"], optional: true },
  { path: "daily_cardiovascular_age", fields: ["day", "vascular_age"], optional: true },
  { path: "vO2_max", fields: ["day", "vo2_max"], optional: true },
  {
    path: "workout",
    fields: ["id", "day", "activity", "start_datetime", "end_datetime"],
  },
];

/** Reads "a.b.c" out of an object, returning undefined rather than throwing. */
function at(obj, dotted) {
  return dotted.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function arg(name) {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

/**
 * Any non-empty string satisfies the sandbox. A real token is accepted too and
 * changes nothing, which is the point: this check must never need a credential
 * to run, or it stops running.
 */
const token = arg("--token") ?? process.env.OURA_SANDBOX_TOKEN ?? "sandbox";

// A week is enough: these are daily documents and the sandbox is synthetic.
const end = new Date().toISOString().slice(0, 10);
const start = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);

/**
 * Three outcomes, kept apart on purpose.
 *
 * `missing` means we read a path Oura does not send, which is the bug this
 * script hunts. `unreachable` means we never got to look. Reporting the second
 * as the first is exactly the ambiguity the script exists to remove, and it is
 * the same mistake that made "no data" and "wrong host" indistinguishable in
 * the Ultrahuman sync for a week.
 */
let missingCount = 0;
let unreachable = 0;
const lines = [];
/** Distinct HTTP statuses seen, so the summary can report rather than guess. */
const statuses = new Set();

for (const { path, fields, optional } of CHECKS) {
  const url = `${BASE}/${path}?start_date=${start}&end_date=${end}`;
  let body;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        // Always sent. Absent, the sandbox 400s before it looks at anything.
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      const detail = `${res.status} ${(await res.text()).slice(0, 120)}`;
      // A 403 on an optional collection is a real answer: the scope was not
      // granted. A 403 on a required one, or anything else, means we could not
      // look, which is a different thing from looking and finding nothing.
      statuses.add(res.status);
      lines.push(`${optional && res.status === 403 ? "?" : "-"} ${path.padEnd(26)} ${detail}`);
      if (!(optional && res.status === 403)) unreachable += 1;
      continue;
    }
    body = await res.json();
  } catch (err) {
    lines.push(`-  ${path.padEnd(26)} ${String(err).slice(0, 120)}`);
    unreachable += 1;
    continue;
  }

  const docs = body?.data ?? [];
  if (!Array.isArray(docs) || docs.length === 0) {
    // An empty collection cannot confirm or deny a field path. Saying so is the
    // point: this is exactly the ambiguity the script exists to remove, and
    // pretending otherwise would recreate it.
    lines.push(`? ${path.padEnd(26)} responded, but returned no documents`);
    continue;
  }

  // Check every document, not just the first. A field present on one day and
  // absent on the next is the shape of an optional field, and worth seeing.
  const missing = fields.filter((f) => docs.every((d) => at(d, f) === undefined));
  const partial = fields.filter(
    (f) => !missing.includes(f) && docs.some((d) => at(d, f) === undefined),
  );

  if (missing.length === 0) {
    const note = partial.length ? `  (sometimes absent: ${partial.join(", ")})` : "";
    lines.push(`ok ${path.padEnd(26)} ${docs.length} docs, all fields found${note}`);
  } else {
    lines.push(`x  ${path.padEnd(26)} MISSING: ${missing.join(", ")}`);
    if (!optional) missingCount += 1;
    // Naming the keys that ARE there is what turns "it broke" into a fix.
    lines.push(`   ${" ".repeat(26)} keys present: ${Object.keys(docs[0]).join(", ")}`);
  }
}

console.log(`Oura sandbox check, ${start} to ${end}\n`);
console.log(lines.join("\n"));
console.log("");
if (unreachable > 0) {
  // Report the status rather than assuming a cause. The first version of this
  // message guessed "network allowlist", and the real answer that run was a
  // missing header, so the guess actively pointed away from the fix.
  const seen = [...statuses].sort().join(", ");
  console.log(
    `INCONCLUSIVE. ${unreachable} collection(s) could not be checked, so nothing\n` +
      `was proven about them. HTTP status(es) seen: ${seen || "none, request failed"}.\n` +
      "Read the detail on the lines above before assuming a cause: 403 with\n" +
      "'Host not in allowlist' is this environment's network policy, while a 4xx\n" +
      "from Oura itself is telling you what it wants.",
  );
}
if (missingCount > 0) {
  console.log(
    `\nFOUND A REAL PROBLEM. ${missingCount} required collection(s) responded but\n` +
      "did not carry a field the adapter reads. That metric is silently never\n" +
      "emitted today. Fix src/lib/wearables/providers.ts against the keys listed.",
  );
}
if (unreachable === 0 && missingCount === 0) {
  console.log("Every required field path was found.");
}
console.log(
  "\nLegend: ok found  ·  x responded but a field is missing  ·  - could not\n" +
    "check  ·  ? optional collection refused, which is expected while Oura's\n" +
    "Stress and Heart Health scope strings remain undocumented.",
);
// Only a genuine mismatch is a failure. Being unable to look is not a pass
// either, so it exits 2 and a caller can tell the two apart.
process.exit(missingCount > 0 ? 1 : unreachable > 0 ? 2 : 0);
