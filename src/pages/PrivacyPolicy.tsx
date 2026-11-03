import PublicPageLayout from "@/components/PublicPageLayout";

export default function PrivacyPolicyPage() {
  return (
    <PublicPageLayout
      eyebrow="Privacy Policy"
      title="Privacy Policy"
      description="This policy describes how DigestDesk collects, uses, stores, and deletes personal data, including data accessed through Apple, Google, and YouTube integrations."
    >
      <section>
        <h2 className="text-2xl font-semibold text-foreground">1. Controller and contact</h2>
        <p className="mt-3">
          DigestDesk is operated by an individual developer. If you have privacy questions or
          deletion requests, contact the operator at{" "}
          <a
            href="mailto:nexteacc@gmail.com"
            className="text-primary underline underline-offset-4"
          >
            nexteacc@gmail.com
          </a>
          .
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-foreground">2. Data we collect</h2>
        <p className="mt-3">
          DigestDesk stores your Clerk account identifier, email address, name and avatar URL,
          selected feed subscriptions, content metadata, and generated daily digests. Signing in
          does not by itself authorize access to your YouTube subscription list.
        </p>
        <p className="mt-3">
          If a user chooses to connect Google, and if the integration is enabled for that
          environment, DigestDesk may request read-only access to the user's YouTube subscription
          list through the YouTube Data API scope{" "}
          <code>https://www.googleapis.com/auth/youtube.readonly</code>.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-foreground">3. How Google and YouTube data is used</h2>
        <p className="mt-3">
          DigestDesk uses Google and YouTube data only after explicit user authorization. The
          user's YouTube subscription list is retrieved to let that user review and select channels
          to import. The full returned list is displayed temporarily in the browser. Selected
          channel identifiers, names, URLs and avatar URLs, and the user's relationship to those
          channels, are stored to track updates and prepare personal digests. Channels you later
          subscribe to on YouTube are not automatically imported.
        </p>
        <p className="mt-3">
          DigestDesk does not sell YouTube data, does not expose one user's YouTube subscription
          list to other users, and does not use YouTube authorization to publish content, manage
          videos, or act on behalf of a user beyond the approved read-only import flow.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-foreground">4. Legal basis and purpose</h2>
        <p className="mt-3">
          We process data to provide the core DigestDesk service requested by the user, maintain
          account security, improve reliability, and comply with legal obligations. Google and
          YouTube data is processed only for the user-facing feature that requires that access.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-foreground">5. Storage and retention</h2>
        <p className="mt-3">
          DigestDesk stores only the minimum data needed to operate the service. Where Google or
          YouTube authorized data is stored, it is retained only as long as necessary for the
          specific user-authorized feature and subject to applicable Google and YouTube API terms.
        </p>
        <p className="mt-3">
          Users may disconnect Google access or request deletion of related authorized data. After a
          valid deletion request, DigestDesk will delete the relevant stored authorized data within
          a commercially reasonable period and in line with applicable API policy requirements.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-foreground">6. Sharing</h2>
        <p className="mt-3">
          We do not sell personal data. We may use infrastructure or service providers acting on our
          behalf to host the application, authenticate users, or store operational data. Clerk
          manages authentication and connected Google authorization; Railway hosts the application
          and database. Content text used for summaries is sent to the configured AI service
          (currently DeepSeek). The Google access token and the returned Google subscription list
          are not included in summary requests. The site also loads third-party assets such as
          channel images and fonts, whose providers receive the associated network requests.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-foreground">7. User choices</h2>
        <p className="mt-3">
          Users may choose whether to authorize YouTube import and may revoke access through
          their Google Account at https://myaccount.google.com/permissions. Revoking access and
          requesting deletion are distinct actions: to request deletion of stored integration
          data, email nexteacc@gmail.com from your account email address. Unsubscribing from a
          channel stops future tracking for that subscription; it does not erase existing digests.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-foreground">8. Security</h2>
        <p className="mt-3">
          We apply reasonable administrative and technical safeguards designed to protect personal
          data against unauthorized access, loss, misuse, or disclosure.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-foreground">9. External terms</h2>
        <p className="mt-3">
          DigestDesk uses YouTube API Services. Review the <a href="https://policies.google.com/privacy" className="text-primary underline underline-offset-4">Google Privacy Policy</a> and manage access on the <a href="https://myaccount.google.com/permissions" className="text-primary underline underline-offset-4">Google Account permissions page</a>.
        </p>
        <p className="mt-3">
          DigestDesk's use and transfer of information received from Google APIs to any other app
          will adhere to the{" "}
          <a
            href="https://developers.google.com/terms/api-services-user-data-policy"
            className="text-primary underline underline-offset-4"
            target="_blank"
            rel="noreferrer"
          >
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
        </p>
        <p className="mt-3">
          Where YouTube data is involved, users should also review the{" "}
          <a
            href="https://www.youtube.com/t/terms"
            className="text-primary underline underline-offset-4"
            target="_blank"
            rel="noreferrer"
          >
            YouTube Terms of Service
          </a>
          .
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-foreground">10. Changes</h2>
        <p className="mt-3">
          We may update this Privacy Policy from time to time. The latest version will be published
          on this page with the effective date shown below.
        </p>
        <p className="mt-3 text-muted-foreground">Effective date: November 3, 2026</p>
      </section>
    </PublicPageLayout>
  );
}
