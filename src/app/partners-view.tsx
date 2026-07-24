"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import {
  Card,
  Eyebrow,
  PageHeader,
  primaryButtonClass,
  secondaryButtonClass,
} from "./ui";

/**
 * Partners / Rewards — the redemption loop. Users spend iki points on brand
 * VOUCHERS (a code is issued instantly from a pre-loaded pool) or open direct
 * AFFILIATE product links (free, commission-monetized). Voucher codes are always
 * retrievable in Redemption history, and a "How to redeem" explainer covers the
 * generic flow.
 */

interface CatalogItem {
  id: string;
  name: string;
  partner: string | null;
  description: string | null;
  category: string | null;
  points_cost: number;
  discount_value: string | null;
  inventory_status: string; // in_stock | coming_soon
  kind: string; // voucher | affiliate
  affiliate_url: string | null;
  image_url: string | null;
  redeem_instructions: string | null;
  terms: string | null;
  available_codes: number | null;
}

interface HistoryRow {
  id: string;
  points_spent: number;
  status: string;
  discount_code: string | null;
  redeemed_at: string | null;
  created_at: string;
  /** Snapshot taken at redemption — survives the catalog item being deleted. */
  item_name: string | null;
  item:
    | { name: string; partner: string | null; redeem_instructions: string | null }
    | { name: string; partner: string | null; redeem_instructions: string | null }[]
    | null;
}

interface RewardsData {
  balance: number;
  items: CatalogItem[];
  history: HistoryRow[];
}

interface Issued {
  name: string;
  code: string;
  redeem_instructions: string | null;
}

function itemOf(row: HistoryRow) {
  return Array.isArray(row.item) ? (row.item[0] ?? null) : row.item;
}

/** A voucher code the user can tap to copy, with brief "Copied" feedback. */
function CopyableCode({ code, className = "" }: { code: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable; the code is visible regardless */
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy code ${code}`}
      className={`inline-flex items-center gap-2 rounded-control bg-surface-2 px-2.5 py-1 transition-colors hover:bg-border ${className}`}
    >
      <code className="font-mono text-xs text-foreground">{code}</code>
      <span className="font-body text-[10px] uppercase tracking-wide text-accent">
        {copied ? "Copied" : "Copy"}
      </span>
    </button>
  );
}

export function PartnersView({
  getToken,
}: {
  getToken: () => Promise<string | null>;
}) {
  const [data, setData] = useState<RewardsData | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [confirming, setConfirming] = useState<CatalogItem | null>(null);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFaq, setShowFaq] = useState(false);
  // Users can tuck their redemption history away; remembered per device.
  const [showHistory, setShowHistory] = useState(
    () =>
      typeof window === "undefined" ||
      localStorage.getItem("ikigaro.rewards.hideHistory") !== "1",
  );
  const startedRef = useRef(false);

  const toggleHistory = () => {
    setShowHistory((v) => {
      const next = !v;
      localStorage.setItem("ikigaro.rewards.hideHistory", next ? "0" : "1");
      return next;
    });
  };

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const token = await getToken();
      if (!token) return setStatus("error");
      const res = await fetch("/api/redemptions", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return setStatus("error");
      setData((await res.json()) as RewardsData);
      setStatus("ready");
    } catch (err) {
      console.error("Failed to load rewards:", err);
      setStatus("error");
    }
  }, [getToken]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void load();
  }, [load]);

  async function redeem(item: CatalogItem) {
    setBusy(true);
    setError(null);
    try {
      const token = await getToken();
      if (!token) {
        setError("You're not signed in. Please reload and try again.");
        return;
      }
      const res = await fetch("/api/redemptions", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ item_id: item.id }),
      });
      const result = (await res.json()) as {
        code?: string;
        redeem_instructions?: string | null;
        balance?: number;
        error?: string;
      };
      if (!res.ok || !result.code) {
        setError(result.error ?? "Couldn't redeem right now. Please try again.");
        return;
      }
      setConfirming(null);
      setIssued({
        name: item.name,
        code: result.code,
        redeem_instructions: result.redeem_instructions ?? item.redeem_instructions,
      });
      await load(); // refresh balance + history + stock
    } catch (err) {
      console.error("Redeem failed:", err);
      setError("Couldn't redeem right now. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function openAffiliate(item: CatalogItem) {
    if (!item.affiliate_url) return;
    window.open(item.affiliate_url, "_blank", "noopener,noreferrer");
    try {
      const token = await getToken();
      if (token) {
        void fetch("/api/redemptions/click", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ item_id: item.id }),
        });
      }
    } catch {
      /* click tracking is best-effort */
    }
  }

  if (status === "loading") {
    return <p className="font-body text-sm text-muted">Loading rewards…</p>;
  }
  if (status === "error") {
    return (
      <div className="flex flex-col gap-4">
        <p className="font-body text-sm text-muted">Couldn&rsquo;t load rewards.</p>
        <button onClick={() => void load()} className={primaryButtonClass}>
          Try again
        </button>
      </div>
    );
  }

  const balance = data?.balance ?? 0;
  const items = data?.items ?? [];
  const vouchers = items.filter((i) => i.kind === "voucher");
  const affiliates = items.filter((i) => i.kind === "affiliate");
  const history = data?.history ?? [];

  return (
    <div className="flex w-full max-w-2xl flex-col gap-8">
      <PageHeader
        eyebrow="Rewards"
        title="Spend your iki points"
        subtitle="Redeem points for partner vouchers, or shop products we'd use ourselves."
      />

      <Card className="flex items-center justify-between gap-4 p-6">
        <div className="flex flex-col gap-1">
          <Eyebrow>Your iki points</Eyebrow>
          <p className="font-display text-3xl font-medium text-foreground">{balance}</p>
        </div>
        <button
          type="button"
          onClick={() => setShowFaq((v) => !v)}
          className="font-body text-xs text-muted underline underline-offset-4 hover:text-foreground"
        >
          How to redeem
        </button>
      </Card>

      {showFaq && <HowToRedeem />}

      <InviteCard getToken={getToken} />

      {items.length === 0 && (
        <Card className="p-6">
          <p className="font-body text-sm text-muted">
            Partners are being onboarded. Keep earning — redemptions open here soon.
          </p>
        </Card>
      )}

      {vouchers.length > 0 && (
        <section className="flex flex-col gap-4">
          <Eyebrow>Vouchers</Eyebrow>
          <div className="grid gap-4 sm:grid-cols-2">
            {vouchers.map((item) => (
              <VoucherCard
                key={item.id}
                item={item}
                balance={balance}
                onRedeem={() => {
                  setError(null);
                  setConfirming(item);
                }}
              />
            ))}
          </div>
        </section>
      )}

      {affiliates.length > 0 && (
        <section className="flex flex-col gap-4">
          <Eyebrow>Shop our picks</Eyebrow>
          <p className="font-body text-xs text-muted">
            Affiliate links — we may earn a commission, at no extra cost to you.
            Not medical advice.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            {affiliates.map((item) => (
              <AffiliateCard key={item.id} item={item} onOpen={() => openAffiliate(item)} />
            ))}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <Eyebrow>Redemption history{showHistory ? "" : ` · ${history.length}`}</Eyebrow>
            <button
              type="button"
              onClick={toggleHistory}
              className="font-body text-xs text-muted underline underline-offset-4 hover:text-foreground"
            >
              {showHistory ? "Hide" : "Show"}
            </button>
          </div>
          {showHistory && (
            <Card className="flex flex-col divide-y divide-border">
              {history.map((row) => {
                const it = itemOf(row);
                return (
                  <div key={row.id} className="flex items-center justify-between gap-3 px-5 py-3">
                    <div className="flex min-w-0 flex-col">
                      <span className="truncate font-body text-sm text-foreground">
                        {row.item_name ?? it?.name ?? "Reward"}
                      </span>
                      <span className="font-body text-xs text-muted">
                        {new Date(row.redeemed_at ?? row.created_at).toLocaleDateString()} ·{" "}
                        {row.points_spent} points
                      </span>
                    </div>
                    {row.discount_code && (
                      <CopyableCode code={row.discount_code} className="shrink-0" />
                    )}
                  </div>
                );
              })}
            </Card>
          )}
        </section>
      )}

      <p className="font-body text-xs text-muted">
        iki points have no cash value. See the{" "}
        <a href="/terms#rewards" className="text-accent underline">
          rewards terms
        </a>
        .
      </p>

      {confirming && (
        <ConfirmRedeem
          item={confirming}
          balance={balance}
          busy={busy}
          error={error}
          onCancel={() => {
            setConfirming(null);
            setError(null);
          }}
          onConfirm={() => void redeem(confirming)}
        />
      )}

      {issued && <VoucherIssued issued={issued} onClose={() => setIssued(null)} />}
    </div>
  );
}

interface ReferralInfo {
  code: string;
  link: string;
  joined: number;
  completed: number;
  tiers: { onboard: number; streak: number; panel: number; panelWindowDays: number };
  maxTotal: number;
}

/** Invite friends — share your referral link, earn when they finish onboarding. */
function InviteCard({ getToken }: { getToken: () => Promise<string | null> }) {
  const [info, setInfo] = useState<ReferralInfo | null>(null);
  const [copied, setCopied] = useState(false); // Share button's fallback feedback
  const [linkCopied, setLinkCopied] = useState(false); // Copy button's feedback
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        const token = await getToken();
        if (!token) return;
        const res = await fetch("/api/referral", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) setInfo((await res.json()) as ReferralInfo);
      } catch {
        /* the card just doesn't render */
      }
    })();
  }, [getToken]);

  if (!info) return null;

  const share = async () => {
    const text = `Join me on Ikigaro — upload your blood work and it shows you what actually matters. ${info.link}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Ikigaro", text, url: info.link });
        return;
      }
    } catch {
      /* user cancelled the sheet — fall through to copy */
    }
    try {
      await navigator.clipboard.writeText(info.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the link is visible below regardless */
    }
  };

  // Always-available copy — on desktop the share sheet is awkward or absent.
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(info.link);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the link is visible beside the buttons */
    }
  };

  return (
    <Card className="flex flex-col gap-3 p-6">
      <div className="flex items-baseline justify-between gap-3">
        <Eyebrow>Invite friends</Eyebrow>
        {info.completed > 0 && (
          <span className="font-body text-xs text-muted">
            {info.completed} joined &amp; onboarded
          </span>
        )}
      </div>
      <p className="font-body text-sm text-foreground/80">
        Share your link — earn up to{" "}
        <span className="font-medium text-foreground">
          +{info.maxTotal} iki points
        </span>{" "}
        per friend:
      </p>
      <ul className="flex flex-col gap-1 font-body text-xs text-muted">
        <li>
          <span className="font-medium text-foreground">+{info.tiers.onboard}</span>{" "}
          when they join and complete onboarding
        </li>
        <li>
          <span className="font-medium text-foreground">+{info.tiers.streak}</span>{" "}
          when they build a daily habit (their first 7-day check-in streak)
        </li>
        <li>
          <span className="font-medium text-foreground">+{info.tiers.panel}</span>{" "}
          when they upload their first blood report within{" "}
          {info.tiers.panelWindowDays} days of joining
        </li>
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          type="button"
          onClick={() => void share()}
          className={`${primaryButtonClass} shrink-0`}
        >
          {copied ? "Link copied" : "Share your link"}
        </button>
        <button
          type="button"
          onClick={() => void copyLink()}
          className={`${secondaryButtonClass} shrink-0`}
        >
          {linkCopied ? "Copied" : "Copy link"}
        </button>
        <code className="min-w-0 truncate rounded-control bg-surface-2 px-3 py-2 font-mono text-xs text-muted">
          {info.link}
        </code>
      </div>
    </Card>
  );
}

/** The "how to redeem" explainer (generic, applies to every voucher). */
function HowToRedeem() {
  const steps = [
    "Redeem points for a voucher — the code appears instantly.",
    "Copy the code. It's also saved in your Redemption history, so you can come back to it anytime.",
    "Follow the partner's redemption steps shown with the code (usually: paste it at checkout on the partner's site or app).",
    "Vouchers are single-use and may have an expiry or minimum spend — check the terms on the voucher.",
  ];
  return (
    <Card className="flex flex-col gap-3 p-6">
      <Eyebrow>How to redeem</Eyebrow>
      <ol className="flex flex-col gap-2">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3 font-body text-sm text-foreground/80">
            <span className="font-body text-sm font-medium text-accent">{i + 1}.</span>
            {s}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function VoucherCard({
  item,
  balance,
  onRedeem,
}: {
  item: CatalogItem;
  balance: number;
  onRedeem: () => void;
}) {
  const comingSoon = item.inventory_status === "coming_soon";
  const soldOut = !comingSoon && (item.available_codes ?? 0) <= 0;
  const tooPoor = !comingSoon && !soldOut && balance < item.points_cost;
  const label = comingSoon
    ? "Coming soon"
    : soldOut
      ? "Sold out"
      : `Redeem · ${item.points_cost}`;

  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-1">
        {item.partner && <Eyebrow>{item.partner}</Eyebrow>}
        <p className="font-body text-sm font-medium text-foreground">{item.name}</p>
        {item.discount_value && (
          <p className="font-body text-xs text-muted">{item.discount_value}</p>
        )}
        {item.description && (
          <p className="font-body text-xs text-muted">{item.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onRedeem}
        disabled={comingSoon || soldOut || tooPoor}
        className={`${primaryButtonClass} mt-auto`}
      >
        {label}
      </button>
      {tooPoor && (
        <p className="font-body text-xs text-muted">
          {item.points_cost - balance} more points to unlock.
        </p>
      )}
    </Card>
  );
}

function AffiliateCard({ item, onOpen }: { item: CatalogItem; onOpen: () => void }) {
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex flex-col gap-1">
        {item.partner && <Eyebrow>{item.partner}</Eyebrow>}
        <p className="font-body text-sm font-medium text-foreground">{item.name}</p>
        {item.description && (
          <p className="font-body text-xs text-muted">{item.description}</p>
        )}
      </div>
      <button type="button" onClick={onOpen} className={`${secondaryButtonClass} mt-auto`}>
        Shop&nbsp;&rarr;
      </button>
    </Card>
  );
}

/** A lightweight full-screen overlay (no modal lib) shared by confirm + issued. */
function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

function ConfirmRedeem({
  item,
  balance,
  busy,
  error,
  onCancel,
  onConfirm,
}: {
  item: CatalogItem;
  balance: number;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Overlay>
      <Card className="flex flex-col gap-4 p-6">
        <div className="flex flex-col gap-1">
          <Eyebrow>Redeem</Eyebrow>
          <p className="font-display text-xl font-medium text-foreground">{item.name}</p>
          <p className="font-body text-sm text-muted">
            {item.points_cost} points · you have {balance}
          </p>
        </div>
        {item.terms && <p className="font-body text-xs text-muted">{item.terms}</p>}
        {error && <p className="font-body text-sm text-accent-hover">{error}</p>}
        <div className="flex flex-col gap-3 sm:flex-row-reverse">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`${primaryButtonClass} w-full sm:flex-1`}
          >
            {busy ? "Redeeming…" : "Confirm"}
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
    </Overlay>
  );
}

function VoucherIssued({ issued, onClose }: { issued: Issued; onClose: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(issued.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable; the code is visible regardless */
    }
  };
  return (
    <Overlay>
      <Card className="flex flex-col gap-4 border-accent/20 bg-accent/5 p-6">
        <div className="flex flex-col gap-1">
          <Eyebrow>Voucher unlocked</Eyebrow>
          <p className="font-display text-xl font-medium text-foreground">{issued.name}</p>
        </div>
        <button
          type="button"
          onClick={copy}
          className="flex items-center justify-between gap-3 rounded-control border border-border-strong bg-surface px-4 py-3 text-left"
        >
          <code className="font-mono text-base text-foreground">{issued.code}</code>
          <span className="shrink-0 font-body text-xs text-accent">
            {copied ? "Copied" : "Copy"}
          </span>
        </button>
        <p className="font-body text-xs text-muted">
          {issued.redeem_instructions ??
            "Use this code at the partner's checkout. It's saved in your Redemption history too."}
        </p>
        <button type="button" onClick={onClose} className={primaryButtonClass}>
          Done
        </button>
      </Card>
    </Overlay>
  );
}
