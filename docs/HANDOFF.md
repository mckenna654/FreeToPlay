# Handoff

## 2026-11-05: Login secret and saved logins (v1.8.1)

**Changed (branch `claude/secure-login-sessions`)**
- `SESSION_SECRET` no longer falls back to a hard-coded value. If it is empty or a public example value, the
  app generates a random secret and saves it as `session-secret` next to the database.
- Logins are saved in `sessions.db` next to the database, using the existing `better-sqlite3` package through
  `src/session-store.ts`. No new dependency, and no Prisma migration because it is a separate file.
- Bumped to 1.8.1 so merging does not overwrite the `v1.8.0` image.

**Checked (Node 24.13 on the Mac)**
- `npm ci`, `npx prisma generate` and `npm test` pass.
- The tests start the real app with no secret, restart it, stay signed in, and reject a cookie forged with
  `super-secret`. These end-to-end tests fail against the old session setup.

**Not checked**
- No Docker image was built, because Docker was not running. Nothing was tested on Linux or on Unraid.
- A real Discord sign-in needs real credentials. The tests use a saved login instead.

**Next step**
Jake decides on the merge. After merging, check on Unraid that `session-secret` and `sessions.db` appear in
`/mnt/user/appdata/freetoplay/data/`, and that a sign-in survives a container restart.

## 2026-11-05: Lobby redesign (branch `claude/unslop-ui`)

**Changed**
- Rewrote `src/styles/app.css` and all views: graphite surfaces, lime as the only accent, Bricolage Grotesque and
  IBM Plex Mono bundled in `public/fonts/`, Lucide icons in `src/views/partials/icon.ejs`.
- The hero now shows the real next session as a ticket. The queue below lists the next three after it, so the
  upcoming query takes 4 and includes each RSVP's user.
- Seat markers (`partials/seats.ejs`) replace the capacity bar and `2/4 going`. Lists over 12 seats show text only.
- Games without a cover get a colour from `artIndex`, repeated in `public/app.js` for the live form preview.
- Removed `public/lobby-art.webp`, `docs/lobby-art.md`, the top bar and the sidebar slogan block.
- Regenerated the README screenshots, except `docs/screenshots/lobby-banner.png`, which only the v1.7.0 notes use.

**Checked**
- `npm test` passes. Lobby, agenda, session and form pages viewed at 1440 wide and on phone sizes, signed in and out.
- Covers were checked with a stand-in image, not real IGDB art.

**Not checked**
- Real IGDB covers and Discord avatars, real Discord sign-in, and the Docker image on Unraid.
- `public/logo.svg` and the PNG logos still carry violet details and the old tagline. They were left alone.

**Next step**
Released as version 1.8.0, so the image publishes as `latest` and `v1.8.0`, and `v1.7.0` keeps the previous look as a
rollback. No git tag or GitHub release was created. Check a real IGDB cover and Discord sign-in on the live app.

## 2026-11-05: Dependabot and `npm audit` review

**Changed (branch `claude/audit-fixes`)**
- Removed `nodemon`. Nothing used it (`npm run dev` uses `tsx watch`), and it was the only source of the
  `minimatch` and `brace-expansion` warnings.
- Updated `body-parser` to 2.4.0, which also moves `qs` to 6.17.1.

**Checked (Node 24.13 on the Mac, clean copy each time)**
- `npm ci`, `npx prisma generate` and `npm test` pass on this branch and on PRs 5, 6, 7 and 8 separately.
- A rehearsal of this branch plus PRs 5, 7 and 8 passes all 9 tests and `npm audit` reports 0 vulnerabilities.
- On PR 5 and on the rehearsal, the rendered HTML of the main pages matches `main`. PR 5 also ran
  `prisma migrate deploy` against a database made with the old Prisma, then started and served the home page.

**Not checked**
- No Docker image was built, because Docker was not running. Nothing was tested on Linux.
- PR 3 (Node 26) was not run. PR 4 (GitHub Actions) can only run on `main`, where it publishes an image.
- Discord login and the bot need real credentials, so they were not exercised.

**Next step**
Jake decides on merges. Suggested order: PR 4, this branch, PR 5, PR 7, PR 8. Hold PR 3. PR 6 is not needed
once this branch or PR 5 lands. Each merge to `main` rebuilds the image and overwrites `latest` and `v1.7.0`.
