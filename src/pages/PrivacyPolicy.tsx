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
            href="mailto:nextbigtoy@gmail.com"
            className="text-primary underline underline-offset-4"
          >
            nextbigtoy@gmail.com
          </a>
          .
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-foreground">2. Data we collect</h2>
        <p className="mt-3">
          We collect account and product usage data required to operate DigestDesk. This may include
          account identifiers, feed subscriptions created inside the product, and content metadata
          needed to show a user's reading workflow.
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
          user's YouTube subscription list is used only to help that same user review and import
          channels into DigestDesk. If the Google import feature is disabled in a given
          environment, DigestDesk will not request this access from users in that environment.
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
          behalf to host the application, authenticate users, or store operational data, subject to
          confidentiality and security obligations.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-foreground">7. User choices</h2>
        <p className="mt-3">
          Users may choose whether to connect Google. Users may also revoke DigestDesk access from
          their Google account permissions page and may request deletion of stored data associated
          with the integration.
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
        <p className="mt-3 text-muted-foreground">Effective date: March 27, 2026</p>
      </section>
    </PublicPageLayout>
  );
}
