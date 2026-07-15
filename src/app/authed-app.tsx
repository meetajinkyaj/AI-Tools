"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ProfileRow } from "@/lib/profile";
import { AppShell, type NavKey } from "./app-shell";
import { CheckinForm } from "./checkin-form";
import { Dashboard } from "./dashboard";
import { OnboardingForm } from "./onboarding-form";
import { ProfileEditForm } from "./profile-edit-form";
import { ProfileView } from "./profile-view";
import { CenteredMessage, ComingSoon, primaryButtonClass, Screen } from "./ui";

type Status = "loading" | "onboarding" | "ready" | "error";

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
  const [summaryVersion, setSummaryVersion] = useState(0);
  const [profileMode, setProfileMode] = useState<"view" | "edit">("view");
  const startedRef = useRef(false);

  // Navigating always lands on the Profile tab in view mode (edit is explicit).
  const navigate = (key: NavKey) => {
    if (key === "profile") setProfileMode("view");
    setTab(key);
  };

  const load = useCallback(async () => {
    setStatus("loading");
    try {
      const token = await getAccessToken();
      const email = user?.email?.address;
      if (!token || !email) {
        setStatus("error");
        return;
      }

      const syncRes = await fetch("/api/auth/sync", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email }),
      });
      if (!syncRes.ok) {
        setStatus("error");
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
    return <CenteredMessage>Setting up your account…</CenteredMessage>;
  }

  if (status === "error") {
    return (
      <Screen>
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="font-body text-sm text-muted">
            Something went wrong loading your account.
          </p>
          <button onClick={() => void load()} className={primaryButtonClass}>
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
    <AppShell active={tab} onNavigate={navigate} onLogout={() => void logout()}>
      {tab === "home" && (
        <Dashboard
          profile={profile as ProfileRow}
          getToken={getAccessToken}
          onCheckIn={() => setTab("checkin")}
          refreshKey={summaryVersion}
        />
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
        <ComingSoon
          eyebrow="Coming soon"
          title="Biomarker Report"
          note="Enter or upload a blood panel to get a plain-language, in-range / out-of-range report. Coming soon."
        />
      )}
      {tab === "trends" && (
        <ComingSoon
          eyebrow="Coming soon"
          title="Progress & Trends"
          note="Week-over-week movement across your markers and check-ins will appear here once you have enough data."
        />
      )}
      {tab === "future" && (
        <ComingSoon
          eyebrow="Coming soon"
          title="Future You"
          note="A directional six-month projection for each marker — motivational, not diagnostic — is coming soon."
        />
      )}
      {tab === "rewards" && (
        <ComingSoon
          eyebrow="Coming soon"
          title="Rewards"
          note="Spend iki points on partner perks and, eventually, Ikigaro Space. The catalog is coming soon."
        />
      )}
    </AppShell>
  );
}
