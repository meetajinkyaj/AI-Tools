"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ProfileRow } from "@/lib/profile";
import { AppShell, NAV_ITEMS, type NavKey } from "./app-shell";
import { BiomarkerReport } from "./biomarker-report";
import { CheckinForm } from "./checkin-form";
import { Dashboard } from "./dashboard";
import { InstallPrompt } from "./install-prompt";
import { InterventionLog } from "./intervention-log";
import { OnboardingForm } from "./onboarding-form";
import { PartnersView } from "./partners-view";
import { ProfileEditForm } from "./profile-edit-form";
import { ProfileView } from "./profile-view";
import { TrendsView } from "./trends-view";
import { FutureView } from "./future-view";
import { Screen, Splash } from "./ui";
import { WaitlistScreen } from "./waitlist-screen";

type Status = "loading" | "waitlisted" | "onboarding" | "ready" | "error";

/**
 * Orchestrates the authenticated experience:
 *   1. Ensure the user row exists in Supabase (POST /api/auth/sync).
 *   2. Load the user's profile (GET /api/profile).
 *   3. Route to onboarding (no profile) or the app shell (has profile).
 *
 * Steps 1 and 2 run in sequence so the profile lookup never races the user
 * row's creation on a first-ever login.
 */
export function AuthedApp() {
  const { user, getAccessToken, logout } = usePrivy();
  const [status, setStatus] = useState<Status>("loading");
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [tab, setTab] = useState<NavKey>("home");
  const [sheetOpen, setSheetOpen] = useState(false);
  const [summaryVersion, setSummaryVersion] = useState(0);
  const [profileMode, setProfileMode] = useState<"view" | "edit">("view");
  const startedRef = useRef(false);

  /*
   * THE SECTION LIVES IN THE URL, as `?tab=`.
   *
   * The handoff asks for deep-linkable sections where back and forward work.
   * That was not true: the section was React state, so a shared link always
   * opened Home and the back button left the app entirely, which on a phone is
   * the gesture people use to mean "go back one screen".
   *
   * DONE WITH THE HISTORY API RATHER THAN ROUTE SEGMENTS. Every section here is
   * a client component behind one auth gate that runs once, so splitting them
   * into real routes would duplicate that gate per route and rebuild the whole
   * authenticated tree to change what is a design detail. A query parameter is
   * a real URL: it shares, it deep-links, and popstate makes back and forward
   * behave. If these ever need server rendering, that is the moment for route
   * segments.
   */
  const navigate = useCallback((key: NavKey, push = true) => {
    // Navigating always lands on the Profile tab in view mode (edit is explicit).
    if (key === "profile") setProfileMode("view");
    setTab(key);
    setSheetOpen(false);
    if (!push || typeof window === "undefined") return;
    const url = new URL(window.location.href);
    // Home is the bare URL. A canonical "/" is what people paste, and
    // "/?tab=home" would be a second address for the same screen.
    if (key === "home") url.searchParams.delete("tab");
    else url.searchParams.set("tab", key);
    window.history.pushState({ tab: key }, "", url);
  }, []);

  /** Read the section out of the URL, ignoring anything we do not recognise. */
  const tabFromUrl = (): NavKey => {
    const raw = new URLSearchParams(window.location.search).get("tab");
    return NAV_ITEMS.some((i) => i.key === raw) ? (raw as NavKey) : "home";
  };

  useEffect(() => {
    /*
     * The first read has to happen AFTER mount. The server has no URL, so
     * computing this during render (or as lazy initial state) makes the server
     * say "home" and the client say "trends", which is a hydration mismatch.
     *
     * Wrapped in an async IIFE for the same reason the other effects in this
     * app are: the lint rule wants to see that no setState happens
     * synchronously in an effect body.
     */
    void (async () => {
      setTab(tabFromUrl());
    })();

    const onPop = () => {
      setTab(tabFromUrl());
      setSheetOpen(false);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const token = await getAccessToken();
      const email = user?.email?.address;
      if (!token || !email) {
        setStatus("error");
        return;
      }

      // Pass along a remembered invite code (attributed server-side only on
      // first-ever signup; harmless for existing accounts).
      let ref: string | null = null;
      try {
        ref = localStorage.getItem("ikigaro.ref");
      } catch {
        /* best-effort */
      }
      const syncRes = await fetch("/api/auth/sync", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, ...(ref ? { ref } : {}) }),
      });
      if (!syncRes.ok) {
        setStatus("error");
        return;
      }
      // Beta gate: waitlisted users see the waitlist screen, nothing else.
      const sync = (await syncRes.json()) as { access_status?: string };
      if (sync.access_status && sync.access_status !== "approved") {
        setStatus("waitlisted");
        return;
      }

      const profileRes = await fetch("/api/profile", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!profileRes.ok) {
        setStatus("error");
        return;
      }

      const data = (await profileRes.json()) as { profile: ProfileRow | null };
      if (data.profile) {
        setProfile(data.profile);
        setStatus("ready");
      } else {
        setStatus("onboarding");
      }
    } catch (err) {
      console.error("Failed to load account:", err);
      setStatus("error");
    }
  }, [getAccessToken, user]);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void load();
  }, [load]);

  if (status === "loading") {
    return <Splash caption="Setting up your account…" />;
  }

  if (status === "waitlisted") {
    return (
      <WaitlistScreen
        email={user?.email?.address ?? null}
        onRefresh={() => void load()}
        onLogout={() => void logout()}
        checking={false}
      />
    );
  }

  if (status === "error") {
    return (
      <Screen>
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="text-body-sm text-muted">
            Something went wrong loading your account.
          </p>
          <button
            type="button"
            onClick={() => void load()}
            className="iki-btn iki-btn-primary"
          >
            Try again
          </button>
        </div>
      </Screen>
    );
  }

  if (status === "onboarding") {
    return (
      <OnboardingForm
        getToken={getAccessToken}
        onComplete={(created) => {
          setProfile(created);
          setStatus("ready");
        }}
      />
    );
  }

  return (
    <AppShell
      active={tab}
      onNavigate={navigate}
      sheetOpen={sheetOpen}
      onSheetOpen={() => setSheetOpen(true)}
      onSheetClose={() => setSheetOpen(false)}
      displayName={profile?.full_name}
    >
      {tab === "home" && (
        <div className="flex w-full max-w-xl flex-col gap-stack">
          <InstallPrompt />
          <Dashboard
            profile={profile as ProfileRow}
            getToken={getAccessToken}
            onCheckIn={() => navigate("checkin")}
            onOpenSettings={() => navigate("profile")}
            refreshKey={summaryVersion}
          />
          <InterventionLog getToken={getAccessToken} />
        </div>
      )}
      {tab === "checkin" && (
        <CheckinForm
          getToken={getAccessToken}
          activities={(profile as ProfileRow).activities ?? []}
          onChange={() => setSummaryVersion((v) => v + 1)}
        />
      )}
      {tab === "profile" && profileMode === "view" && (
        <ProfileView
          profile={profile as ProfileRow}
          onEdit={() => setProfileMode("edit")}
          onLogout={() => void logout()}
          getToken={getAccessToken}
        />
      )}
      {tab === "profile" && profileMode === "edit" && (
        <ProfileEditForm
          profile={profile as ProfileRow}
          getToken={getAccessToken}
          onSaved={(updated) => {
            setProfile(updated);
            setProfileMode("view");
          }}
          onCancel={() => setProfileMode("view")}
        />
      )}
      {tab === "report" && (
        <BiomarkerReport
          getToken={getAccessToken}
          onExploreRewards={() => navigate("partners")}
        />
      )}
      {tab === "trends" && <TrendsView getToken={getAccessToken} />}
      {tab === "future" && (
        <FutureView
          getToken={getAccessToken}
          onCheckIn={() => navigate("checkin")}
          onUploadPanel={() => navigate("report")}
        />
      )}
      {tab === "partners" && <PartnersView getToken={getAccessToken} />}
    </AppShell>
  );
}
