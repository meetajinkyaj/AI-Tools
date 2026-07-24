"use client";

import { Card, Eyebrow, primaryButtonClass, secondaryButtonClass } from "./ui";

/**
 * In-app confirmation modal for destructive actions. Replaces window.confirm,
 * which browsers can silently suppress ("prevent additional dialogs") — after
 * which it returns true and the action fires with no prompt at all. This one
 * always renders, matching the app's overlay style (see the redeem flow).
 */
export interface ConfirmRequest {
  title: string;
  body: string;
  confirmLabel: string; // e.g. "Delete", "Revoke access"
  onConfirm: () => void | Promise<void>;
}

export function ConfirmDialog({
  request,
  busy,
  onCancel,
}: {
  request: ConfirmRequest;
  busy?: boolean;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4">
      <Card className="flex w-full max-w-sm flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <Eyebrow>Are you sure?</Eyebrow>
          <p className="font-display text-xl font-medium text-foreground">
            {request.title}
          </p>
          <p className="font-body text-sm text-muted">{request.body}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row-reverse">
          <button
            type="button"
            onClick={() => void request.onConfirm()}
            disabled={busy}
            className={`${primaryButtonClass} w-full sm:flex-1`}
          >
            {busy ? "Working…" : request.confirmLabel}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className={`${secondaryButtonClass} w-full sm:flex-1`}
          >
            Cancel
          </button>
        </div>
      </Card>
    </div>
  );
}
