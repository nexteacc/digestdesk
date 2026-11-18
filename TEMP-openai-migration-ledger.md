# OpenAI API migration ledger

## Scope and decision receipt

2026-11-18: User approved implementing the recommended Responses route with
`gpt-6-luna` primary and `gpt-6.2-sol` retry, leaving the existing API key and
Railway production changes to the user. One approved stage: code, tests and
operator instructions in an isolated branch. No deployment is authorized here.

## Assessment

| Guidance | Applicability and decision | Evidence / implementation |
|---|---|---|
| Model selection | Luna for frequent article summaries; Sol for failed validation | Official model pages; user accepted recommendation |
| Instruction files | Preserve | Existing AGENTS.md unchanged |
| Chat to Responses | Implemented for official OpenAI origin | `createOpenAI().responses()`; other origins retain compatible chat provider |
| Required workflows | Shared route covers manual, scheduled and background article summaries | `presummarize.ts` and digest use `summarizer.ts`; no route/job changes |
| Framework tradeoff | Retain AI SDK instead of adding another client | Existing @ai-sdk/openai 3.0.30, ai 6; version-matched bundled docs/source verified; no dependency changes |
| Streaming | Not applicable | Whole JSON required before validation/cache; existing buffered behavior retained |
| WebSocket | Not applicable | Independent single requests, no tool loops |
| Privacy / ZDR | Stateless requests; ZDR not established | `store: false`; does not change abuse-monitoring or account policies |
| Residency | No new regional setting | Existing official endpoint selected by operator; no jurisdiction requirements supplied |
| Processing tiers | Preserve standard requests for all callers | Scheduled and interactive calls share synchronous executor; no Flex delays, Batch job lifecycle or paid Priority introduced |
| Prompt cache keys | Omit new keys for GPT-6 | No prior cache keys |
| Extended retention | Not applicable | No earlier-model retention changes |
| Explicit breakpoints | Unsupported by pinned provider interface | Installed responses options expose promptCacheKey/Retention, not content cache breakpoints; no SDK upgrade in this stage |
| Cache diagnostics | Unsupported by pinned provider interface | No prompt_cache_options comparison-response pass-through; independent jobs do not keep response IDs |
| State and instruction persistence | No chaining/replay needed | Each article sends complete existing system prompt and article input |
| Encrypted reasoning / preservation | Not applicable | No continuation or tool turns |
| Reasoning effort | Luna none; Sol low | Preserve direct summary behavior for primary; Sol rejects none; pinned SDK forceReasoning required to serialize GPT-6 reasoning |
| Reasoning summaries / preambles | Not applicable | Product displays only validated summary |
| Verbosity | Low for GPT-6 | Existing short summary instructions and limits retained |
| Output tokens | Preserve configured budget; Sol floor 4096 | Sol budget includes reasoning; incomplete responses rejected |
| Assistant phases | Not applicable | No assistant replay or intermediate UI |
| Context compaction | Not applicable | Single bounded article per request; existing input trimming retained |
| Structured outputs | Implemented | Output.object with existing language schema; normalizeSummary unchanged |
| Tools / choice / search / parallel / programmatic / model-aligned interfaces | Not applicable | Summary generation has no tools; no tool orchestration introduced |
| Application caching | Preserve | Existing article/language caches and metadata unchanged; cached content not regenerated |
| Errors and observability | Preserve retry categories, add route/token logging | Validation/incomplete output retry; auth failures do not retry; SDK automatic retries disabled |

## Validation

- Backend full suite: 9 files, 60 tests passed, including 5 new real-provider
  serialization tests with mocked HTTP: Responses strict schema/storage/effort,
  validation retry, incomplete retry, authentication failure, retained DeepSeek route.
- Frontend full suite: 3 files, 19 tests passed.
- Backend TypeScript check: `node node_modules/typescript/bin/tsc -p server/tsconfig.build.json --noEmit` passed.
- ESLint: `node node_modules/eslint/bin/eslint.js .` passed.
- Tests use the repository Vitest binaries directly because the environment's
  pnpm wrapper attempted automatic setup in an unwritable home directory.
- No real API requests or production end-to-end checks: operator retains key
  setup. Model availability, 30-article multilingual quality/cost comparison,
  Railway redeploy, and scheduled/manual cache-miss flows remain live checks.

## Sources

- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/models/gpt-6.2-sol
- https://developers.openai.com/api/docs/guides/migrate-to-responses
- Installed `@ai-sdk/openai/src/responses` and `ai/docs/03-ai-sdk-core/10-generating-structured-data.mdx`.

## Outcome

Code stage implemented; operator deployment and live verification remain.
No further code stages approved. Advanced caching requires a separately
reviewed SDK upgrade; no migration of non-OpenAI providers is proposed.
