"use client";

import { useCallback, useEffect, useState } from "react";

import {
  AUDIENCES,
  MAX_BODY_LENGTH,
  MAX_SUBJECT_LENGTH,
  validateBroadcast,
  type AudienceId,
} from "@/lib/emails/broadcast";
import { ConfirmDialog, type ConfirmRequest } from "./confirm-dialog";
import { Card, Eyebrow, fieldClass, labelClass, primaryButtonClass, secondaryButtonClass } from "./ui";

/**
 * Admin → Email. Write an announcement, see who it reaches, send it.
 *
 * THE UI'S JOB IS TO SLOW YOU DOWN IN THE RIGHT PLACE. Everything else in this
 * console is reversible — a wrongly approved user can be re-waitlisted, a bad
 * voucher deleted. An email cannot be recalled. So the recipient count is
 * shown live rather than on the confirm screen, the test send sits directly
 * beside the real one, and the confirmation names the audience and the number
 * instead of asking "are you sure?".
 */

interface Broadcast {
  id: string;
  subject: string;
  audience: string;
  status: string;
  created_by: string;
  created_at: string;
  completed_at: string | null;
  stats: { sent: number; failed: number; pending: number };
}

export function BroadcastPanel({ getToken }: { getToken: () => Promise<string | null> }) {
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [audience, setAudience] = useState<AudienceId>("approved");
  const [count, setCount] = useState<number | null>(null);
  const [history, setHistory] = useState<Broadcast[]>([]);
  const [configured, setConfigured] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const authed = useCallback(
    async (path: string, init?: RequestInit) => {
      const token = await getToken();
      return fetch(path, {
        ...init,
        headers: {
          ...(init?.headers ?? {}),
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      });
    },
    [getToken],
  );

  const loadHistory = useCallback(async () => {
    try {
      const res = await authed("/api/admin/broadcasts");
      if (!res.ok) return;
      const b = (await res.json()) as { broadcasts: Broadcast[]; configured: boolean };
      setHistory(b.broadcasts);
      setConfigured(b.configured);
    } catch {
      /* the composer still works */
    }
  }, [authed]);

  const loadCount = useCallback(async () => {
    try {
      const res = await authed(`/api/admin/broadcasts?audience=${audience}`);
      if (!res.ok) return;
      setCount(((await res.json()) as { count: number }).count);
    } catch {
      setCount(null);
    }
  }, [authed, audience]);

  useEffect(() => {
    void (async () => {
      await loadHistory();
    })();
  }, [loadHistory]);

  useEffect(() => {
    void (async () => {
      await loadCount();
    })();
  }, [loadCount]);

  const valid = validateBroadcast(subject, body);

  const sendTest = async () => {
    setBusy("test");
    setMsg(null);
    try {
      const res = await authed("/api/admin/broadcasts", {
        method: "POST",
        body: JSON.stringify({ subject, body, audience, test: true }),
      });
      const b = (await res.json()) as { error?: string };
      setMsg(
        res.ok
          ? { text: "Test sent to you. Check how it looks before sending for real.", ok: true }
          : { text: b.error ?? "Test send failed.", ok: false },
      );
    } finally {
      setBusy(null);
    }
  };

  const doSend = async () => {
    const res = await authed("/api/admin/broadcasts", {
      method: "POST",
      body: JSON.stringify({ subject, body, audience }),
    });
    const b = (await res.json()) as {
      error?: string;
      sent?: number;
      failed?: number;
      remaining?: number;
    };
    if (!res.ok) {
      setMsg({ text: b.error ?? "Send failed.", ok: false });
      return;
    }
    setSubject("");
    setBody("");
    setMsg({
      text:
        `Sent to ${b.sent ?? 0}.` +
        (b.failed ? ` ${b.failed} failed.` : "") +
        // A partial send is an ordinary outcome, not an error — say so plainly
        // and say what finishes it.
        (b.remaining ? ` ${b.remaining} still queued — use Resume below.` : ""),
      ok: !b.failed,
    });
    await loadHistory();
  };

  const requestSend = () => {
    const label = AUDIENCES.find((a) => a.id === audience)?.label ?? audience;
    setConfirm({
      title: `Send to ${count ?? "?"} ${count === 1 ? "person" : "people"}?`,
      body: `"${subject}" goes to ${label.toLowerCase()} now. Email cannot be recalled once sent. People who have unsubscribed are already excluded from this count.`,
      confirmLabel: "Send it",
      onConfirm: async () => {
        setConfirmBusy(true);
        try {
          await doSend();
        } finally {
          setConfirmBusy(false);
          setConfirm(null);
        }
      },
    });
  };

  const resume = async (id: string) => {
    setBusy(id);
    try {
      const res = await authed("/api/admin/broadcasts", {
        method: "POST",
        body: JSON.stringify({ resume: id }),
      });
      const b = (await res.json()) as { sent?: number; remaining?: number; error?: string };
      setMsg(
        res.ok
          ? {
              text: `Sent ${b.sent ?? 0} more.${b.remaining ? ` ${b.remaining} still queued.` : " All done."}`,
              ok: true,
            }
          : { text: b.error ?? "Resume failed.", ok: false },
      );
      await loadHistory();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {!configured && (
        <Card className="p-4 font-body text-sm text-muted">
          Email isn&rsquo;t configured on this environment, so nothing can be sent yet.
        </Card>
      )}

      <Card className="flex flex-col gap-4 p-5">
        <Eyebrow>New announcement</Eyebrow>

        <div className="flex flex-col gap-1">
          <label className={labelClass} htmlFor="bc-subject">
            Subject
          </label>
          <input
            id="bc-subject"
            value={subject}
            maxLength={MAX_SUBJECT_LENGTH}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Oura is now connectable"
            className={fieldClass}
          />
        </div>

        <div className="flex flex-col gap-1">
          <label className={labelClass} htmlFor="bc-body">
            Message
          </label>
          <textarea
            id="bc-body"
            value={body}
            rows={8}
            maxLength={MAX_BODY_LENGTH}
            onChange={(e) => setBody(e.target.value)}
            placeholder={"Plain text only.\n\nLeave a blank line between paragraphs."}
            className={`${fieldClass} resize-y`}
          />
          <p className="font-body text-xs text-muted">
            Plain text — blank lines become paragraphs. Links are not clickable;
            an &ldquo;Open Ikigaro&rdquo; button and an unsubscribe link are added automatically.
          </p>
        </div>

        <div className="flex flex-col gap-1">
          <label className={labelClass} htmlFor="bc-audience">
            Audience
          </label>
          <select
            id="bc-audience"
            value={audience}
            onChange={(e) => setAudience(e.target.value as AudienceId)}
            className={fieldClass}
          >
            {AUDIENCES.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} — {a.description}
              </option>
            ))}
          </select>
          <p className="font-body text-xs text-muted">
            {count === null
              ? "Counting…"
              : `${count} ${count === 1 ? "person" : "people"} will receive this. Unsubscribed and deleted accounts are already excluded.`}
          </p>
        </div>

        {msg && (
          <p
            role="status"
            className={`font-body text-sm ${msg.ok ? "text-foreground/80" : "text-accent-hover"}`}
          >
            {msg.ok ? "✓ " : ""}
            {msg.text}
          </p>
        )}

        <div className="flex flex-wrap gap-3">
          {/* Test first, deliberately placed before Send — the only way to see
              an email is to receive one. */}
          <button
            type="button"
            onClick={() => void sendTest()}
            disabled={!valid.ok || busy !== null || !configured}
            className={`${secondaryButtonClass} text-xs disabled:opacity-40`}
          >
            {busy === "test" ? "Sending…" : "Send test to me"}
          </button>
          <button
            type="button"
            onClick={requestSend}
            disabled={!valid.ok || busy !== null || !configured || !count}
            className={`${primaryButtonClass} text-xs disabled:opacity-40`}
          >
            Send to {count ?? "…"}
          </button>
        </div>

        {!valid.ok && (subject.length > 0 || body.length > 0) && (
          <p className="font-body text-xs text-muted">{valid.error}</p>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-5">
        <Eyebrow>Sent</Eyebrow>
        {history.length === 0 ? (
          <p className="font-body text-sm text-muted">Nothing sent yet.</p>
        ) : (
          <ul className="flex flex-col">
            {history.map((b) => (
              <li
                key={b.id}
                className="flex flex-wrap items-start justify-between gap-3 border-t border-border py-3 first:border-t-0 first:pt-0"
              >
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="font-body text-sm text-foreground">{b.subject}</span>
                  <span className="font-body text-xs text-muted">
                    {b.audience} · {new Date(b.created_at).toLocaleDateString()} · {b.stats.sent} sent
                    {b.stats.failed > 0 && ` · ${b.stats.failed} failed`}
                    {b.stats.pending > 0 && ` · ${b.stats.pending} queued`}
                  </span>
                </div>
                {b.stats.pending > 0 && (
                  <button
                    type="button"
                    onClick={() => void resume(b.id)}
                    disabled={busy !== null}
                    className={`${secondaryButtonClass} shrink-0 text-xs`}
                  >
                    {busy === b.id ? "Sending…" : "Resume"}
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {confirm && (
        <ConfirmDialog request={confirm} busy={confirmBusy} onCancel={() => setConfirm(null)} />
      )}
    </div>
  );
}
