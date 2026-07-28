"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  BACKDROPS,
  defaultBackdrop,
  type BackdropId,
} from "@/lib/share-backdrop";
import {
  DEFAULT_FIELDS,
  DEFAULT_FORMAT,
  FORMATS,
  formatSize,
  shareCaption,
  shareFileName,
  TEMPLATES,
  type FormatId,
  type ShareCardInput,
  type ShareFields,
  type TemplateId,
} from "@/lib/share-card";
import { drawBackdrop, drawShareCard } from "./share-card-render";

/**
 * The share sheet — "the screen that makes the card", per the Claude Design
 * spec. Template → backdrop → what to show → format → share.
 *
 * Nothing is uploaded. The photo is read into a canvas and stays on the
 * device; we never see it, so there is no image service to run and no new
 * processor handling personal data.
 */

const FIELD_ROWS: { key: keyof ShareFields; label: string; note?: string }[] = [
  { key: "streak", label: "Streak" },
  { key: "training", label: "Training" },
  { key: "points", label: "Iki points" },
  { key: "energy", label: "Energy", note: "off by default" },
  { key: "sleep", label: "Sleep hours", note: "off by default" },
];

function Toggle({
  on,
  onClick,
  label,
}: {
  on: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={onClick}
      className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${
        on ? "bg-accent" : "bg-border-strong/40"
      }`}
    >
      <span
        className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-surface transition-all ${
          on ? "right-[3px]" : "left-[3px]"
        }`}
      />
    </button>
  );
}

/**
 * A live preview of the backdrop itself, drawn by the same function that draws
 * the card. A swatch of flat colour would misrepresent all three of the
 * gradient, the motif and the vignette.
 */
function BackdropSwatch({
  id,
  name,
  selected,
  onClick,
}: {
  id: BackdropId;
  name: string;
  selected: boolean;
  onClick: () => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    // Render at the card's own aspect so the thumbnail is a true miniature.
    canvas.width = 128;
    canvas.height = 160;
    drawBackdrop(ctx, id, canvas.width, canvas.height);
  }, [id]);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      title={name}
      className={`overflow-hidden rounded-control border transition-colors ${
        selected ? "border-accent" : "border-border hover:border-accent/50"
      }`}
    >
      <canvas ref={ref} aria-hidden className="block h-16 w-[3.2rem]" />
      <span className="sr-only">{name}</span>
    </button>
  );
}

/** Small pill used for template and format choices. */
function Choice({
  selected,
  onClick,
  children,
}: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={`flex-1 rounded-control border px-2 py-3 font-label text-[0.65rem] uppercase tracking-[0.16em] transition-colors ${
        selected
          ? "border-accent bg-accent text-accent-contrast"
          : "border-border bg-surface text-muted hover:border-accent/50"
      }`}
    >
      {children}
    </button>
  );
}

export function ShareCheckinCard({
  input,
  onClose,
}: {
  input: ShareCardInput;
  onClose?: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  const [template, setTemplate] = useState<TemplateId>("stone");
  const [format, setFormat] = useState<FormatId>(DEFAULT_FORMAT);
  const [fields, setFields] = useState<ShareFields>(DEFAULT_FIELDS);
  const [photo, setPhoto] = useState<HTMLImageElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  // Open on whatever the user logged today, so the picker feels like it
  // already knows. Most people will never change it.
  const suggested = useMemo(
    () => defaultBackdrop(input.trainingLogged, input.exerciseTypes),
    [input.trainingLogged, input.exerciseTypes],
  );
  const [backdrop, setBackdrop] = useState<BackdropId | null>(suggested);

  const { w, h } = formatSize(format);

  // Redraw on any change. Fonts must be ready first, or the canvas silently
  // falls back to a system serif.
  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    if (!canvas) return;

    void (async () => {
      try {
        await document.fonts.ready;
      } catch {
        /* draw with whatever is available */
      }
      if (cancelled) return;
      await drawShareCard(canvas, {
        input,
        fields,
        template,
        width: w,
        height: h,
        photo,
        backdrop,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [input, fields, template, w, h, photo, backdrop]);

  function onPickPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = ""; // let the same file be re-picked
    if (!file) return;

    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      setPhoto(img);
      setStatus(null);
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      setStatus("That image couldn't be read. Try another one.");
      URL.revokeObjectURL(url);
    };
    img.src = url;
  }

  function canvasBlob(): Promise<Blob | null> {
    const canvas = canvasRef.current;
    if (!canvas) return Promise.resolve(null);
    return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  }

  async function onShare() {
    setStatus(null);
    const blob = await canvasBlob();
    if (!blob) {
      setStatus("Couldn't create the image. Please try again.");
      return;
    }
    const file = new File([blob], shareFileName(input.date, template), {
      type: "image/png",
    });

    // The caption carries the invite link as tappable text. Platforms decide
    // whether to keep it — Instagram drops it, WhatsApp/Telegram/X/LinkedIn
    // keep it — so the card still prints the link for everywhere else.
    const text = shareCaption(input);

    if (navigator.canShare?.({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text });
        return;
      } catch (err) {
        // Dismissing the sheet throws AbortError — not worth surfacing.
        if (err instanceof Error && err.name === "AbortError") return;
        // Some targets reject a files+text share outright. Retry with the
        // image alone rather than dropping the user out to a download.
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

  async function onSave() {
    const blob = await canvasBlob();
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = shareFileName(input.date, template);
    a.click();
    URL.revokeObjectURL(url);
    setStatus("Saved to your downloads.");
  }

  return (
    <div className="flex w-full flex-col gap-6">
      <div className="flex items-center justify-between">
        <p className="font-label text-[0.65rem] uppercase tracking-[0.3em] text-accent">
          Share check-in
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
        aria-label="Your shareable check-in card"
        className="w-full rounded-card border border-border"
        style={{ aspectRatio: `${w} / ${h}` }}
      />

      {/* Template */}
      <div className="flex flex-col gap-3">
        <p className="font-label text-[0.6rem] uppercase tracking-[0.28em] text-muted">
          Template
        </p>
        <div className="flex gap-2">
          {TEMPLATES.map((t) => (
            <Choice
              key={t.id}
              selected={template === t.id}
              onClick={() => setTemplate(t.id)}
            >
              {t.name}
            </Choice>
          ))}
        </div>
      </div>

      {/* Backdrop */}
      <div className="flex flex-col gap-3">
        <p className="font-label text-[0.6rem] uppercase tracking-[0.28em] text-muted">
          Backdrop
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => {
              setPhoto(null);
              setBackdrop(null);
            }}
            aria-pressed={photo === null && backdrop === null}
            className={`h-16 w-[3.2rem] rounded-control border font-label text-[0.5rem] uppercase tracking-[0.14em] transition-colors ${
              photo === null && backdrop === null
                ? "border-accent bg-surface-2 text-foreground"
                : "border-border bg-surface text-muted"
            }`}
          >
            None
          </button>

          {BACKDROPS.map((b) => (
            <BackdropSwatch
              key={b.id}
              id={b.id}
              name={`${b.name} — ${b.note}`}
              // A photo covers the backdrop, so nothing is selected while one
              // is loaded, however the state underneath reads.
              selected={photo === null && backdrop === b.id}
              onClick={() => {
                setBackdrop(b.id);
                setPhoto(null);
              }}
            />
          ))}

          <button
            type="button"
            onClick={() => uploadRef.current?.click()}
            className="flex h-16 w-[3.2rem] flex-col items-center justify-center gap-1 rounded-control border border-dashed border-border-strong bg-surface-2 font-label text-[0.5rem] uppercase tracking-[0.14em] text-muted"
          >
            <span className="text-base leading-none">+</span>
            Upload
          </button>
          <button
            type="button"
            onClick={() => cameraRef.current?.click()}
            className="flex h-16 w-[3.2rem] flex-col items-center justify-center gap-1 rounded-control border border-dashed border-border-strong bg-surface-2 font-label text-[0.5rem] uppercase tracking-[0.14em] text-muted"
          >
            <span className="text-sm leading-none">◉</span>
            Camera
          </button>

          <input
            ref={uploadRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={onPickPhoto}
          />
          {/* `capture` opens the camera directly on a phone. */}
          <input
            ref={cameraRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={onPickPhoto}
          />
        </div>
      </div>

      {/* What to show */}
      <div className="flex flex-col gap-1">
        <p className="pb-2 font-label text-[0.6rem] uppercase tracking-[0.28em] text-muted">
          What to show
        </p>
        {FIELD_ROWS.map((row) => (
          <div
            key={row.key}
            className="flex items-center justify-between border-t border-border py-3"
          >
            <span className="font-body text-sm text-foreground">
              {row.label}
              {row.note && (
                <span className="ml-2 font-body text-xs text-muted">{row.note}</span>
              )}
            </span>
            <Toggle
              label={row.label}
              on={fields[row.key]}
              onClick={() =>
                setFields((f) => ({ ...f, [row.key]: !f[row.key] }))
              }
            />
          </div>
        ))}
      </div>

      {/* Format */}
      <div className="flex flex-col gap-3">
        <p className="font-label text-[0.6rem] uppercase tracking-[0.28em] text-muted">
          Format
        </p>
        <div className="flex gap-2">
          {FORMATS.map((f) => (
            <Choice key={f.id} selected={format === f.id} onClick={() => setFormat(f.id)}>
              {f.name}
              {/* Nobody thinks in aspect ratios — they think "this goes on my
                  story". Naming the platforms removes a guess at the exact
                  moment we are asking someone to post. */}
              <span className="mt-1 block font-body text-[0.6rem] normal-case tracking-normal opacity-70">
                {f.where}
              </span>
            </Choice>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => void onShare()}
          className="inline-flex h-12 items-center justify-center rounded-control bg-accent px-6 font-body text-sm font-medium text-accent-contrast transition-colors hover:bg-accent-hover"
        >
          Share
        </button>
        <button
          type="button"
          onClick={() => void onSave()}
          className="inline-flex h-12 items-center justify-center rounded-control border border-border-strong bg-transparent px-6 font-body text-sm font-medium text-foreground transition-colors hover:bg-surface-2"
        >
          Save to photos
        </button>
        <p className="font-body text-xs text-muted">
          {input.inviteCode
            ? `Your invite code ${input.inviteCode} travels on every card.`
            : "Every card carries a link back to Ikigaro."}{" "}
          Your photo stays on your device.
        </p>
        {status && <p className="font-body text-xs text-muted">{status}</p>}
      </div>
    </div>
  );
}
