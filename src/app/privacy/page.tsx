import type { Metadata } from "next";

import { LegalShell } from "../legal-shell";

export const metadata: Metadata = {
  title: "Privacy Policy · Ikigaro",
  description: "How Ikigaro collects, uses, and protects your data.",
};

export default function PrivacyPage() {
  return (
    <LegalShell eyebrow="Legal" title="Privacy Policy">
      <p>
        This Privacy Policy explains how Ikigaro (&ldquo;Ikigaro,&rdquo;
        &ldquo;we,&rdquo; &ldquo;us&rdquo;), operated by{" "}
        <strong>[Ikigaro operating entity — legal company name]</strong>,
        collects, uses, shares, and protects information when you use the
        Ikigaro web application at app.ikigaro.com (the &ldquo;Service&rdquo;).
        Because the Service handles health-related information, we treat that
        data with particular care, as described below.
      </p>
      <p>
        By using the Service you agree to this Policy. If you do not agree,
        please do not use the Service.
      </p>

      <h2>1. Information we collect</h2>
      <h3>Information you provide</h3>
      <ul>
        <li>
          <strong>Account &amp; identity.</strong> Your email address, used to
          sign in. Authentication is handled by our provider, Privy, which
          issues you a secure login and creates an embedded wallet address on
          your behalf.
        </li>
        <li>
          <strong>Profile.</strong> Name, date of birth, biological sex,
          primary goal, activity level, and — if you choose to add them — known
          health conditions, country, and city.
        </li>
        <li>
          <strong>Health inputs.</strong> Biomarker/blood-panel data you enter
          or upload (including any lab report files), and daily check-ins such
          as sleep, energy, and training or nutrition notes.
        </li>
        <li>
          <strong>Communications.</strong> Messages you send us and your
          marketing-communication preferences.
        </li>
      </ul>
      <h3>Information collected automatically</h3>
      <ul>
        <li>
          <strong>Usage &amp; device data.</strong> Basic technical and log
          data (such as device/browser type and interactions with the Service)
          used to operate, secure, and improve it.
        </li>
      </ul>

      <h2>2. How we use your information</h2>
      <ul>
        <li>Provide and personalize the Service, including biomarker reports, progress trends, rewards, and the &ldquo;Future You&rdquo; projection.</li>
        <li>Operate the iki-points rewards program.</li>
        <li>Maintain security, prevent abuse, and debug problems.</li>
        <li>Communicate with you about the Service, and — only if you opt in — send occasional product updates.</li>
        <li>Comply with legal obligations and enforce our Terms.</li>
      </ul>
      <p>
        We do <strong>not</strong> sell your personal information, and we do not
        use your health data for advertising.
      </p>

      <h2>3. Health data</h2>
      <p>
        Biomarker results, conditions, and check-in inputs are sensitive. A few
        points to be clear about:
      </p>
      <ul>
        <li>
          Ikigaro is a consumer wellness product, not a healthcare provider or
          insurer, and is generally <strong>not</strong> a HIPAA
          &ldquo;covered entity.&rdquo; HIPAA therefore does not usually govern
          this data — but consumer-health-privacy laws may.
        </li>
        <li>
          Where they apply, we aim to honor consumer health-data laws such as
          Washington&rsquo;s My Health My Data Act and similar state or national
          regulations. We collect health data only to provide features you use,
          and only with your consent.
        </li>
        <li>
          You can view, edit, export, or delete your health data at any time
          (see &ldquo;Your rights&rdquo;).
        </li>
      </ul>

      <h2>4. How we share information</h2>
      <p>We share information only as needed to run the Service:</p>
      <ul>
        <li>
          <strong>Service providers (processors).</strong> Privy
          (authentication and embedded wallets), Supabase (database and file
          storage), and Cloudflare (hosting). They process data on our behalf
          under contract.
        </li>
        <li>
          <strong>Redemption partners.</strong> If you redeem iki points, we
          share the minimum needed to fulfill that redemption (for example, to
          issue a discount code) — never your health data.
        </li>
        <li>
          <strong>Legal &amp; safety.</strong> Where required by law, or to
          protect the rights, safety, and security of users, the public, or
          Ikigaro.
        </li>
        <li>
          <strong>Business transfers.</strong> In connection with a merger,
          acquisition, or sale of assets, subject to this Policy.
        </li>
      </ul>

      <h2>5. Storage, security &amp; retention</h2>
      <p>
        Data is stored in Supabase (Postgres and storage). Every table has
        row-level security enabled with no public policies, so application data
        is reachable only by our server using a privileged key — never directly
        by the browser or the public. We apply reasonable technical and
        organizational safeguards; however, no method of transmission or storage
        is completely secure.
      </p>
      <p>
        We retain your information for as long as your account is active or as
        needed to provide the Service, and thereafter only as required for
        legal, accounting, or legitimate business purposes.
      </p>

      <h2>6. Your rights &amp; choices</h2>
      <ul>
        <li>
          <strong>Access &amp; correction.</strong> View and update your profile
          in the app.
        </li>
        <li>
          <strong>Export &amp; deletion.</strong> Request a copy of your data or
          deletion of your account and associated data by contacting us at{" "}
          <a href="mailto:privacy@ikigaro.com">privacy@ikigaro.com</a>.
        </li>
        <li>
          <strong>Marketing.</strong> Opt out of product emails at any time.
        </li>
        <li>
          Depending on where you live, you may have additional rights under
          laws such as the GDPR or state consumer-privacy and health-data laws.
          We will honor valid requests as required.
        </li>
      </ul>

      <h2>7. Children</h2>
      <p>
        The Service is not directed to children under 13, and we do not
        knowingly collect their data. Some regions require a higher minimum age;
        you must meet the minimum age in your jurisdiction to use the Service.
      </p>

      <h2>8. International transfers</h2>
      <p>
        Your information may be processed in countries other than your own,
        including where our providers operate. Where required, we use
        appropriate safeguards for such transfers.
      </p>

      <h2>9. Changes to this Policy</h2>
      <p>
        We may update this Policy from time to time. Material changes will be
        reflected by updating the effective date above and, where appropriate,
        by additional notice.
      </p>

      <h2>10. Contact</h2>
      <p>
        Questions or requests: <a href="mailto:privacy@ikigaro.com">privacy@ikigaro.com</a>.
      </p>
    </LegalShell>
  );
}
