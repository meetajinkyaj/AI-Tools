"use client";

import { useCallback, useEffect, useRef, useState } from "react";



/**
 * Partners / Rewards, the redemption loop. Users spend iki points on brand
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
  /** Snapshot taken at redemption, survives the catalog item being deleted. */
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
      className={`iki-code ${className}`}
    >
      <code className="iki-code-value">{code}</code>
      <span className="iki-code-action">{copied ? "Copied" : "Copy"}</span>
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
    return <p className="text-body-sm text-muted">Loading rewards…</p>;
  }
  if (status === "error") {
    return (
      <div className="flex w-full max-w-xl flex-col gap-4">
        <p className="text-body-sm text-muted">Couldn&rsquo;t load rewards.</p>
        <button
          type="button"
          onClick={() => void load()}
          className="iki-btn iki-btn-primary w-full"
        >
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
    <div className="flex w-full max-w-xl flex-col gap-stack">
      <header className="flex flex-col gap-1.5">
        <p className="iki-eyebrow">Rewards</p>
        <h1 className="iki-title">Spend your iki points</h1>
        <p className="iki-lede">
          Redeem points for partner vouchers, or shop products we&rsquo;d use ourselves.
        </p>
      </header>

      <section className="iki-card iki-card-tight flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="iki-eyebrow">Your iki points</p>
          {/* The one hero numeral on this screen, so it takes the largest step
              in the scale below the page title. */}
          <p className="font-display text-display-lg font-medium leading-none text-ink">
            {balance}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowFaq((v) => !v)}
          aria-expanded={showFaq}
          className="iki-btn-link iki-tap shrink-0"
        >
          How to redeem
        </button>
      </section>

      {showFaq && <HowToRedeem />}

      <InviteCard getToken={getToken} />

      {items.length === 0 && (
        <section className="iki-card">
          <p className="text-body-sm text-muted">
            Partners are being onboarded. Keep earning, redemptions open here soon.
          </p>
        </section>
      )}

      {vouchers.length > 0 && (
        <section className="flex flex-col gap-2">
          <p className="iki-eyebrow">Vouchers</p>
          <div className="grid gap-2 sm:grid-cols-2">
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
        <section className="flex flex-col gap-2">
          <p className="iki-eyebrow">Shop our picks</p>
          {/* NOT IN THE MOCKUP AND NOT OPTIONAL. Affiliate disclosure has to sit
              with the links it describes, not in the terms page. */}
          <p className="pb-1 text-micro text-muted">
            Affiliate links, we may earn a commission, at no extra cost to you.
            Not medical advice.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            {affiliates.map((item) => (
              <AffiliateCard key={item.id} item={item} onOpen={() => openAffiliate(item)} />
            ))}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <section className="flex flex-col gap-2">
          <div className="flex items-center justify-between gap-3">
            <p className="iki-eyebrow">
              Redemption history{showHistory ? "" : ` · ${history.length}`}
            </p>
            {/* Tucking history away is remembered per device. Kept: a member
                who has redeemed a lot should not have to scroll past all of it
                to reach the terms. */}
            <button
              type="button"
              onClick={toggleHistory}
              aria-expanded={showHistory}
              className="iki-btn-link iki-tap shrink-0"
            >
              {showHistory ? "Hide" : "Show"}
            </button>
          </div>
          {showHistory && (
            <div className="flex flex-col gap-2">
              {history.map((row) => {
                const it = itemOf(row);
                return (
                  <div
                    key={row.id}
                    className="iki-card iki-card-tight flex items-center justify-between gap-2.5"
                  >
                    <div className="flex min-w-0 flex-col">
                      {/* The snapshot first, the join second. A deleted catalog
                          item must not erase a code somebody paid points for. */}
                      <span className="truncate text-caption font-semibold text-ink">
                        {row.item_name ?? it?.name ?? "Reward"}
                      </span>
                      <span className="text-micro text-muted">
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
            </div>
          )}
        </section>
      )}

      <p className="text-micro text-muted">
        iki points have no cash value. See the{" "}
        <a href="/terms#rewards" className="text-primary underline underline-offset-2">
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

/** Invite friends, share your referral link, earn when they finish onboarding. */
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
    const text = `Join me on Ikigaro, upload your blood work and it shows you what actually matters. ${info.link}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Ikigaro", text, url: info.link });
        return;
      }
    } catch {
      /* user cancelled the sheet, fall through to copy */
    }
    try {
      await navigator.clipboard.writeText(info.link);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* the link is visible below regardless */
    }
  };

  // Always-available copy, on desktop the share sheet is awkward or absent.
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(info.link);
      setLinkCopied(true);
      setTimeout(() => setLinkCopied(false), 1500);
    } catch {
      /* clipboard unavailable, the link is visible beside the buttons */
    }
  };

  return (
    <section className="iki-card flex flex-col gap-2.5">
      <div className="flex items-baseline justify-between gap-3">
        <p className="iki-eyebrow">Invite friends</p>
        {info.completed > 0 && (
          <span className="text-micro text-muted">
            {info.completed} joined &amp; onboarded
          </span>
        )}
      </div>
      <p className="text-caption leading-relaxed text-ink">
        Share your link, earn up to{" "}
        <span className="font-bold">+{info.maxTotal} iki points</span> per friend:
      </p>
      {/* Amounts in ink and bold, the condition in muted. The number is what
          somebody scans for; the sentence is what they read once. */}
      <ul className="flex flex-col gap-1 text-small text-muted">
        <li>
          <span className="font-bold text-ink">+{info.tiers.onboard}</span> when they
          join and complete onboarding
        </li>
        <li>
          <span className="font-bold text-ink">+{info.tiers.streak}</span> when they
          build a daily habit (their first 7-day check-in streak)
        </li>
        <li>
          <span className="font-bold text-ink">+{info.tiers.panel}</span> when they
          upload their first blood report within {info.tiers.panelWindowDays} days
          of joining
        </li>
      </ul>
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <button
          type="button"
          onClick={() => void share()}
          className="iki-btn iki-btn-primary shrink-0"
        >
          {copied ? "Link copied" : "Share your link"}
        </button>
        {/* KEPT, THOUGH THE MOCKUP HAS ONLY THE SHARE BUTTON. The share sheet is
            awkward or absent on desktop, and the visible link is the fallback
            when the clipboard is blocked. */}
        <button
          type="button"
          onClick={() => void copyLink()}
          className="iki-btn iki-btn-secondary shrink-0"
        >
          {linkCopied ? "Copied" : "Copy link"}
        </button>
        <code className="min-w-0 truncate rounded-ctl bg-surface-2 px-3 py-2 font-mono text-micro text-muted">
          {info.link}
        </code>
      </div>
    </section>
  );
}

/** The "how to redeem" explainer (generic, applies to every voucher). */
function HowToRedeem() {
  const steps = [
    "Redeem points for a voucher. The code appears instantly.",
    "Copy the code. It's also saved in your Redemption history, so you can come back to it anytime.",
    "Follow the partner's redemption steps shown with the code (usually: paste it at checkout on the partner's site or app).",
    "Vouchers are single-use and may have an expiry or minimum spend, check the terms on the voucher.",
  ];
  return (
    <section className="iki-card flex flex-col gap-2.5">
      <p className="iki-eyebrow">How to redeem</p>
      <ol className="flex flex-col gap-2">
        {steps.map((s, i) => (
          <li key={i} className="flex gap-3 text-body-sm text-ink">
            <span className="font-semibold text-primary">{i + 1}.</span>
            {s}
          </li>
        ))}
      </ol>
    </section>
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
    <section className="iki-card iki-card-tight flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        {/* Muted, not terracotta: a brand name should not out-shout the offer
            it introduces. */}
        {item.partner && <p className="iki-eyebrow-sm">{item.partner}</p>}
        <p className="text-body font-semibold text-ink">{item.name}</p>
        {item.discount_value && (
          <p className="text-small text-muted">{item.discount_value}</p>
        )}
        {item.description && (
          <p className="text-small text-muted">{item.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onRedeem}
        disabled={comingSoon || soldOut || tooPoor}
        className="iki-btn iki-btn-primary mt-auto w-full"
      >
        {label}
      </button>
      {/* The gap is stated rather than the button just going dead. "Redeem"
          greyed out with no reason reads as broken. */}
      {tooPoor && (
        <p className="text-micro text-muted">
          {item.points_cost - balance} more points to unlock.
        </p>
      )}
    </section>
  );
}

function AffiliateCard({ item, onOpen }: { item: CatalogItem; onOpen: () => void }) {
  return (
    <section className="iki-card iki-card-tight flex flex-col gap-2.5">
      <div className="flex flex-col gap-0.5">
        {item.partner && <p className="iki-eyebrow-sm">{item.partner}</p>}
        <p className="text-body font-semibold text-ink">{item.name}</p>
        {item.description && (
          <p className="text-small text-muted">{item.description}</p>
        )}
      </div>
      <button
        type="button"
        onClick={onOpen}
        className="iki-btn iki-btn-secondary mt-auto w-full"
      >
        Shop&nbsp;&rarr;
      </button>
    </section>
  );
}

/** A lightweight full-screen overlay (no modal lib) shared by confirm + issued. */
function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4">
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
      <div className="iki-card flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="iki-eyebrow">Redeem</p>
          <p className="font-display text-display-sm font-medium text-ink">{item.name}</p>
          <p className="text-body-sm text-muted">
            {item.points_cost} points · you have {balance}
          </p>
        </div>
        {item.terms && <p className="text-micro text-muted">{item.terms}</p>}
        {error && <p role="alert" className="text-body-sm text-primary-deep">{error}</p>}
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="iki-btn iki-btn-primary w-full"
          >
            {busy ? "Redeeming…" : "Confirm"}
          </button>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="iki-btn iki-btn-secondary w-full"
          >
            Cancel
          </button>
        </div>
      </div>
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
      <div className="iki-card iki-card-accent flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <p className="iki-eyebrow">Voucher unlocked</p>
          <p className="font-display text-display-sm font-medium text-ink">{issued.name}</p>
        </div>
        {/* Bigger than the history chip on purpose: this is the moment the code
            exists, and it is the only thing on screen worth reading. */}
        <button
          type="button"
          onClick={copy}
          aria-label={`Copy code ${issued.code}`}
          className="iki-press flex min-h-ctl items-center justify-between gap-3 rounded-ctl border border-line-strong bg-surface px-4 text-left"
        >
          <code className="font-mono text-body-lg text-ink">{issued.code}</code>
          <span className="iki-code-action shrink-0">{copied ? "Copied" : "Copy"}</span>
        </button>
        <p className="text-micro text-muted">
          {issued.redeem_instructions ??
            "Use this code at the partner's checkout. It's saved in your Redemption history too."}
        </p>
        <button
          type="button"
          onClick={onClose}
          className="iki-btn iki-btn-primary w-full"
        >
          Done
        </button>
      </div>
    </Overlay>
  );
}
