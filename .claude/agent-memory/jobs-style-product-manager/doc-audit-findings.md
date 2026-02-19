# Doc System Audit - Detailed Findings (2026-02-19)

## Duplication Map (same info repeated across docs)

### "Jina Reader + Turndown two-layer strategy"
- Implementation Plan section 0.2
- Rules.md "内容抓取策略"
- Tasks.md T0.3
Total: 3 places, nearly identical wording

### "Vercel AI SDK + Zod schema + Gemini Flash"
- Master Plan "技术基础"
- Implementation Plan Phase 1
- Rules.md "AI 摘要规范"
- Tasks.md T1.1
Total: 4 places

### "Substack search endpoint"
- Implementation Plan section 0.4
- Rules.md "Substack 数据获取"
- Tasks.md T0.7
- User Journeys J7
Total: 4 places

## Docs vs Code Mismatches
- Docs say `Home.tsx` -- no such file exists
- Docs say `Digest.tsx` -- actual files are `DailyDigest.tsx` + `WeeklyDigest.tsx`
- Docs say pages: Home, Subscriptions, Digest -- actual: DailyDigest, WeeklyDigest, Subscriptions
- Docs don't mention `/weekly` route
- Rules.md "关键文件" table lists non-existent files
- User Journeys reference `src/lib/demoDigest.ts` -- may be deleted

## Recommended Doc Architecture
1. **Master Plan**: Why, Who, What, positioning, vision, metrics ONLY
2. **Implementation Plan + Tasks (merged)**: Tech architecture + task breakdown in one place
3. **Design Guidelines**: Keep as-is (best doc)
4. **Rules.md**: Code conventions, file org, AI behavior rules ONLY (no product/tech duplication)
5. **User Journeys**: Merge J4+J7, add error/failure journeys
6. **NEW: Error States Map**: All failure scenarios with UX responses

## MVP Scope Corrections Recommended
- PULL IN: Minimal onboarding (empty state -> paste URL -> auto-generate)
- PULL IN: Compression value display ("为你读了 N 篇, 约 X 字")
- DEFER: Weekly digest (move to post-MVP iteration 1)
- DEFER: Search-add (T0.7) -- URL paste sufficient for first users
- ENSURE: Basic mobile readability for digest page
