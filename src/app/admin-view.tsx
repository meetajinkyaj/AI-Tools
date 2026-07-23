"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  Card,
  CenteredMessage,
  Eyebrow,
  fieldClass,
  labelClass,
  PageHeader,
  primaryButtonClass,
  secondaryButtonClass,
} from "./ui";

type Authz = "checking" | "ok" | "denied";
type Tab = "vouchers" | "users";

/**
 * Internal admin console (gated by the ADMIN_EMAILS allow-list server-side, and
 * ideally by Cloudflare Access at the network layer). Manage the redemption
 * catalog (add/delete items, set inventory, bulk-load voucher codes) and view
 * the user roster.
 */
export function AdminView() {
  const { ready, authenticated, getAccessToken, login } = usePrivy();
  const [authz, setAuthz] = useState<Authz>("checking");
  const [email, setEmail] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("vouchers");
  const checkedRef = useRef(false);

  useEffect(() => {
    if (!ready || !authenticated || checkedRef.current) return;
    checkedRef.current = true;
    (async () => {
      try {
        const token = await getAccessToken();
        const res = await fetch("/api/admin/me", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          setEmail(((await res.json()) as { email: string }).email);
          setAuthz("ok");
        } else {
          setAuthz("denied");
        }
      } catch {
        setAuthz("denied");
      }
    })();
  }, [ready, authenticated, getAccessToken]);

  if (!ready) return <CenteredMessage>Loading…</CenteredMessage>;
  if (!authenticated) {
    return (
      <div className="mx-auto flex min-h-[60vh] max-w-sm flex-col items-center justify-center gap-4 p-6 text-center">
        <PageHeader eyebrow="Admin" title="Sign in" subtitle="Admin access is restricted." />
        <button onClick={login} className={primaryButtonClass}>
          Sign in
        </button>
      </div>
    );
  }
  if (authz === "checking") return <CenteredMessage>Checking access…</CenteredMessage>;
  if (authz === "denied") {
    return (
      <CenteredMessage>
        You don&rsquo;t have admin access on this account.
      </CenteredMessage>
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader eyebrow="Admin" title="Console" subtitle={email ?? undefined} />
        <div className="flex gap-2">
          <TabButton active={tab === "vouchers"} onClick={() => setTab("vouchers")}>
            Rewards
          </TabButton>
          <TabButton active={tab === "users"} onClick={() => setTab("users")}>
            Users
          </TabButton>
        </div>
      </div>
      {tab === "vouchers" ? (
        <VoucherManager getToken={getAccessToken} />
      ) : (
        <UserRoster getToken={getAccessToken} />
      )}
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-control px-4 py-2 font-body text-sm font-medium transition-colors ${
        active ? "bg-accent text-accent-contrast" : "bg-surface-2 text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ Vouchers

interface AdminItem {
  id: string;
  name: string;
  partner: string | null;
  kind: string;
  points_cost: number;
  inventory_status: string;
  affiliate_url: string | null;
  codes_total: number;
  codes_available: number;
}

const INVENTORY_OPTIONS = ["in_stock", "out_of_stock", "coming_soon"];

// Reusable copy so admins pick a template instead of retyping the same lines.
const REDEEM_PRESETS: { label: string; text: string }[] = [
  {
    label: "Online — paste at checkout",
    text: "Enter this code at the partner's checkout to apply your discount. One use per code.",
  },
  {
    label: "In-store — show at counter",
    text: "Show this code at the partner's store counter to redeem. One use per code.",
  },
  {
    label: "Link + code",
    text: "Open the partner's link, then enter this code at checkout to redeem. One use per code.",
  },
];
const TERMS_PRESETS: { label: string; text: string }[] = [
  {
    label: "Standard (90 days, no cash value)",
    text: "Single-use. Valid 90 days from issue. No cash value and non-transferable. Cannot be combined with other offers.",
  },
  {
    label: "Minimum spend",
    text: "Single-use. Valid 90 days from issue. Minimum order value may apply. No cash value; non-transferable.",
  },
];

/** A textarea with a "insert a template" preset picker above it. */
function PresetField({
  label,
  field,
  presets,
  value,
  onSet,
}: {
  label: string;
  field: string;
  presets: { label: string; text: string }[];
  value: string;
  onSet: (k: string, v: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5 sm:col-span-2">
      <div className="flex items-center justify-between gap-2">
        <span className="font-body text-sm font-medium text-foreground/80">{label}</span>
        <select
          className="rounded-control border border-border bg-surface px-2 py-1 font-body text-xs text-muted"
          value=""
          onChange={(e) => {
            const p = presets.find((x) => x.label === e.target.value);
            if (p) onSet(field, p.text);
          }}
        >
          <option value="">Insert a template…</option>
          {presets.map((p) => (
            <option key={p.label} value={p.label}>
              {p.label}
            </option>
          ))}
        </select>
      </div>
      <textarea
        className={`${fieldClass} h-16 py-2`}
        value={value}
        onChange={(e) => onSet(field, e.target.value)}
      />
    </div>
  );
}

function VoucherManager({ getToken }: { getToken: () => Promise<string | null> }) {
  const [items, setItems] = useState<AdminItem[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [showAdd, setShowAdd] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const startedRef = useRef(false);

  const authFetch = useCallback(
    async (url: string, init?: RequestInit) => {
      const token = await getToken();
      return fetch(url, {
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

  const load = useCallback(async () => {
    try {
      const res = await authFetch("/api/admin/vouchers");
      if (!res.ok) return setStatus("error");
      setItems(((await res.json()) as { items: AdminItem[] }).items);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [authFetch]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void load();
  }, [load]);

  const setInventory = async (id: string, inventory_status: string) => {
    await authFetch("/api/admin/vouchers", {
      method: "PATCH",
      body: JSON.stringify({ id, inventory_status }),
    });
    void load();
  };

  const remove = async (id: string) => {
    const res = await authFetch(`/api/admin/vouchers?id=${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (!res.ok) setMsg(((await res.json()) as { error?: string }).error ?? "Couldn't delete.");
    void load();
  };

  if (status === "loading") return <CenteredMessage>Loading catalog…</CenteredMessage>;
  if (status === "error")
    return (
      <div className="flex flex-col gap-3">
        <p className="font-body text-sm text-muted">Couldn&rsquo;t load the catalog.</p>
        <button
          onClick={() => {
            setStatus("loading");
            void load();
          }}
          className={secondaryButtonClass}
        >
          Retry
        </button>
      </div>
    );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <Eyebrow>Catalog · {items.length} items</Eyebrow>
        <button onClick={() => setShowAdd((v) => !v)} className={secondaryButtonClass}>
          {showAdd ? "Close" : "Add item"}
        </button>
      </div>

      {msg && <p className="font-body text-sm text-accent-hover">{msg}</p>}

      {showAdd && (
        <AddItemForm
          authFetch={authFetch}
          onDone={() => {
            setShowAdd(false);
            void load();
          }}
        />
      )}

      <div className="flex flex-col gap-3">
        {items.map((it) => (
          <Card key={it.id} className="flex flex-col gap-3 p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <span className="font-body text-sm font-medium text-foreground">{it.name}</span>
                <span className="font-body text-xs text-muted">
                  {it.kind} · {it.partner ?? "—"}
                  {it.kind === "voucher"
                    ? ` · ${it.points_cost} pts · ${it.codes_available}/${it.codes_total} codes`
                    : ""}
                </span>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <select
                  className={`${fieldClass} w-36`}
                  value={it.inventory_status}
                  onChange={(e) => void setInventory(it.id, e.target.value)}
                >
                  {INVENTORY_OPTIONS.map((o) => (
                    <option key={o} value={o}>
                      {o.replace(/_/g, " ")}
                    </option>
                  ))}
                </select>
                <button
                  onClick={() => void remove(it.id)}
                  className="rounded-control px-2 py-1 font-body text-xs text-muted hover:text-accent"
                >
                  Delete
                </button>
              </div>
            </div>
            {it.kind === "voucher" && <CodeUploader itemId={it.id} authFetch={authFetch} onDone={load} />}
          </Card>
        ))}
      </div>
    </div>
  );
}

type AuthFetch = (url: string, init?: RequestInit) => Promise<Response>;

function AddItemForm({ authFetch, onDone }: { authFetch: AuthFetch; onDone: () => void }) {
  const [kind, setKind] = useState("voucher");
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string, v: string) => setF((p) => ({ ...p, [k]: v }));

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await authFetch("/api/admin/vouchers", {
        method: "POST",
        body: JSON.stringify({ ...f, kind, points_cost: Number(f.points_cost) || 0 }),
      });
      if (!res.ok) {
        setErr(((await res.json()) as { error?: string }).error ?? "Couldn't create.");
        return;
      }
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className={labelClass}>
          Kind
          <select className={fieldClass} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="voucher">voucher</option>
            <option value="affiliate">affiliate</option>
          </select>
        </label>
        <label className={labelClass}>
          Name
          <input className={fieldClass} value={f.name ?? ""} onChange={(e) => set("name", e.target.value)} />
        </label>
        <label className={labelClass}>
          Partner
          <input className={fieldClass} value={f.partner ?? ""} onChange={(e) => set("partner", e.target.value)} />
        </label>
        <label className={labelClass}>
          Category
          <input className={fieldClass} value={f.category ?? ""} onChange={(e) => set("category", e.target.value)} />
        </label>
        {kind === "voucher" ? (
          <>
            <label className={labelClass}>
              Points cost
              <input
                className={fieldClass}
                type="number"
                value={f.points_cost ?? ""}
                onChange={(e) => set("points_cost", e.target.value)}
              />
            </label>
            <label className={labelClass}>
              Value label (e.g. ₹500 off)
              <input className={fieldClass} value={f.discount_value ?? ""} onChange={(e) => set("discount_value", e.target.value)} />
            </label>
          </>
        ) : (
          <label className={`${labelClass} sm:col-span-2`}>
            Affiliate URL
            <input className={fieldClass} value={f.affiliate_url ?? ""} onChange={(e) => set("affiliate_url", e.target.value)} placeholder="https://…?ref=ikigaro" />
          </label>
        )}
        <label className={`${labelClass} sm:col-span-2`}>
          Description
          <input className={fieldClass} value={f.description ?? ""} onChange={(e) => set("description", e.target.value)} />
        </label>
        {kind === "voucher" && (
          <>
            <PresetField
              label="How to redeem"
              field="redeem_instructions"
              presets={REDEEM_PRESETS}
              value={f.redeem_instructions ?? ""}
              onSet={set}
            />
            <PresetField
              label="Terms"
              field="terms"
              presets={TERMS_PRESETS}
              value={f.terms ?? ""}
              onSet={set}
            />
          </>
        )}
      </div>
      {err && <p className="font-body text-sm text-accent-hover">{err}</p>}
      <button onClick={() => void submit()} disabled={busy} className={`${primaryButtonClass} self-start`}>
        {busy ? "Saving…" : "Create item"}
      </button>
    </Card>
  );
}

function CodeUploader({
  itemId,
  authFetch,
  onDone,
}: {
  itemId: string;
  authFetch: AuthFetch;
  onDone: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const upload = async () => {
    const codes = text.split("\n").map((c) => c.trim()).filter(Boolean);
    if (codes.length === 0) return;
    setBusy(true);
    setNote(null);
    try {
      const res = await authFetch("/api/admin/vouchers/codes", {
        method: "POST",
        body: JSON.stringify({ item_id: itemId, codes }),
      });
      const r = (await res.json()) as { added?: number; submitted?: number; error?: string };
      if (!res.ok) setNote(r.error ?? "Couldn't add codes.");
      else {
        setNote(`Added ${r.added} of ${r.submitted} (duplicates skipped).`);
        setText("");
        onDone();
      }
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="self-start font-body text-xs text-accent underline underline-offset-4">
        Add codes
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <textarea
        className={`${fieldClass} h-24 py-2`}
        placeholder="One code per line"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {note && <p className="font-body text-xs text-muted">{note}</p>}
      <div className="flex gap-2">
        <button onClick={() => void upload()} disabled={busy} className={secondaryButtonClass}>
          {busy ? "Adding…" : "Upload codes"}
        </button>
        <button onClick={() => setOpen(false)} className="px-2 font-body text-xs text-muted">
          Done
        </button>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------- Users

interface RosterUser {
  id: string;
  email: string;
  created_at: string;
  deleted: boolean;
  points: number;
  panels: number;
  last_checkin: string | null;
  streak: number;
}

function UserRoster({ getToken }: { getToken: () => Promise<string | null> }) {
  const [users, setUsers] = useState<RosterUser[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const startedRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const token = await getToken();
      const res = await fetch("/api/admin/users", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return setStatus("error");
      setUsers(((await res.json()) as { users: RosterUser[] }).users);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [getToken]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void load();
  }, [load]);

  if (status === "loading") return <CenteredMessage>Loading users…</CenteredMessage>;
  if (status === "error")
    return (
      <div className="flex flex-col gap-3">
        <p className="font-body text-sm text-muted">Couldn&rsquo;t load users.</p>
        <button
          onClick={() => {
            setStatus("loading");
            void load();
          }}
          className={secondaryButtonClass}
        >
          Retry
        </button>
      </div>
    );

  return (
    <div className="flex flex-col gap-3">
      <Eyebrow>{users.length} users</Eyebrow>
      <Card className="overflow-x-auto p-0">
        <table className="w-full min-w-[36rem] text-left">
          <thead>
            <tr className="border-b border-border font-body text-xs text-muted">
              <th className="px-4 py-2 font-medium">Email</th>
              <th className="px-4 py-2 font-medium">Joined</th>
              <th className="px-4 py-2 font-medium">Points</th>
              <th className="px-4 py-2 font-medium">Panels</th>
              <th className="px-4 py-2 font-medium">Last check-in</th>
              <th className="px-4 py-2 font-medium">Streak</th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} className="border-b border-border/60 font-body text-sm text-foreground">
                <td className="px-4 py-2">
                  {u.email}
                  {u.deleted && <span className="ml-1 text-xs text-muted">(deleted)</span>}
                </td>
                <td className="px-4 py-2 text-muted">
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-2">{u.points}</td>
                <td className="px-4 py-2">{u.panels}</td>
                <td className="px-4 py-2 text-muted">{u.last_checkin ?? "—"}</td>
                <td className="px-4 py-2">{u.streak}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
