# DigestDesk

DigestDesk is a reading workflow app that aggregates Substack, RSS, and YouTube updates into a user-specific daily digest.

## Runtime

- `web`: serves the SPA and authenticated API
- `scheduler`: long-running worker that dispatches and runs due digest jobs
- `postgres`: stores global content assets, user state, digests, and digest jobs

## Production Shape

- One shared `feeds` / `articles` asset layer
- One user-private `subscriptions` / `digests` / `user_settings` layer
- One `digest_jobs` task layer for scheduling, retries, and observability
- No in-process scheduler inside the web server; scheduling runs in a separate service

## Deployment

- Zeabur deployment guide: [docs/ZEABUR_DEPLOYMENT.md](/Volumes/Sheng/AIcases/digestdesk/docs/ZEABUR_DEPLOYMENT.md)
- `scheduler` service should keep Root Directory at `/` and set app dir to `server`

## License

MIT License
