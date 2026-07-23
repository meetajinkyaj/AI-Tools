import type { Metadata } from "next";

import { LegalShell } from "../legal-shell";

export const metadata: Metadata = {
  title: "Terms of Service · Ikigaro",
  description: "The terms that govern your use of Ikigaro.",
};

export default function TermsPage() {
  return (
    <LegalShell eyebrow="Legal" title="Terms of Service">
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your use of the
        Ikigaro web application at app.ikigaro.com (the &ldquo;Service&rdquo;),
        operated by{" "}
        <strong>Ikigaro by Avisa Innovation LLP</strong>, based in Pune,
        Maharashtra, India (&ldquo;Ikigaro,&rdquo; &ldquo;we,&rdquo;
        &ldquo;us&rdquo;). By creating
        an account or using the Service, you agree to these Terms and to our{" "}
        <a href="/privacy">Privacy Policy</a>. If you do not agree, do not use
        the Service.
      </p>

      <h2>1. Eligibility</h2>
      <p>
        You must be at least 18 years old, or the age of majority in your
        jurisdiction, to use the Service. By using it, you confirm that you meet
        this requirement and that the information you provide is accurate.
      </p>

      <h2>2. Wellness, not medical care</h2>
      <p>
        Ikigaro is a <strong>wellness and informational</strong> product. It
        does <strong>not</strong> provide medical advice, diagnosis, or
        treatment, and it is not a substitute for professional medical care.
        Using the Service does not create a doctor&ndash;patient relationship.
      </p>
      <ul>
        <li>
          Always seek the advice of a qualified health provider with any
          questions about a medical condition, your lab results, or any changes
          to diet, supplements, exercise, or medication.
        </li>
        <li>
          Never disregard or delay professional medical advice because of
          something you read in the Service.
        </li>
        <li>
          If you think you may have a medical emergency, call your doctor or
          emergency services immediately.
        </li>
        <li>
          Any educational information about markers, nutrients, or habits is
          general and is not a personalized recommendation or a specific dose
          for you.
        </li>
      </ul>

      <h2>3. &ldquo;Future You&rdquo; projections</h2>
      <p>
        The &ldquo;Future You&rdquo; feature shows a <strong>directional,
        illustrative projection only</strong>. Please understand how it works
        before relying on it:
      </p>
      <ul>
        <li>
          It is a <strong>model built solely from the data you have entered</strong>{" "}
          (your own past inputs), extrapolated on the assumption that your
          current, repetitive behaviours and patterns continue unchanged into
          the future. It is not a measurement, a diagnosis, or a promise of any
          actual health outcome.
        </li>
        <li>
          It is highly sensitive to your inputs: <strong>even the slightest
          change in your data on a subsequent test can change the projection and
          reverse its direction.</strong> A single new data point can move a
          trend up or down.
        </li>
        <li>
          Because it assumes unchanged behaviour, it does not account for future
          changes in your habits, health, environment, treatment, or other
          factors. Real outcomes will differ.
        </li>
        <li>
          The projection is intended to be <strong>motivational, not
          predictive or diagnostic</strong>, and should never be used to make
          medical decisions. Discuss any health decisions with a qualified
          professional.
        </li>
      </ul>

      <h2>4. Your account</h2>
      <p>
        You are responsible for the accuracy of the information you provide and
        for activity under your account. Authentication and your embedded wallet
        are provided through Privy; you are responsible for maintaining access
        to your login. Notify us promptly of any unauthorized use.
      </p>

      <h2>5. iki points &amp; rewards</h2>
      <ul>
        <li>
          iki points are not money or legal tender, cannot be exchanged for
          cash, and are non-transferable except as we expressly allow.
        </li>
        <li>
          Points are awarded and redeemed at our discretion under the current
          program rules, which we may change or discontinue. Point values,
          earning rules, and catalog items may change over time.
        </li>
        <li>
          Points may expire or be forfeited — for example, on account closure or
          if we reasonably determine the program is being gamed, abused, or used
          fraudulently.
        </li>
        <li>
          Redemptions depend on availability and on our partners&rsquo; terms. A
          redemption is not guaranteed until fulfilled.
        </li>
      </ul>

      <h2>6. Embedded wallet</h2>
      <p>
        The Service uses Privy to create an embedded wallet for your account.
        Any blockchain-based features are provided as-is and may depend on
        third-party networks outside our control. You are responsible for
        activity associated with your wallet to the extent it is within your
        control.
      </p>

      <h2>7. Acceptable use</h2>
      <p>You agree not to:</p>
      <ul>
        <li>Use the Service unlawfully, or upload data you have no right to share.</li>
        <li>Attempt to access other users&rsquo; data, or probe, scan, or breach security.</li>
        <li>Interfere with or disrupt the Service, or reverse-engineer it except where permitted by law.</li>
        <li>Manipulate the points program or misrepresent your inputs.</li>
      </ul>

      <h2>8. Intellectual property</h2>
      <p>
        The Service, including its content, design, and trademarks (including
        the Ikigaro name and wordmark), is owned by Avisa Innovation LLP. You
        retain ownership of the data you submit and grant us a license to
        process it.
      </p>

      <h2>9. Third-party services</h2>
      <p>
        The Service relies on third parties such as Privy, Supabase, and
        Cloudflare, and may link to partner offerings. We are not responsible
        for third-party services, and your use of them may be subject to their
        own terms.
      </p>

      <h2>10. Disclaimers</h2>
      <p>
        The Service is provided <strong>&ldquo;as is&rdquo; and &ldquo;as
        available,&rdquo;</strong> without warranties of any kind, whether
        express or implied, including fitness for a particular purpose and
        non-infringement. We do not warrant that the Service will be
        uninterrupted, error-free, or that any information (including biomarker
        interpretations or projections) is accurate or complete.
      </p>

      <h2>11. Limitation of liability</h2>
      <p>
        To the maximum extent permitted by law, Ikigaro and its operators will
        not be liable for any indirect, incidental, special, consequential, or
        punitive damages, or for any loss arising from your reliance on the
        Service or its health-related content. Our total liability for any claim
        is limited to the amount you paid us, if any, in the 12 months before
        the claim.
      </p>

      <h2>12. Indemnification</h2>
      <p>
        You agree to indemnify and hold Ikigaro harmless from claims arising out
        of your misuse of the Service or violation of these Terms.
      </p>

      <h2>13. Termination</h2>
      <p>
        You may stop using the Service at any time. We may suspend or terminate
        access if you violate these Terms or to protect the Service or its
        users.
      </p>

      <h2 id="rewards">14. Rewards, iki points &amp; partners</h2>
      <p>
        Ikigaro includes a rewards programme where you earn <strong>iki points</strong>
        {" "}for engagement (for example daily check-ins, uploading a lab panel, or a
        data-verified improvement) and can redeem them for partner vouchers.
      </p>
      <h3>iki points</h3>
      <ul>
        <li>
          iki points are a loyalty and engagement feature. They have{" "}
          <strong>no cash value</strong>, are not money or a stored-value
          instrument, and cannot be sold, transferred, or exchanged for cash.
        </li>
        <li>
          Point values, earning rules, and redemption prices are set by us and{" "}
          <strong>may change</strong> at any time as we tune the programme.
        </li>
        <li>
          Points may be <strong>withheld, reduced, or reversed</strong> if we
          reasonably believe they were obtained through error, abuse, or gaming
          of the system, or if your account is closed or found to violate these
          Terms.
        </li>
      </ul>
      <h3>Vouchers</h3>
      <ul>
        <li>
          Vouchers are <strong>single-use</strong> and may carry an expiry,
          minimum spend, or other conditions, which are shown on the voucher at
          redemption.
        </li>
        <li>
          Voucher goods and services are provided by the{" "}
          <strong>partner, not by Ikigaro</strong>, and are subject to that
          partner&rsquo;s own terms. We are not responsible for a partner&rsquo;s
          products, fulfilment, or availability.
        </li>
        <li>
          Once a code is issued the points are spent. If a voucher fails through
          no fault of yours, contact us and we&rsquo;ll try to help.
        </li>
      </ul>
      <h3>Affiliate links</h3>
      <p>
        Some products in Rewards are <strong>affiliate links</strong>. If you buy
        through them we may earn a commission, at no extra cost to you. These are
        products we think are worth knowing about — they are{" "}
        <strong>not medical advice or an endorsement</strong>, and no points are
        spent to use them.
      </p>
      <h3>Your data and partners</h3>
      <p>
        Redeeming a reward shares only what a partner needs to fulfil it. We{" "}
        <strong>do not sell your health data</strong> to insurers or advertisers;
        a reward you consent to redeem is not a sale of your data. Everything in
        Ikigaro is <strong>educational, not a diagnosis — please consult a
        doctor.</strong>
      </p>
      <p>
        We may change, suspend, or discontinue the rewards programme, or any
        item in it, at any time.
      </p>

      <h2>15. Changes to these Terms</h2>
      <p>
        We may update these Terms from time to time. Material changes take
        effect when we update the effective date above and, where appropriate,
        provide additional notice. Continued use after changes means you accept
        them.
      </p>

      <h2>16. Governing law</h2>
      <p>
        These Terms are governed by the laws of{" "}
        <strong>Pune, Maharashtra, India</strong>, without regard to
        conflict-of-laws rules, and any disputes will be subject to the
        jurisdiction of the courts of Pune, Maharashtra, India.
      </p>

      <h2>17. Contact</h2>
      <p>
        Questions about these Terms: <a href="mailto:hello@ikigaro.com">hello@ikigaro.com</a>.
      </p>
    </LegalShell>
  );
}
