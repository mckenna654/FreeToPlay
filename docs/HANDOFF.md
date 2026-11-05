# Handoff

## 2026-11-05: Logo cleanup

**Changed**
- Removed the violet corner marks and old tagline from `public/logo.svg`, and regenerated `public/large-logo.png` from it.
- `public/small-logo.png` and `public/icon.svg` had neither and are unchanged, so the Discord thumbnail and favicon stay the same.
- The running app uses neither changed file, so this merged with `[skip ci]` and no new image or version.

**Not done**
- Tags and GitHub releases for 1.8.0 to 1.8.4, and deleting merged branches. Automated permission checks blocked both, so they wait on Jake.

## 2026-11-05: Forged-request check on plain http (v1.8.4, branch `claude/origin-check`)

**Changed**
- `isOwnSiteRequest` in `src/session-utils.ts` now decides. It uses `Sec-Fetch-Site` when present, otherwise compares
  `Origin`, including its scheme, with the request's own address and `BASE_URL`. Requests with neither header are allowed, because browsers always
  send `Origin` on a POST.

**Checked**
- `npm test`: 36 of 36 on Node 24.13 on the Mac.
- Chrome over plain `http` on the Mac's LAN address: no `Sec-Fetch-Site` was sent, a page on another port was refused
  and changed nothing, and a form on the app's own origin still worked.

**Not checked**
- The image on Unraid, sign-in through Nginx Proxy Manager, and a real Discord sign-in.

**Next step**
Jake decides on the merge. The 1.8.3 checks for Discord sign-in on the live setup still apply.

## 2026-11-05: Fixes from the full code review (v1.8.3, branch `claude/review-fixes`)

**Changed**
- Discord handler can't reject, the client has an `error` listener, and `src/index.ts` logs stray rejections.
- `SameSite=Lax`, a `Sec-Fetch-Site` check on non-GET requests, POST `/logout`, and OAuth `state: true`.
- `src/rsvp.ts` is now the only place RSVPs are saved, and it enforces `maxPlayers` in a transaction.
- `public/app.js` moves calendar entries to the viewer's local day. The server query is padded by a day each side.
- Cancelling deletes first and uses the saved channel. Cleanup also uses the saved channel.
- `coverUrl` only accepts `https://images.igdb.com`. `prisma.config.ts` loads `.env`. A failed port bind exits with code 1.
- Rewrote the failed migration message, which used to recommend deleting `prod.db`.

**Checked**
- `npm test`: 34 of 34 on Node 24.13 on the Mac.
- With the server on UTC, headless Chrome placed entries on the correct day for Sydney, UTC and Los Angeles viewers.

**Not checked**
- A real Discord sign-in through the new `state` check, real Discord button clicks, and the bot against real Discord.
- The image on Unraid, and sign-in through Nginx Proxy Manager.

**Next step**
Jake decides on the merge. Afterwards, sign in with Discord once to confirm the `state` check passes on the live setup.

## 2026-11-05: Docker image moved to Node 26 (v1.8.2)

**Changed**
- Merged Dependabot's PR 3 at Jake's request, which moves both Dockerfile stages to `node:26-bookworm-slim`.
- `.nvmrc`, `AGENTS.md` and the README now say Node 26. `engines` stays at `>=24`.
- Bumped to 1.8.2, so `v1.8.1` remains a Node 24 image to fall back on.

**Checked**
- On Node 26.13 on the Mac: `npm ci`, `npm test` (22 of 22), `prisma migrate deploy`, and the built app started and served the home page.

**Not checked**
- The new image on Unraid, including `better-sqlite3` loading against a database on the appdata share.
- A real Discord sign-in, and the bot connecting to Discord under Node 26.

**Next step**
Pull `latest` on Unraid and run the checks in the login entry below. If Node 26 misbehaves, pin `:v1.8.1`.

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
