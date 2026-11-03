import "dotenv/config";
import express from "express";
import cors from "cors";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { clerkMiddleware, requireAuth } from "@clerk/express";
import { feedsRouter } from "./routes/feeds.js";
import { digestsRouter } from "./routes/digests.js";
import { substackRouter } from "./routes/substack.js";
import { rssFeedsRouter } from "./routes/rss-feeds.js";
import { youtubeFeedsRouter } from "./routes/youtube-feeds.js";
import { podcastFeedsRouter } from "./routes/podcast-feeds.js";
import { settingsRouter } from "./routes/settings.js";
import { authRouter } from "./routes/auth.js";
import { adminRouter } from "./routes/admin.js";
import { resolveUser } from "./middleware/resolve-user.js";
import { getDb, initDb } from "./db/index.js";
import { eq, ne, desc, and, isNull, or, ilike } from "drizzle-orm";
import { digests, digestItems, feeds, subscriptions, users } from "./db/schema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
const PORT = process.env.PORT || 8080;
const isNonEmptyString = (value: string | undefined): value is string => Boolean(value);
const APP_URL = process.env.APP_URL?.trim();
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(isNonEmptyString);
const allowedOrigins = new Set([APP_URL, ...CORS_ALLOWED_ORIGINS].filter(isNonEmptyString));
const allowedOriginList = Array.from(allowedOrigins);

if (allowedOriginList.length > 0) {
  app.use(
    cors({
      origin: allowedOriginList,
      credentials: true,
    }),
  );
} else if (process.env.NODE_ENV !== "production") {
  app.use(
    cors({
      origin: true,
      credentials: true,
    }),
  );
}
app.use(express.json());
app.use(clerkMiddleware());

app.get("/api/public/digest", async (_req, res) => {
  const publisher = process.env.PUBLIC_DIGEST_USER_ID?.trim();
  if (!publisher) {
    res.json({ digests: [], currentDigest: null, feeds: [] });
    return;
  }

  const db = getDb();
  const publisherRows = await db
    .select({ id: users.id })
    .from(users)
    .where(or(eq(users.id, publisher), eq(users.name, publisher), ilike(users.email, `${publisher}@%`)))
    .limit(2);

  if (publisherRows.length !== 1) {
    res.json({ digests: [], currentDigest: null, feeds: [] });
    return;
  }

  const userId = publisherRows[0].id;
  const [digest] = await db
    .select()
    .from(digests)
    .where(and(eq(digests.userId, userId), eq(digests.type, "daily")))
    .orderBy(desc(digests.date))
    .limit(1);

  if (!digest) {
    res.json({ digests: [], currentDigest: null, feeds: [] });
    return;
  }

  const [itemRows, feedRows] = await Promise.all([
    db.select().from(digestItems).where(and(eq(digestItems.digestId, digest.id), ne(digestItems.sourceType, "youtube"))).orderBy(digestItems.sortOrder),
    db
      .select({ feed: feeds })
      .from(subscriptions)
      .innerJoin(feeds, eq(subscriptions.feedId, feeds.id))
      .where(and(eq(subscriptions.userId, userId), isNull(subscriptions.endedAt), ne(feeds.sourceType, "youtube"))),
  ]);

  res.json({
    digests: [{ id: digest.id, type: digest.type, date: digest.date, generatedAt: digest.generatedAt }],
    currentDigest: {
      id: digest.id,
      type: digest.type,
      date: digest.date,
      generatedAt: digest.generatedAt,
      items: itemRows.map((row) => ({
        id: row.id,
        feedId: row.feedId ?? undefined,
        sourceType: row.sourceType,
        feedTitle: row.feedName,
        title: row.articleTitle,
        author: row.author ?? undefined,
        url: row.url,
        oneLiner: row.oneLiner,
        keyInsights: JSON.parse(row.keyInsights),
        publishedAt: row.publishedAt,
      })),
    },
    feeds: feedRows.map(({ feed }) => ({
      id: feed.id,
      title: feed.name,
      description: feed.description ?? undefined,
      logoUrl: feed.logoUrl ?? undefined,
      authorName: feed.authorName ?? undefined,
      url: feed.publicationUrl,
      feedUrl: feed.feedUrl,
      sourceType: feed.sourceType,
      lastFetchedAt: feed.lastFetchedAt ?? undefined,
      createdAt: feed.createdAt,
    })),
  });
});

let ready = false;
let initError: string | null = null;

app.use("/api/auth", requireAuth(), authRouter);
app.use("/api/admin", requireAuth(), adminRouter);
app.use("/api/feeds", requireAuth(), resolveUser, feedsRouter);
app.use("/api/digests", requireAuth(), resolveUser, digestsRouter);
app.use("/api/substack", requireAuth(), resolveUser, substackRouter);
app.use("/api/rss-feeds", requireAuth(), resolveUser, rssFeedsRouter);
app.use("/api/youtube-feeds", requireAuth(), resolveUser, youtubeFeedsRouter);
app.use("/api/podcast-feeds", requireAuth(), resolveUser, podcastFeedsRouter);
app.use("/api/settings", requireAuth(), resolveUser, settingsRouter);

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.get("/api/ready", (_req, res) => {
  if (ready) {
    res.json({ status: "ready", timestamp: new Date().toISOString() });
    return;
  }
  res.status(503).json({
    status: "starting",
    timestamp: new Date().toISOString(),
    error: initError ?? undefined,
  });
});

const renderPublicHome = (isZh: boolean) => {
  const text = (zh: string, en: string) => isZh ? zh : en;
  return `
  <div class="min-h-screen paper-noise flex flex-col">
    <header class="hairline public-home-header">
      <div class="w-full px-4 md:px-6 lg:px-8">
        <div class="flex items-center justify-between gap-4">
          <div class="flex items-center gap-3">
            <h1 class="text-2xl font-semibold leading-none md:text-3xl">DigestDesk</h1>
          </div>
          <nav aria-label="${text("法律信息", "Legal information")}">
            <a href="https://digestdesk.news/privacy">${text("隐私政策", "Privacy policy")}</a>
            <a href="https://digestdesk.news/terms">${text("服务条款", "Terms of service")}</a>
          </nav>
        </div>
      </div>
    </header>
    <main id="main-content" class="flex-1">
      <div class="w-full px-4 md:px-6 lg:px-8">
        <section class="public-home-hero">
          <h2>${text("你的每日编辑", "Your daily editor")}</h2>
          <p class="public-home-description">${text("追踪你关心的创作者，每天编辑一份专属日报。", "Follow the creators you care about. Get a daily digest made for you.")}</p>
          <p>
            ${text("DigestDesk 将 Substack、播客、RSS 和 YouTube 的更新整理成一份个人日报。", "DigestDesk is a personal reading workflow application that aggregates updates from Substack newsletters, Podcasts, RSS feeds, and YouTube channels into a structured daily reading digest.")}
          </p>
          <p>
            ${text("你可以直接订阅公开内容源，也可以选择连接 Google 账户，仅授予 YouTube 只读权限，用于查看并导入自己的频道订阅。DigestDesk 遵循 Google API 服务用户数据政策，包括受限使用要求。", "Users can subscribe to public feeds directly or optionally connect their Google account with read-only YouTube access solely to view and import their own YouTube channel subscriptions into DigestDesk. DigestDesk complies with the Google API Services User Data Policy, including the Limited Use requirements.")}
          </p>
          <div class="public-home-actions">
            <a href="/#/sign-in">${text("登录", "Sign in")}</a>
          </div>
        </section>
      </div>
    </main>
    <footer class="hairline">
      <div>
        <p>${text("用 DigestDesk 整理 Substack、播客、RSS 和 YouTube 更新。", "DigestDesk helps users organize Substack, Podcast, RSS, and YouTube updates into one personal workflow.")}</p>
        <a href="https://digestdesk.news/privacy">${text("隐私政策", "Privacy policy")}</a>
        <a href="https://digestdesk.news/terms">${text("服务条款", "Terms of service")}</a>
      </div>
    </footer>
  </div>
`;
};

const PRIVACY_STATIC_HTML = `
  <div class="min-h-screen paper-noise flex flex-col">
    <header class="hairline">
      <div>
        <p>DigestDesk</p>
        <h1>Privacy Policy</h1>
        <a href="https://digestdesk.news/">Home</a>
      </div>
    </header>
    <main id="main-content" class="flex-1">
      <p>This policy describes how DigestDesk collects, uses, stores, and deletes personal data, including data accessed through Apple, Google, and YouTube integrations.</p>
      <section>
        <h2>1. Controller and contact</h2>
        <p>DigestDesk is operated by an individual developer. If you have privacy questions or deletion requests, contact the operator at <a href="mailto:nextbigtoy@gmail.com">nextbigtoy@gmail.com</a>.</p>
      </section>
      <section>
        <h2>2. Data we collect</h2>
        <p>We collect account and product usage data required to operate DigestDesk. This may include account identifiers, feed subscriptions created inside the product, and content metadata needed to show a user's reading workflow.</p>
        <p>If a user chooses to connect Google, and if the integration is enabled for that environment, DigestDesk may request read-only access to the user's YouTube subscription list through the YouTube Data API scope <code>https://www.googleapis.com/auth/youtube.readonly</code>.</p>
      </section>
      <section>
        <h2>3. How Google and YouTube data is used</h2>
        <p>DigestDesk uses Google and YouTube data only after explicit user authorization. The user's YouTube subscription list is used only to help that same user review and import channels into DigestDesk. If the Google import feature is disabled in a given environment, DigestDesk will not request this access from users in that environment.</p>
        <p>DigestDesk does not sell YouTube data, does not expose one user's YouTube subscription list to other users, and does not use YouTube authorization to publish content, manage videos, or act on behalf of a user beyond the approved read-only import flow.</p>
      </section>
      <section>
        <h2>4. Legal basis and purpose</h2>
        <p>We process data to provide the core DigestDesk service requested by the user, maintain account security, improve reliability, and comply with legal obligations. Google and YouTube data is processed only for the user-facing feature that requires that access.</p>
      </section>
      <section>
        <h2>5. Storage and retention</h2>
        <p>DigestDesk stores only the minimum data needed to operate the service. Where Google or YouTube authorized data is stored, it is retained only as long as necessary for the specific user-authorized feature and subject to applicable Google and YouTube API terms.</p>
        <p>Users may disconnect Google access or request deletion of related authorized data. After a valid deletion request, DigestDesk will delete the relevant stored authorized data within a commercially reasonable period and in line with applicable API policy requirements.</p>
      </section>
      <section>
        <h2>6. Sharing</h2>
        <p>We do not sell personal data. We may use infrastructure or service providers acting on our behalf to host the application, authenticate users, or store operational data, subject to confidentiality and security obligations.</p>
      </section>
      <section>
        <h2>7. User choices</h2>
        <p>Users may choose whether to connect Google. Users may also revoke DigestDesk access from their Google account permissions page and may request deletion of stored data associated with the integration.</p>
      </section>
      <section>
        <h2>8. Security</h2>
        <p>We apply reasonable administrative and technical safeguards designed to protect personal data against unauthorized access, loss, misuse, or disclosure.</p>
      </section>
      <section>
        <h2>9. External terms</h2>
        <p>DigestDesk's use and transfer of information received from Google APIs to any other app will adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>, including the Limited Use requirements.</p>
        <p>Where YouTube data is involved, users should also review the <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>.</p>
      </section>
      <section>
        <h2>10. Updates</h2>
        <p>We may update this Privacy Policy from time to time. The latest version will be posted on this page with the effective date shown below.</p>
        <p>Effective date: March 27, 2026</p>
      </section>
    </main>
    <footer class="hairline">
      <a href="https://digestdesk.news/">Home</a>
      <a href="https://digestdesk.news/privacy">Privacy Policy</a>
      <a href="https://digestdesk.news/terms">Terms of Service</a>
    </footer>
  </div>
`;

const TERMS_STATIC_HTML = `
  <div class="min-h-screen paper-noise flex flex-col">
    <header class="hairline">
      <div>
        <p>DigestDesk</p>
        <h1>Terms of Service</h1>
        <a href="https://digestdesk.news/">Home</a>
      </div>
    </header>
    <main id="main-content" class="flex-1">
      <p>These terms govern access to and use of DigestDesk, including integrations with third-party services such as Apple, Google, and YouTube.</p>
      <section>
        <h2>1. Acceptance of terms</h2>
        <p>By accessing or using DigestDesk, you agree to these Terms of Service and to any additional policies referenced here, including the Privacy Policy.</p>
      </section>
      <section>
        <h2>2. Service description</h2>
        <p>DigestDesk is a personal workflow product operated by an individual developer. It helps users organize and review updates from sources such as Substack, Podcast, RSS, and YouTube channels. Certain features may rely on third-party services and APIs.</p>
      </section>
      <section>
        <h2>3. Accounts and access</h2>
        <p>You are responsible for maintaining the security of your account and for activity that occurs under your account. You must provide accurate information and use the service in compliance with applicable law.</p>
      </section>
      <section>
        <h2>4. Google and YouTube integrations</h2>
        <p>If you choose to connect Google, you authorize DigestDesk to access only the scopes you approve. Where the Google import feature is enabled, DigestDesk requests read-only YouTube access solely to let you import your own YouTube subscription list into the product.</p>
        <p>DigestDesk does not acquire ownership of YouTube content or account data. Your use of YouTube remains subject to the <a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>.</p>
      </section>
      <section>
        <h2>5. Acceptable use</h2>
        <p>You may not use DigestDesk to violate law, infringe rights, interfere with the service, scrape or misuse credentials, or attempt unauthorized access to other accounts, systems, or data.</p>
      </section>
      <section>
        <h2>6. Third-party services</h2>
        <p>DigestDesk may depend on third-party services, hosting providers, authentication tools, and API platforms. Availability of those services is outside DigestDesk's direct control, and features may change if those providers change their terms or capabilities.</p>
      </section>
      <section>
        <h2>7. Intellectual property</h2>
        <p>DigestDesk and its product materials are owned by their respective rights holders. These Terms do not transfer ownership of the service or of third-party content displayed through integrations.</p>
      </section>
      <section>
        <h2>8. Disclaimer</h2>
        <p>DigestDesk is provided on an "as is" and "as available" basis to the maximum extent permitted by law. We do not guarantee uninterrupted operation, complete accuracy, or fitness for a particular purpose.</p>
      </section>
      <section>
        <h2>9. Limitation of liability</h2>
        <p>To the maximum extent permitted by law, DigestDesk will not be liable for indirect, incidental, special, consequential, or punitive damages, or for loss of data, profits, or business opportunities arising from use of the service.</p>
      </section>
      <section>
        <h2>10. Termination</h2>
        <p>We may suspend or terminate access where necessary to protect the service, comply with law, or address misuse. You may stop using the service at any time.</p>
      </section>
      <section>
        <h2>11. Changes</h2>
        <p>We may update these Terms from time to time. The latest version will be posted on this page with the effective date shown below.</p>
        <p>Effective date: March 27, 2026</p>
      </section>
    </main>
    <footer class="hairline">
      <a href="https://digestdesk.news/">Home</a>
      <a href="https://digestdesk.news/privacy">Privacy Policy</a>
      <a href="https://digestdesk.news/terms">Terms of Service</a>
    </footer>
  </div>
`;

const frontendDist = path.resolve(__dirname, "../../dist");
if (fs.existsSync(frontendDist)) {
  const indexHtmlPath = path.join(frontendDist, "index.html");
  const baseIndexHtml = fs.existsSync(indexHtmlPath) ? fs.readFileSync(indexHtmlPath, "utf8") : "";

  app.use(express.static(frontendDist, { index: false }));
  app.get("/{*path}", (req, res) => {
    if (!baseIndexHtml) {
      res.sendFile(indexHtmlPath);
      return;
    }

    const normalizedPath = req.path.replace(/\/+$/, "") || "/";
    const savedLocale = req.headers.cookie?.match(/(?:^|;\s*)digestdesk-locale=(zh|en)(?:;|$)/)?.[1];
    const preferredLocale = savedLocale ?? req.acceptsLanguages("zh", "en");
    const isZh = preferredLocale === "zh";
    res.vary("Cookie");
    res.vary("Accept-Language");
    res.setHeader("Cache-Control", "private, no-cache");
    let title = isZh ? "DigestDesk — 你的每日编辑" : "DigestDesk — Your daily editor";
    let description = isZh
      ? "DigestDesk 将 Substack、播客、RSS 和 YouTube 的重要更新整理成一份个人日报。"
      : "DigestDesk brings Substack, podcasts, RSS, and YouTube updates into your personal daily digest.";
    let canonicalUrl = "https://digestdesk.news/";
    let rootContent = renderPublicHome(isZh);

    if (normalizedPath === "/privacy") {
      title = "Privacy Policy — DigestDesk";
      description =
        "Learn how DigestDesk collects, uses, stores, and deletes personal data, including Google and YouTube read-only subscription import.";
      canonicalUrl = "https://digestdesk.news/privacy";
      rootContent = PRIVACY_STATIC_HTML;
    } else if (normalizedPath === "/terms") {
      title = "Terms of Service — DigestDesk";
      description =
        "Read the Terms of Service governing access to and use of DigestDesk, including third-party integrations.";
      canonicalUrl = "https://digestdesk.news/terms";
      rootContent = TERMS_STATIC_HTML;
    } else if (normalizedPath !== "/") {
      rootContent = "";
    }

    const documentLocale = normalizedPath === "/privacy" || normalizedPath === "/terms" ? "en" : isZh ? "zh-CN" : "en";
    const renderedHtml = baseIndexHtml
      .replace(/<html lang="[^"]*">/, `<html lang="${documentLocale}" data-locale="${isZh ? "zh" : "en"}">`)
      .replace(/<title>.*?<\/title>/, `<title>${title}</title>`)
      .replace(/<meta name="description" content=".*?" \/>/, `<meta name="description" content="${description}" />`)
      .replace(/<meta property="og:title" content=".*?" \/>/, `<meta property="og:title" content="${title}" />`)
      .replace(
        /<meta property="og:description" content=".*?" \/>/,
        `<meta property="og:description" content="${description}" />`,
      )
      .replace(/<meta property="og:url" content=".*?" \/>/, `<meta property="og:url" content="${canonicalUrl}" />`)
      .replace(/<link rel="canonical" href=".*?" \/>/, `<link rel="canonical" href="${canonicalUrl}" />`)
      .replace('<div id="root"></div>', `<div id="root">${rootContent}</div>`);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderedHtml);
  });
}

const startServer = async () => {
  try {
    console.log("Starting initialization...");
    await initDb();
    console.log("Database initialized.");
    ready = true;

    app.listen(Number(PORT), "0.0.0.0", () => {
      console.log(`Server running on http://0.0.0.0:${PORT}`);
    });
  } catch (err) {
    initError = err instanceof Error ? err.message : String(err);
    console.error("Fatal: Initialization failed:", err);
  }
};

startServer();
