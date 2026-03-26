# DigestDesk

DigestDesk is a reading workflow app that aggregates Substack, RSS, and YouTube updates into a user-specific daily digest.

## Services

- `web`: serves the SPA and authenticated API
- `scheduler`: long-running worker that dispatches and runs due digest jobs
- `postgres`: stores global content assets, user state, digests, and digest jobs

## Env Examples

- [`.env.web.example`](/Volumes/Sheng/AIcases/digestdesk/.env.web.example)
- [`.env.scheduler.example`](/Volumes/Sheng/AIcases/digestdesk/.env.scheduler.example)

## Deployment

- Zeabur deployment guide: [docs/ZEABUR_DEPLOYMENT.md](/Volumes/Sheng/AIcases/digestdesk/docs/ZEABUR_DEPLOYMENT.md)

## License

MIT License
