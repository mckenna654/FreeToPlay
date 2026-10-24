# FreeToPlay — agent instructions

Self-hosted gaming lobby web app plus Discord bot (TypeScript, Express/EJS views, Tailwind, Prisma).
Ships as `ghcr.io/mckenna654/freetoplay` for Unraid/Docker. Global rules: `mckenna654/agent-config`.

## Layout
- `src/index.ts` entry point · `src/web.ts` web routes · `src/bot.ts` Discord bot · `src/views/` EJS
- `prisma/schema.prisma` and `prisma/migrations/`. Change the schema only through a new migration.
- `docs/releases/` release notes · `CHANGELOG.md`
- `.agents/skills`, `.claude/skills`, `.windsurf/skills` hold Prisma reference skills. Leave them alone.

## Commands (Node 24, see `.nvmrc`)
- `npm ci` · `npm run dev` (Tailwind build plus tsx watch) · `npm run build` (tsc plus CSS)
- `npm test` builds first, then runs `node --test tests/*.test.cjs`. Run it before committing.
- Claude cloud sessions have Node 22, not 24. If something needs Node 24, say so; CI and Docker use 24.

## Rules
- Config comes from env vars documented in `.env.example`. A new variable goes into `.env.example`,
  `docker-compose.yml` and the README in the same commit.
- Real Discord/IGDB credentials are never committed or printed. Tests use stubs (`tests/support.cjs`).
- Versioning: bump `package.json`, add a `CHANGELOG.md` entry and a note in `docs/releases/`.
- Commit style: conventional prefixes (`feat:`, `fix:`, `docs:`).
