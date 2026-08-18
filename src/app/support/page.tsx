import type { Metadata } from "next";

import { LegalShell } from "../legal-shell";

export const metadata: Metadata = {
  title: "Support · Ikigaro",
  description: "How to get help with Ikigaro, including connected devices.",
};

/**
 * The support page.
 *
 * WHY IT EXISTS. Device partners require one. COROS state it as a condition of
 * partnering: every partner must have "a Login Portal and Support Page on their
 * website or support center to allow users to access the integration and request
 * technical support". A member who connects a watch and then has a question
 * about it needs somewhere to go that is not the app they are already stuck in,
 * and a vendor reviewing an integration needs to see that somewhere exists.
 *
 * Reachable without signing in, deliberately: half the reasons to look for
 * support are reasons you cannot get past the front door.
 */
export default function SupportPage() {
  return (
    <LegalShell eyebrow="Help" title="Support">
      <p>
        Ikigaro is operated by <strong>Ikigaro by Avisa Innovation LLP</strong>,
        Pune, Maharashtra, India. The quickest way to reach a person is email:{" "}
        <a href="mailto:hello@ikigaro.com">hello@ikigaro.com</a>. We answer in
        English, usually within two working days.
      </p>
      <p>
        <strong>Sign in at <a href="https://app.ikigaro.com">app.ikigaro.com</a></strong>{" "}
        to reach your own data, including everything below.
      </p>

      <h2>Connected devices</h2>
      <p>
        Ikigaro can read daily summaries from a wearable you connect, so your
        sleep, recovery and activity appear beside your lab results. Connecting
        is optional and the app works without it.
      </p>
      <ul>
        <li>
          <strong>To connect or disconnect a device</strong>, open Profile, then
          Connected devices. Disconnecting takes effect immediately: we ask the
          device maker to revoke our access where they support it, and delete our
          copy of your credentials.
        </li>
        <li>
          <strong>If a reading looks wrong</strong>, open Trends and expand
          &ldquo;What your device says&rdquo;. It lists every reading exactly as
          your device sent it, day by day, so you can compare it against that
          device&rsquo;s own app. Where the two disagree it is usually a
          difference of definition, and that panel says which.
        </li>
        <li>
          <strong>If nothing has arrived</strong>, syncing runs every morning at
          07:30 IST, and you can sync on demand from Home. Some readings are
          finalised by the device maker hours after they are taken, so a sync
          straight after waking can legitimately come back with nothing new.
        </li>
        <li>
          <strong>If a device asks to be reconnected</strong>, its permission has
          expired or been withdrawn at the maker&rsquo;s end. Reconnecting from
          Profile restores it, and nothing already synced is lost.
        </li>
      </ul>

      <h2>Your data</h2>
      <ul>
        <li>
          <strong>To correct your profile or lab results</strong>, edit them in
          the app: Profile for personal details, Report for a panel.
        </li>
        <li>
          <strong>To delete your account and everything in it</strong>, email{" "}
          <a href="mailto:hello@ikigaro.com">hello@ikigaro.com</a> with
          &ldquo;delete&rdquo; in the subject. That includes readings synced from
          any device you connected.
        </li>
        <li>
          What we collect and why is in the{" "}
          <a href="/privacy">Privacy Policy</a>, which covers connected devices
          specifically.
        </li>
      </ul>

      <h2>A reminder about what Ikigaro is</h2>
      <p>
        Educational, not a diagnosis. Please consult a doctor. Ikigaro is a
        wellness product: it helps you read your own results and see what moves
        them, and it does not provide medical advice, diagnosis or treatment. See
        the <a href="/terms">Terms of Service</a>.
      </p>

      <h2>Security</h2>
      <p>
        To report a security or privacy concern, email{" "}
        <a href="mailto:hello@ikigaro.com">hello@ikigaro.com</a> with
        &ldquo;security&rdquo; in the subject and we will treat it as a priority.
      </p>
    </LegalShell>
  );
}
