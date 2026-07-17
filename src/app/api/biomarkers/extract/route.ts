import { extractText, getDocumentProxy } from "unpdf";

import { NextResponse } from "next/server";

import {
  AnthropicNotConfiguredError,
  AnthropicOverloadedError,
  type ExtractionSource,
  extractMarkers,
} from "@/lib/anthropic";
import { getPrivyUserId } from "@/lib/api-auth";
import {
  loadReportCatalog,
  resolveReportUser,
} from "@/lib/biomarker-report-data";
import {
  buildExtractionPrompt,
  hasUsableTextLayer,
  parseExtractionResponse,
} from "@/lib/extraction";

/**
 * Read a lab-report PDF and return a *draft* of the biomarker values found in
 * it, mapped to our catalog. Nothing is saved — the client shows the draft for
 * the user to review/edit, then persists it via POST /api/biomarkers. Flags are
 * intentionally NOT computed here; the save route recomputes them
 * deterministically after the human confirms.
 *
 *   POST /api/biomarkers/extract  (multipart/form-data, field "file")
 *     -> streamed body: newline heartbeats while the model reads, then a final
 *        JSON line — { test_date, lab_name, readings, unmatched } or { error }.
 *
 * The response is streamed because the model read takes ~20-30s: holding the
 * HTTP connection open with no bytes for that long trips an idle-connection
 * timeout between Cloudflare and the browser (fetch rejects with "Failed to
 * fetch"). Emitting a newline every few seconds keeps the connection alive; the
 * client reads the whole body and parses the last non-empty line as JSON.
 */

export const maxDuration = 90;
const HEARTBEAT_MS = 5000;

const MAX_PDF_BYTES = 15 * 1024 * 1024; // 15 MB
const MAX_TEXT_CHARS = 400_000; // bound the token count sent to the model

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Prefer the PDF's text layer — a digital lab report extracts in well under a
 * second and reads in seconds, versus a slow, timeout-prone vision pass over
 * every page. Fall back to sending the PDF for vision reading only when there's
 * no usable text layer (e.g. a scanned report).
 */
async function buildSource(bytes: Uint8Array): Promise<ExtractionSource> {
  try {
    const pdf = await getDocumentProxy(bytes);
    const { text } = await extractText(pdf, { mergePages: true });
    if (hasUsableTextLayer(text)) {
      return { kind: "text", text: text.slice(0, MAX_TEXT_CHARS) };
    }
  } catch (err) {
    console.error("PDF text extraction failed; falling back to vision:", err);
  }
  return { kind: "pdf", base64: toBase64(bytes) };
}

export async function POST(request: Request) {
  const privyUserId = await getPrivyUserId(request);
  if (!privyUserId) {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: "Expected a file upload" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No PDF uploaded" }, { status: 400 });
  }
  if (file.type && file.type !== "application/pdf") {
    return NextResponse.json({ error: "Please upload a PDF file" }, { status: 400 });
  }
  if (file.size === 0) {
    return NextResponse.json({ error: "That file is empty" }, { status: 400 });
  }
  if (file.size > MAX_PDF_BYTES) {
    return NextResponse.json(
      { error: "That PDF is too large (max 15 MB)" },
      { status: 413 },
    );
  }

  // Read the file bytes up front (cheap) so the streamed body owns only the
  // slow model call.
  const bytes = new Uint8Array(await file.arrayBuffer());

  // The extraction itself is slow; stream newline heartbeats to keep the
  // connection alive, then emit the JSON payload as the final line. Because the
  // 200 status commits when headers flush, errors past this point travel in the
  // body ({ error }), not the status code.
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(encoder.encode("\n")); // flush headers immediately

      const work = runExtraction(privyUserId, bytes);
      let settled = false;
      void work.finally(() => {
        settled = true;
      });

      while (!settled) {
        await Promise.race([work.catch(() => undefined), sleep(HEARTBEAT_MS)]);
        if (!settled) controller.enqueue(encoder.encode("\n"));
      }

      const payload = await work.catch((err) => ({ error: mapError(err) }));
      controller.enqueue(encoder.encode("\n" + JSON.stringify(payload)));
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "cache-control": "no-store",
      "x-accel-buffering": "no",
    },
  });
}

type ExtractionOutcome = Awaited<ReturnType<typeof parseExtractionResponse>> | { error: string };

/** Resolve the user, read the PDF, call the model — the slow work behind the stream. */
async function runExtraction(
  privyUserId: string,
  bytes: Uint8Array,
): Promise<ExtractionOutcome> {
  const resolved = await resolveReportUser(privyUserId);
  if (!resolved) return { error: "We couldn't find your account. Please reload and try again." };

  const catalog = await loadReportCatalog(resolved.sex);
  const source = await buildSource(bytes);
  const prompt = buildExtractionPrompt(catalog);

  const raw = await extractMarkers({ prompt, source });
  const result = parseExtractionResponse(raw, catalog);

  if (result.readings.length === 0) {
    return {
      error:
        "We couldn't read any recognized markers from that PDF. Try a clearer copy of the lab report.",
    };
  }
  return result;
}

/** Map an extraction error to a user-facing message (logged server-side). */
function mapError(err: unknown): string {
  if (err instanceof AnthropicNotConfiguredError) {
    console.error("Extraction unavailable:", err);
    return "PDF reading isn't available right now. Please try again later.";
  }
  if (err instanceof AnthropicOverloadedError) {
    console.error("Extraction temporarily unavailable:", err);
    return "The reader is busy right now. Please try again in a moment.";
  }
  console.error("POST /api/biomarkers/extract failed:", err);
  return "We couldn't read that PDF. Please try again.";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
