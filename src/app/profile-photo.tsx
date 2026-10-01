"use client";

import { useRef, useState } from "react";

import { prepareAvatar } from "@/lib/avatar-crop";

/** Two letters from a name, shown wherever there is no photo. */
export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

/**
 * A member's photo in a circle, or their initials when there is none (or the
 * signed link has lapsed: it falls back on error rather than showing a broken
 * image). The circle's size and border come from the caller's class.
 */
export function Avatar({
  url,
  name,
  className,
}: {
  url?: string | null;
  name: string;
  className: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const show = url && failed !== url;
  return (
    <span className={`${className} overflow-hidden`} aria-hidden>
      {show ? (
        // A signed, short-lived storage link; next/image would proxy and cache it.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="" className="h-full w-full object-cover" onError={() => setFailed(url)} />
      ) : (
        initialsOf(name)
      )}
    </span>
  );
}

/**
 * The 64px identity photo on Profile, with Add / Change / Remove.
 *
 * The circle itself is the button that opens the picker, and the text links
 * under the name say what it does. Saving is announced, since the picture
 * changing is not something a screen reader would mention on its own.
 */
export function ProfilePhoto({
  name,
  url,
  getToken,
  onChange,
}: {
  name: string;
  url?: string | null;
  getToken: () => Promise<string | null>;
  onChange: (url: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<null | "saving" | "removing">(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);

  const upload = async (file: File) => {
    setError(null);
    setBusy("saving");
    setStatus("Saving your photo.");
    try {
      const blob = await prepareAvatar(file);
      const token = await getToken();
      if (!token) throw new Error("You're not signed in. Please reload and try again.");
      const res = await fetch("/api/profile/avatar", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": blob.type },
        body: blob,
      });
      const data = (await res.json()) as { avatar_url?: string | null; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Couldn't save your photo. Please try again.");
      onChange(data.avatar_url ?? null);
      setStatus("Photo saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save your photo. Please try again.");
      setStatus("");
    } finally {
      setBusy(null);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async () => {
    setError(null);
    setBusy("removing");
    try {
      const token = await getToken();
      if (!token) throw new Error("You're not signed in. Please reload and try again.");
      const res = await fetch("/api/profile/avatar", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Couldn't remove your photo. Please try again.");
      }
      onChange(null);
      setStatus("Photo removed.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove your photo. Please try again.");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex shrink-0 flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={() => input.current?.click()}
        disabled={busy !== null}
        aria-label={url ? "Change profile photo" : "Add a profile photo"}
        className="iki-tap iki-press relative rounded-pill"
      >
        <Avatar url={url} name={name} className="iki-identity-avatar" />
        {busy && <span className="iki-photo-busy" aria-hidden />}
      </button>
      <input
        ref={input}
        type="file"
        accept="image/*"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <span className="flex gap-2 text-micro">
        <button
          type="button"
          onClick={() => input.current?.click()}
          disabled={busy !== null}
          className="iki-btn-link iki-tap text-micro"
        >
          {busy === "saving" ? "Saving…" : url ? "Change" : "Add photo"}
        </button>
        {url && (
          <button
            type="button"
            onClick={() => void remove()}
            disabled={busy !== null}
            className="iki-btn-link iki-tap text-micro"
          >
            {busy === "removing" ? "Removing…" : "Remove"}
          </button>
        )}
      </span>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {error && (
        <p role="alert" className="max-w-40 text-center text-micro text-primary-deep">
          {error}
        </p>
      )}
    </div>
  );
}
