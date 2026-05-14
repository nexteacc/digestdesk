# DigestDesk

DigestDesk is a reading workflow app that aggregates Substack, Podcast, RSS, and YouTube updates into a user-specific daily digest.

## Development

- Install dependencies: `pnpm install`
- Start web dev server: `pnpm dev`
- Build all services: `pnpm build`
- Lint: `pnpm lint`

## Services

- `web`: serves the SPA and authenticated API
- `scheduler`: long-running worker that dispatches and runs due digest jobs
- `postgres`: stores global content assets, user state, digests, and digest jobs

## Env Examples

- [`.env.web.example`](.env.web.example)
- [`.env.scheduler.example`](.env.scheduler.example)

## Documentation

- [AI system context and invariants](docs/context.md)
- [Operations and deployment](docs/operations.md)
- [Project history, diagnostics, and decisions](docs/history.md)
- [Agent operating rules](AGENTS.md)

## Deployment

- Zeabur deployment guide: [docs/operations.md](docs/operations.md)

## License

MIT License
