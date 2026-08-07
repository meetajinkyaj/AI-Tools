/**
 * Folding what people type into something countable.
 *
 * A suggestion box collects "oura", "Oura Ring", "OURA RING 4", "oura ring gen
 * 3" and "ourua". Counted literally that is five devices with one vote each,
 * and the tally, whose only job is to say how many people want a thing, * reports the opposite of the truth. Every entry below exists because a real
 * person could plausibly type it.
 *
 * THE RULE: fold aggressively onto names we KNOW, and not at all otherwise.
 *
 * A wrong merge is far more expensive than a missed one. If "Apple Watch" gets
 * folded into "Apple Health" the tally is quietly, permanently wrong and
 * nothing in the UI will ever reveal it. If a new device fails to match, it
 * stands as its own entry, we see it in the admin list, and we add an alias in
 * one line. So: no stemming, no fuzzy distance, no stripping words like "ring"
 * to see what's left. An explicit alias table, or nothing.
 *
 * `raw_text` is stored alongside the key precisely so a bad fold is visible.
 */

export interface DeviceMatch {
  /** Canonical bucket. Counting and grouping happen on this. */
  key: string;
  /** Display name for the admin tally. */
  label: string;
  /** True when we already integrate it, changes what the user is told. */
  supported: boolean;
  /**
   * True when we know it cannot be integrated today, with `reason` saying why.
   * Being able to answer "we looked, and here is what blocks it" is worth more
   * than silence.
   */
  blocked?: boolean;
  reason?: string;
}

interface DeviceEntry extends Omit<DeviceMatch, "key"> {
  key: string;
  /**
   * Every spelling that maps here, already lowercased and space-collapsed.
   * The canonical label's own normalised form is added automatically.
   */
  aliases: string[];
}

/**
 * The devices we can recognise.
 *
 * `supported` ones are in the list because people will ask for a device we
 * already integrate, which is not noise. Before launch it says which vendor
 * application to chase first; after launch it says the device is in the list
 * but the user did not find it, which is a discoverability bug, not a request.
 */
const DEVICES: DeviceEntry[] = [
  // ---- Already integrated -------------------------------------------------
  {
    key: "oura",
    label: "Oura Ring",
    supported: true,
    aliases: ["oura", "oura ring", "oura ring 3", "oura ring 4", "oura gen 3", "oura gen 4", "ourah", "aura ring"],
  },
  {
    key: "fitbit",
    label: "Fitbit",
    supported: true,
    aliases: ["fitbit", "fit bit", "google fitbit", "fitbit charge", "fitbit sense", "fitbit versa", "fitbit inspire"],
  },
  {
    key: "whoop",
    label: "Whoop",
    supported: true,
    aliases: ["whoop", "woop", "whoop strap", "whoop 4", "whoop 4.0", "whoop 5", "whoop mg"],
  },
  {
    key: "withings",
    label: "Withings",
    supported: true,
    aliases: ["withings", "withing", "withings body", "withings scale", "withings sleep", "nokia health"],
  },
  {
    key: "garmin",
    label: "Garmin",
    supported: true,
    aliases: ["garmin", "garmin connect", "garmin watch", "forerunner", "fenix", "garmin fenix", "garmin venu", "vivoactive", "garmin instinct", "epix"],
  },
  {
    key: "ultrahuman",
    label: "Ultrahuman",
    supported: true,
    aliases: ["ultrahuman", "ultra human", "ultrahuman ring", "ultrahuman ring air", "uh ring"],
  },

  // ---- On the roadmap, blocked on a native app ----------------------------
  {
    key: "apple_health",
    label: "Apple Health",
    supported: false,
    blocked: true,
    reason: "On-device API, needs our iOS app.",
    aliases: ["apple health", "applehealth", "healthkit", "health kit", "apple health kit", "ios health", "iphone health", "apple health app"],
  },
  {
    key: "google_health_connect",
    label: "Google Health Connect",
    supported: false,
    blocked: true,
    reason: "On-device API, needs our Android app.",
    aliases: ["health connect", "google health connect", "google health", "google fit", "googlefit", "android health", "samsung health connect"],
  },
  // Deliberately its own entry, NOT folded into Apple Health. An Apple Watch
  // reaches us through HealthKit, but someone naming the watch is telling us
  // about hardware they own, which is a different fact from asking for the
  // platform integration.
  {
    key: "apple_watch",
    label: "Apple Watch",
    supported: false,
    blocked: true,
    reason: "Reaches us via Apple Health, needs our iOS app.",
    aliases: ["apple watch", "applewatch", "iwatch", "apple watch ultra", "apple watch series", "watch os", "watchos"],
  },

  // ---- Public API, no adapter yet -----------------------------------------
  //
  // These have a real, documented API and are queued rather than blocked. The
  // distinction matters in the admin list: a request for one of these is a
  // roadmap item, while a request for something below is an answer we can give
  // the member today.
  {
    key: "polar",
    label: "Polar",
    supported: false,
    reason:
      "Queued. Polar's AccessLink API is self-serve with no approval period, " +
      "which makes it the least gated integration left.",
    aliases: ["polar", "polar flow", "polar vantage", "polar h10", "polar ignite"],
  },
  {
    key: "coros",
    label: "Coros",
    supported: false,
    reason:
      "Queued. Coros have an API but it is partner-only: access needs an " +
      "application and their approval, like Garmin and Ultrahuman.",
    aliases: ["coros", "coros pace", "coros apex", "coros vertix"],
  },

  // ---- No public API today ------------------------------------------------
  //
  // CHECK BEFORE ADDING TO THIS LIST. Polar and Coros sat here for weeks and
  // both were wrong: Polar's API is self-serve and Coros publish an
  // application form. "No public API" is a claim about a vendor, and vendors
  // change; it is worth ten minutes on their developer site before asserting
  // it, because nobody re-checks a line like this once it is written.
  {
    key: "fittr_hart",
    label: "Fittr HART",
    supported: false,
    blocked: true,
    reason: "No public API, and the app cannot write to Apple Health.",
    aliases: ["fittr", "fittr hart", "fitr hart", "hart", "hart ring", "fittr ring", "fittr hart ring", "fitter ring", "fittr smart ring"],
  },
  {
    key: "samsung_galaxy_ring",
    label: "Samsung Galaxy Ring",
    supported: false,
    aliases: ["samsung galaxy ring", "galaxy ring", "samsung ring"],
  },
  {
    key: "samsung_health",
    label: "Samsung Health",
    supported: false,
    aliases: ["samsung health", "samsung", "galaxy watch", "samsung galaxy watch", "samsung watch"],
  },
  {
    key: "ringconn",
    label: "RingConn",
    supported: false,
    aliases: ["ringconn", "ring conn", "ringconn gen 2", "ringconn gen 3"],
  },
  {
    key: "amazfit",
    label: "Amazfit / Zepp",
    supported: false,
    aliases: ["amazfit", "zepp", "zepp health", "amazfit helio", "helio ring", "amazfit gtr", "amazfit t rex"],
  },
  {
    key: "suunto",
    label: "Suunto",
    supported: false,
    aliases: ["suunto", "suunto race", "suunto vertical"],
  },
  {
    key: "circular",
    label: "Circular Ring",
    supported: false,
    aliases: ["circular", "circular ring", "circular ring 2"],
  },
  {
    key: "pixel_watch",
    label: "Google Pixel Watch",
    supported: false,
    aliases: ["pixel watch", "google pixel watch", "pixel watch 3", "pixel watch 4"],
  },
  {
    key: "xiaomi",
    label: "Xiaomi / Mi Band",
    supported: false,
    aliases: ["xiaomi", "mi band", "mi fitness", "xiaomi smart band", "redmi watch", "mi watch"],
  },
  {
    key: "noise",
    label: "Noise",
    supported: false,
    aliases: ["noise", "noise luna", "noise luna ring", "noise colorfit", "gonoise"],
  },
  {
    key: "boat",
    label: "boAt",
    supported: false,
    aliases: ["boat", "boat smart ring", "boat wave", "boat lunar"],
  },
  {
    key: "strava",
    label: "Strava",
    supported: false,
    aliases: ["strava"],
  },
  {
    key: "myfitnesspal",
    label: "MyFitnessPal",
    supported: false,
    aliases: ["myfitnesspal", "my fitness pal", "mfp"],
  },
  {
    key: "cgm",
    label: "CGM (glucose monitor)",
    supported: false,
    aliases: ["cgm", "continuous glucose monitor", "libre", "freestyle libre", "abbott libre", "dexcom", "ultrahuman m1", "glucose monitor"],
  },
  {
    key: "eight_sleep",
    label: "Eight Sleep",
    supported: false,
    aliases: ["eight sleep", "8 sleep", "eightsleep", "eight sleep pod"],
  },
];

/** Longest alias first, so "oura ring 4" wins over "oura" on an exact pass. */
const ALIAS_INDEX: Map<string, DeviceEntry> = (() => {
  const m = new Map<string, DeviceEntry>();
  for (const d of DEVICES) {
    for (const a of [...d.aliases, normalize(d.label)]) {
      if (a) m.set(a, d);
    }
  }
  return m;
})();

/**
 * Lowercase, strip punctuation, collapse whitespace.
 *
 * Punctuation goes because "Oura Ring®", "oura-ring" and "oura ring" are one
 * device. Nothing else is removed, see the rule at the top of this file.
 */
export function normalize(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    // Drop combining marks left by the decomposition. Without this "Ōura"
    // becomes "o" + a lone macron, the macron is not a letter, and the next
    // rule turns it into a space, splitting the word into "o ura".
    .replace(/\p{M}+/gu, "")
    // Keep letters, digits and spaces. Everything else becomes a space rather
    // than vanishing, so "oura/whoop" does not become the word "ourawhoop".
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** The longest match wins, so "apple watch" never resolves as "apple". */
function longestAliasIn(text: string): DeviceEntry | null {
  let best: DeviceEntry | null = null;
  let bestLen = 0;
  for (const [alias, entry] of ALIAS_INDEX) {
    if (alias.length <= bestLen) continue;
    // Word-boundary containment: "i want oura" matches, "flourish" does not.
    const re = new RegExp(`(^|\\s)${alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\s)`);
    if (re.test(text)) {
      best = entry;
      bestLen = alias.length;
    }
  }
  return best;
}

/** How long a suggestion may be. Long enough for a device, short of an essay. */
export const MAX_SUGGESTION_LENGTH = 60;

/**
 * Resolve a typed suggestion to a bucket.
 *
 * Unrecognised input becomes its own key rather than being discarded, that is
 * the entire point of a free-text box, and the long tail is where the devices
 * we have not heard of live.
 */
export function matchDevice(raw: string): DeviceMatch | null {
  const text = normalize(raw).slice(0, MAX_SUGGESTION_LENGTH);
  if (text.length < 2) return null;

  const exact = ALIAS_INDEX.get(text);
  if (exact) {
    return { key: exact.key, label: exact.label, supported: exact.supported, blocked: exact.blocked, reason: exact.reason };
  }

  const contained = longestAliasIn(text);
  if (contained) {
    return {
      key: contained.key,
      label: contained.label,
      supported: contained.supported,
      blocked: contained.blocked,
      reason: contained.reason,
    };
  }

  // Unknown. Key off the normalised text so two people typing the same unknown
  // device still land together, and title-case it for the admin tally.
  return {
    key: `other:${text}`,
    label: text.replace(/\b\p{L}/gu, (c) => c.toUpperCase()),
    supported: false,
  };
}

/** True for keys minted from unrecognised input. Rendered differently in admin. */
export function isUnrecognised(key: string): boolean {
  return key.startsWith("other:");
}

/**
 * Names offered as autocomplete hints in the input.
 *
 * Hints, not a menu: the field stays free text. Their job is to nudge spelling
 * toward something the alias table already knows, which is cheaper than adding
 * aliases forever. Supported devices are excluded, suggesting a device we
 * already have is a confusing thing to be prompted toward.
 */
export const SUGGESTION_HINTS: string[] = DEVICES.filter((d) => !d.supported)
  .map((d) => d.label)
  .sort((a, b) => a.localeCompare(b));

/** One tallied device, as the admin dashboard reads it. */
export interface DeviceTally {
  key: string;
  label: string;
  /** Distinct users who asked. The number that matters. */
  count: number;
  /** How many of those want an email when it lands. */
  notifyCount: number;
  supported: boolean;
  blocked: boolean;
  reason?: string;
  unrecognised: boolean;
  /** Most recent request, for sorting ties toward what is live right now. */
  lastRequestedAt: string;
}

export interface RequestRow {
  device_key: string;
  raw_text: string;
  notify: boolean;
  created_at: string;
}

/**
 * Roll rows up into the ranked tally.
 *
 * Ranked by distinct users, then by recency. One row per user per device is
 * already guaranteed by the unique index, so a plain count is a people count.
 */
export function tallyRequests(rows: RequestRow[]): DeviceTally[] {
  const by = new Map<string, DeviceTally>();

  for (const r of rows) {
    const known = DEVICES.find((d) => d.key === r.device_key);
    const existing = by.get(r.device_key);
    if (existing) {
      existing.count += 1;
      if (r.notify) existing.notifyCount += 1;
      if (r.created_at > existing.lastRequestedAt) existing.lastRequestedAt = r.created_at;
      continue;
    }
    by.set(r.device_key, {
      key: r.device_key,
      // An unrecognised key carries no label of its own, so the first raw text
      // seen stands in for it.
      label: known?.label ?? r.raw_text,
      count: 1,
      notifyCount: r.notify ? 1 : 0,
      supported: known?.supported ?? false,
      blocked: known?.blocked ?? false,
      reason: known?.reason,
      unrecognised: isUnrecognised(r.device_key),
      lastRequestedAt: r.created_at,
    });
  }

  return [...by.values()].sort(
    (a, b) => b.count - a.count || b.lastRequestedAt.localeCompare(a.lastRequestedAt),
  );
}
