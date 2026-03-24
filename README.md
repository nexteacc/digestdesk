# DigestDesk

DigestDesk is a reading workflow app that aggregates Substack, RSS, and YouTube updates into a user-specific daily digest.

## Runtime

- `web`: serves the SPA and authenticated API
- `postgres`: stores global content assets, user state, digests, and digest jobs
- `dispatch-digest-jobs`: external cron entry that creates due daily digest jobs
- `run-digest-jobs`: external cron entry that claims and executes pending digest jobs

## Production Shape

- One shared `feeds` / `articles` asset layer
- One user-private `subscriptions` / `digests` / `user_settings` layer
- One `digest_jobs` task layer for scheduling, retries, and observability
- No in-process cron inside the web server

## License

MIT License
