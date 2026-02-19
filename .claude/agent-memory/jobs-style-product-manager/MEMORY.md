# DigestDesk - Product Analysis Memory

## Product Identity (UPDATED 2026-02-19)
- **Name**: DigestDesk ("你的个人编辑助手")
- **Vision**: Multi-source personal intelligence briefing system
- **Core Value Prop**: Compress multi-platform content subscriptions into a 5-min daily briefing
- **Positioning**: "Personal intelligence briefing" -- the only product where FINISHING is the goal
- **Deepest Insight**: Product is a "publication with rhythm", not a tool you open anytime
- **Key Differentiator**: Cross-source synthesis (themes across Substack + YouTube + Podcast)
- **Target Users**: Chinese knowledge workers (PMs, founders, investors, devs) with 3+ subscriptions
- **Stage**: MVP/prototype, v0.0.0. Core Substack pipeline works.

## Architecture & Code Reality (UPDATED 2026-02-19)
- **Frontend**: React 19 + Vite + TypeScript + Tailwind 4 + shadcn/ui + wouter (hash routing)
- **Backend**: Express 5 + SQLite (Drizzle ORM) + Vercel AI SDK (Gemini 2.5 Flash default)
- **Content Pipeline**: RSS -> Jina Reader (Markdown) -> Turndown fallback -> AI summary (Zod schema)
- **Design Language**: Swiss Modernism x Newspaper Editorial
- **Actual Pages**: DailyDigest.tsx, WeeklyDigest.tsx, Subscriptions.tsx, NotFound.tsx (NO Home.tsx)
- **Actual Routes**: `/` (daily), `/weekly`, `/subscriptions`
- **DOCS-CODE MISMATCH**: Docs reference Home.tsx and Digest.tsx but code has DailyDigest/WeeklyDigest

## Critical Architecture Insights for Multi-Source
- `summarizer.ts` is already source-agnostic (takes Markdown, outputs structured summary)
- `rss.ts` syncFeed() is nearly source-agnostic but `feeds.ts` route hardcodes Substack `/feed` URL
- DB schema lacks `sourceType` on feeds and `contentType` on articles/digestItems
- Need a Source Provider interface pattern for pluggable sources
- See `multi-source-strategy.md` for detailed expansion plan

## Key Product Decisions
- Single-user mode (no auth) for MVP -- correct
- Manual trigger for digest generation -- correct for now
- Chinese UI language
- No in-app reader/player -- INTENTIONAL, never add this
- No separate tabs per source type -- one unified briefing
- No recommendation algorithm -- user IS the algorithm via their subscriptions
- RSS-first data strategy (official, stable)

## Doc System Audit (2026-02-19) -- see `doc-audit-findings.md`
- 6 docs: Master Plan, Implementation Plan, Design Guidelines, Rules, User Journeys, Tasks
- **Critical**: Massive info duplication across docs (same tech details in 3-4 places)
- **Critical**: Docs out of sync with actual code (file names, routes, page structure)
- **Missing**: Error States Map, compression value visualization, minimal onboarding
- **Best Doc**: Design Guidelines (Swiss Modernism + Newspaper editorial, excellent taste)
- **Score**: 7.1/10 overall

## Top 5 Doc Improvement Priorities
1. Restructure docs to eliminate redundancy (Single Source of Truth principle)
2. Pull minimal onboarding into MVP (empty state -> paste URL -> auto-generate)
3. Add "compression value" display to daily digest header
4. Create Error States Map (RSS fail, AI timeout, no content, invalid URL, API key issues)
5. Sync docs with actual code state (file names, routes, components)

## Expansion Priority (decided 2026-02-16)
1. Wave 1: Generalize RSS beyond Substack (ANY RSS feed)
2. Wave 2: YouTube channels (YouTube API + transcript extraction)
3. Wave 3: Podcasts (RSS + Whisper transcription)
4. Wave 4: Twitter/Reddit -- LOW priority, possibly cut

## Competitive Position
- Gap between Feedly (personalized+manual) and Perplexity (automated+generic)
- DigestDesk uniquely sits at personalized+automated intersection
- Moat: multi-source ingestion infra, cross-source synthesis quality, habit formation

## Known Issues (UPDATED 2026-02-19)
- Docs reference Digest.tsx but code has DailyDigest.tsx + WeeklyDigest.tsx
- Docs reference Home.tsx but no such file exists
- Weekly generation depends on daily digests first (coupling)
- No "time saved" metric (critical for retention)
- No onboarding flow
- ~50 unused Radix UI packages in package.json
