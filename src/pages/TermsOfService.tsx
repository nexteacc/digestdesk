import PublicPageLayout from "@/components/PublicPageLayout";

export default function TermsOfServicePage() {
  return (
    <PublicPageLayout
      eyebrow="Terms of Service"
      title="Terms of Service"
      description="These terms govern access to and use of DigestDesk, including integrations with third-party services such as Apple, Google, and YouTube."
    >
      <section>
        <h2 className="text-2xl font-semibold text-foreground">1. Acceptance of terms</h2>
        <p className="mt-3">
          By accessing or using DigestDesk, you agree to these Terms of Service and to any
          additional policies referenced here, including the Privacy Policy.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-foreground">2. Service description</h2>
        <p className="mt-3">
          DigestDesk is a personal workflow product operated by an individual developer. It helps
          users organize and review updates from sources such as Substack, Podcast, RSS, and YouTube
          channels. Certain features may rely on third-party services and APIs.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-foreground">3. Accounts and access</h2>
        <p className="mt-3">
          You are responsible for maintaining the security of your account and for activity that
          occurs under your account. You must provide accurate information and use the service in
          compliance with applicable law.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-foreground">4. Google and YouTube integrations</h2>
        <p className="mt-3">
          If you choose to connect Google, you authorize DigestDesk to access only the scopes you
          approve. Where the Google import feature is enabled, DigestDesk requests read-only
          YouTube access solely to let you import your own YouTube subscription list into the
          product.
        </p>
        <p className="mt-3">
          DigestDesk does not acquire ownership of YouTube content or account data. Your use of
          YouTube remains subject to the{" "}
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
        <h2 className="text-2xl font-semibold text-foreground">5. Acceptable use</h2>
        <p className="mt-3">
          You may not use DigestDesk to violate law, infringe rights, interfere with the service,
          scrape or misuse credentials, or attempt unauthorized access to other accounts, systems,
          or data.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-foreground">6. Third-party services</h2>
        <p className="mt-3">
          DigestDesk may depend on third-party services, hosting providers, authentication tools,
          and API platforms. Availability of those services is outside DigestDesk's direct control,
          and features may change if those providers change their terms or capabilities.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-foreground">7. Intellectual property</h2>
        <p className="mt-3">
          DigestDesk and its product materials are owned by their respective rights holders. These
          Terms do not transfer ownership of the service or of third-party content displayed through
          integrations.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-foreground">8. Disclaimer</h2>
        <p className="mt-3">
          DigestDesk is provided on an &quot;as is&quot; and &quot;as available&quot; basis to the
          maximum extent permitted by law. We do not guarantee uninterrupted operation, complete
          accuracy, or fitness for a particular purpose.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-foreground">9. Limitation of liability</h2>
        <p className="mt-3">
          To the maximum extent permitted by law, DigestDesk will not be liable for indirect,
          incidental, special, consequential, or punitive damages, or for loss of data, profits, or
          business opportunities arising from use of the service.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-foreground">10. Termination</h2>
        <p className="mt-3">
          We may suspend or terminate access where necessary to protect the service, comply with
          law, or address misuse. You may stop using the service at any time.
        </p>
      </section>

      <section>
        <h2 className="text-2xl font-semibold text-foreground">11. Changes</h2>
        <p className="mt-3">
          We may update these Terms from time to time. The latest version will be posted on this
          page with the effective date shown below.
        </p>
        <p className="mt-3 text-muted-foreground">Effective date: March 27, 2026</p>
      </section>
    </PublicPageLayout>
  );
}
