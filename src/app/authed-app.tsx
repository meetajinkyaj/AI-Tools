"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useCallback, useEffect, useRef, useState } from "react";

import type { ProfileRow } from "@/lib/profile";
import { Dashboard } from "./dashboard";
import { OnboardingForm } from "./onboarding-form";
import { ProfileEditForm } from "./profile-edit-form";
import { CenteredMessage, primaryButtonClass, Screen } from "./ui";

type Status = "loading" | "onboarding" | "ready" | "error";

/**
 * Orchestrates the authenticated experience:
 *   1. Ensure the user row exists in Supabase (POST /api/auth/sync).
 *   2. Load the user's profile (GET /api/profile).
 *   3. Route to onboarding (no profile) or the dashboard (has profile).
 *
 * Steps 1 and 2 run in sequence so the profile lookup never races the user
 * row's creation on a first-ever login.
 */
export function AuthedApp() {
  const { user, getAccessToken } = usePrivy();
  const [status, setStatus] = useState<Status>("loading");
  const [profile, setProfile] = useState<ProfileRow | null>(null);
  const [editing, setEditing] = useState(false);
  const startedRef = useRef(false);

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
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
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

  if (editing) {
    return (
      <ProfileEditForm
        profile={profile as ProfileRow}
        getToken={getAccessToken}
        onSaved={(updated) => {
          setProfile(updated);
          setEditing(false);
        }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  return (
    <Dashboard profile={profile as ProfileRow} onEdit={() => setEditing(true)} />
  );
}
