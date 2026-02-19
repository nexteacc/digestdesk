# DigestDesk Multi-Source Expansion Strategy

## Detailed technical and product notes for each wave

### Wave 1: Generalize RSS

**Files that need changes:**
- `server/src/routes/feeds.ts`: Lines 49-50 hardcode `feedUrl = publicationUrl + "/feed"`. Need RSS auto-discovery.
- `server/src/routes/substack.ts`: Keep as a discovery provider, not the only path.
- `shared/types.ts`: Rename `SubstackSearchResult` -> `SourceSearchResult`, add sourceType to Feed.
- `server/src/db/schema.ts`: Add `sourceType` column to feeds table, `contentType` to articles.
- `src/pages/Subscriptions.tsx`: Add "paste any RSS URL" as primary subscription method.

**RSS Auto-Discovery Algorithm:**
1. User pastes a URL
2. Try fetching URL, check for `<link rel="alternate" type="application/rss+xml" href="...">` in HTML
3. If found, use that as feedUrl
4. If URL ends in `/feed` or `/rss`, try parsing directly as RSS
5. Try common RSS path conventions: `/feed`, `/rss`, `/feed.xml`, `/atom.xml`, `/index.xml`
6. If all fail, try Substack convention (append `/feed`)
7. If all fail, report "could not find RSS feed for this URL"

### Wave 2: YouTube

**API Requirements:**
- YouTube Data API v3
- Endpoint: `channels.list` (get channel info), `search.list` (get uploads)
- Quota: 10,000 units/day free. `search.list` costs 100 units per call.
- That means ~100 channel syncs per day on free tier. Sufficient for single-user.

**Transcript Extraction Options:**
1. `youtube-transcript` npm package (scrapes, no API key needed, but fragile)
2. YouTube API `captions.list` + `captions.download` (official but complex)
3. Supadata or similar third-party transcript API
4. OpenAI Whisper as fallback (expensive, slow)

**Data Model for YouTube:**
- `feeds.sourceType = 'youtube'`
- `feeds.feedUrl` = YouTube channel URL or channel ID
- `articles.contentType = 'video'`
- `articles.contentText` = transcript markdown
- `articles.durationSeconds` = video length
- `articles.coverImageUrl` = thumbnail

### Wave 3: Podcasts

**Podcast RSS is already standard RSS!**
- Most podcast directories (Apple, Spotify) use RSS feeds
- The RSS `<enclosure>` tag contains the audio URL
- Podcast RSS feeds are well-structured and reliable

**Transcription Pipeline:**
1. Download audio from enclosure URL
2. Send to OpenAI Whisper API or Deepgram
3. Get transcript text
4. Convert to Markdown
5. Feed through standard summarizer

**Cost Estimates:**
- Whisper API: $0.006/min. 1-hour episode = $0.36
- If user follows 10 podcasts, 5 episodes/week avg = $18/month in transcription costs
- This is significant -- may need to be selective about which episodes to transcribe

### Wave 4 (Deferred/Possibly Cut): Twitter/Reddit

**Why this might not be worth doing:**
- Twitter API: $100/month for basic access, unpredictable pricing changes
- Reddit API: Free tier exists but rate-limited, ToS concerns
- Short-form content has fundamentally different summarization needs
- Low compression ratio -- tweets are already short
- The real value would be "theme detection across a Twitter list" not "summarize individual tweets"
- If pursued, would need a different summarization strategy entirely

## Cross-Source Synthesis Architecture

The `weeklyThemes` feature becomes exponentially more valuable with multiple sources. The AI prompt needs to be updated to explicitly look for cross-source connections:

"You have summaries from Substack articles, YouTube videos, and podcast episodes. Your tasks:
1. Identify themes that appear across DIFFERENT source types
2. Note when different sources present contrasting views on the same topic
3. Highlight unique insights that only appeared in one source type"

This is the defensible moat. This is what no other product does.
