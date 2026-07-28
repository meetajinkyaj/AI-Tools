"use client";

import { useEffect, useRef, useState } from "react";

import {
  DEFAULT_RANK_FORMAT,
  RANK_FORMATS,
  rankCaption,
  rankFormatSize,
  type RankCardInput,
  type RankFormatId,
} from "@/lib/rank-share-card";
import { drawRankCard } from "./rank-card-render";

/**
 * The rank share sheet.
 *
 * One card, one control. The check-in sheet earns its templates, backdrops and
 * field toggles because a check-in publishes several separable facts and some
 * of them — how you slept, how your energy was — are nobody's business unless
 * you say so. A rank is a single public fact, so there is nothing to consent
 * to and nothing to style around. The only thing left that genuinely varies is
 * where the image is going, which is why the format picker survives and every
 * other control does not.
 */
export function RankShareCard({
  input,
  onClose,
}: {
  input: RankCardInput;
  onClose?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [format, setFormat] = useState<RankFormatId>(DEFAULT_RANK_FORMAT);
  const [status, setStatus] = useState<string | null>(null);
  const { w, h } = rankFormatSize(format);

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;
    void (async () => {
      // The draw is async (it waits on the font), so a fast format switch can
      // land two paints on one canvas out of order. The flag drops the stale
      // one instead of letting it overwrite the newer.
      await drawRankCard(canvas, { input, width: w, height: h });
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [input, w, h]);

  function fileName(): string {
    const d = input.date;
    const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
    return `ikigaro-${input.rankId}-${stamp}.png`;
  }

  function canvasBlob(): Promise<Blob | null> {
    const canvas = canvasRef.current;
    if (!canvas) return Promise.resolve(null);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  async function onSave() {
    const blob = await canvasBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName();
    a.click();
    URL.revokeObjectURL(url);
    setStatus("Saved to your downloads.");
  }

  async function onShare() {
    setStatus(null);
    const blob = await canvasBlob();
    if (!blob) {
      setStatus("Couldn't create the image. Please try again.");
      return;
    }
    const file = new File([blob], fileName(), { type: "image/png" });
    const text = rankCaption(input);

    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text });
        return;
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        // Some targets reject files+text outright. Retry with the image alone
        // rather than dropping the user out to a download.
        try {
          await navigator.share({ files: [file] });
          return;
        } catch (retryErr) {
          if (retryErr instanceof Error && retryErr.name === "AbortError") return;
        }
      }
    }
    await onSave();
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="font-label text-[0.65rem] uppercase tracking-[0.3em] text-accent">
          Share your rank
        </p>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close share"
            className="px-2 font-body text-lg leading-none text-muted"
          >
            ✕
          </button>
        )}
      </div>

      <canvas
        ref={canvasRef}
        aria-label={`Your shareable ${input.rankName} card`}
        className="w-full rounded-card border border-border"
        style={{ aspectRatio: `${w} / ${h}` }}
      />

      <div className="flex flex-col gap-3">
        <p className="font-label text-[0.6rem] uppercase tracking-[0.28em] text-muted">
          Format
        </p>
        <div className="grid grid-cols-3 gap-2">
          {RANK_FORMATS.map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setFormat(f.id)}
              aria-pressed={format === f.id}
              className={`flex flex-col gap-1 rounded-card border px-3 py-2 text-left transition-colors ${
                format === f.id
                  ? "border-accent bg-accent/5"
                  : "border-border hover:border-muted"
              }`}
            >
              <span className="font-body text-xs text-foreground">{f.name}</span>
              {/* Nobody thinks in ratios; they think "this is for my story". */}
              <span className="font-body text-[0.6rem] leading-tight text-muted">
                {f.where}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void onShare()}
            className="flex-1 rounded-pill bg-accent px-4 py-3 font-label text-[0.65rem] uppercase tracking-[0.2em] text-white"
          >
            Share
          </button>
          <button
            type="button"
            onClick={() => void onSave()}
            className="rounded-pill border border-border px-4 py-3 font-label text-[0.65rem] uppercase tracking-[0.2em] text-foreground"
          >
            Save
          </button>
        </div>
        {status && (
          <p role="status" className="font-body text-xs text-muted">
            {status}
          </p>
        )}
      </div>
    </div>
  );
}
