"use client";

import { useCallback, useEffect, useId, useState } from "react";

import { MAX_SUGGESTION_LENGTH, SUGGESTION_HINTS } from "@/lib/device-requests";
import { secondaryButtonClass } from "./ui";

/**
 * "Don't see your device?", the suggestion box under Connected devices.
 *
 * WHY IT LIVES HERE AND NOWHERE ELSE. The moment a person looks at the list of
 * devices we support and does not find theirs is the only moment they are
 * certain to have an opinion about which device we should add. Asking anywhere
 * else, a survey, an email, asks someone to remember a feeling they had once.
 *
 * It renders whether or not any vendor is live, deliberately. Before launch it
 * is the only thing on the screen a user can actually do, and the answers are
 * worth most then, because they still decide which vendor we chase.
 */

interface SuggestionRow {
  device_key: string;
  raw_text: string;
  notify: boolean;
}

interface PostResult {
  ok?: boolean;
  error?: string;
  device?: { key: string; label: string; supported: boolean; blocked: boolean };
}

export function DeviceSuggest({ getToken }: { getToken: () => Promise<string | null> }) {
  const [rows, setRows] = useState<SuggestionRow[] | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const listId = useId();

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch("/api/wearables/requests", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const body = (await res.json()) as { requests: SuggestionRow[] };
      setRows(body.requests);
    } catch {
      // Suggesting a device is not important enough to break Settings over.
      setRows([]);
    }
  }, [getToken]);

  useEffect(() => {
    void (async () => {
      await load();
    })();
  }, [load]);

  const notifyOn = (rows ?? []).some((r) => r.notify);

  const submit = async () => {
    const device = text.trim();
    if (!device || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const token = await getToken();
      if (!token) return;
      const res = await fetch("/api/wearables/requests", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        // Inherit the choice already made rather than resetting it to off on
        // every addition, the checkbox is about the list, not one entry.
        body: JSON.stringify({ device, notify: notifyOn }),
      });
      const body = (await res.json()) as PostResult;
      if (!res.ok) {
        setMessage(body.error ?? "Couldn't save that.");
        return;
      }
      setText("");
      await load();

      // Say something true about the specific device rather than a generic
      // thank-you. Someone asking for a device we already support has hit a
      // discoverability problem, and telling them so solves it on the spot.
      if (body.device?.supported) {
        setMessage(`${body.device.label} is already supported, look for it in the list above.`);
      } else {
        setMessage("Noted, thank you.");
      }
    } catch {
      setMessage("Couldn't save that.");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (key: string) => {
    setBusy(true);
    try {
      const token = await getToken();
      if (!token) return;
      await fetch(`/api/wearables/requests?key=${encodeURIComponent(key)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      setMessage(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const setNotify = async (next: boolean) => {
    setRows((prev) => (prev ? prev.map((r) => ({ ...r, notify: next })) : prev));
    try {
      const token = await getToken();
      if (!token) return;
      await fetch("/api/wearables/requests", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ notify: next }),
      });
    } catch {
      await load(); // put the checkbox back where the server thinks it is
    }
  };

  if (rows === null) return null;

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <p className="font-label text-[0.55rem] uppercase tracking-[0.24em] text-muted">
        Don&apos;t see your device?
      </p>
      <p className="font-body text-xs text-muted">
        Tell us what you use and we&apos;ll look at adding it next.
      </p>

      {rows.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {rows.map((r) => (
            <li
              key={r.device_key}
              className="flex items-center gap-1.5 rounded-pill border border-border px-3 py-1"
            >
              <span className="font-body text-xs text-foreground">{r.raw_text}</span>
              <button
                type="button"
                onClick={() => void remove(r.device_key)}
                disabled={busy}
                aria-label={`Remove ${r.raw_text}`}
                className="font-body text-xs leading-none text-muted hover:text-foreground"
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="flex gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void submit();
            }
          }}
          list={listId}
          maxLength={MAX_SUGGESTION_LENGTH}
          placeholder="e.g. Samsung Galaxy Ring"
          aria-label="Suggest a device"
          className="min-w-0 flex-1 rounded-pill border border-border bg-transparent px-4 py-2 font-body text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none"
        />
        {/* Hints, not a menu, the field stays free text so the devices we have
            never heard of can still be named. */}
        <datalist id={listId}>
          {SUGGESTION_HINTS.map((h) => (
            <option key={h} value={h} />
          ))}
        </datalist>
        <button
          type="button"
          onClick={() => void submit()}
          disabled={busy || text.trim().length === 0}
          className={`${secondaryButtonClass} shrink-0 text-xs disabled:opacity-40`}
        >
          Add
        </button>
      </div>

      {rows.length > 0 && (
        <label className="flex items-center gap-2 font-body text-xs text-muted">
          <input
            type="checkbox"
            checked={notifyOn}
            onChange={(e) => void setNotify(e.target.checked)}
            className="accent-accent"
          />
          Email me when one of these is added
        </label>
      )}

      {message && (
        <p role="status" className="font-body text-xs text-foreground">
          {message}
        </p>
      )}
    </div>
  );
}
