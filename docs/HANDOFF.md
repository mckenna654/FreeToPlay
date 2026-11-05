# Handoff

## 2026-11-05: Login secret and saved logins (v1.7.1)

**Changed (branch `claude/secure-login-sessions`)**
- `SESSION_SECRET` no longer falls back to a hard-coded value. If it is empty or a public example value, the
  app generates a random secret and saves it as `session-secret` next to the database.
- Logins are saved in `sessions.db` next to the database, using the existing `better-sqlite3` package through
  `src/session-store.ts`. No new dependency, and no Prisma migration because it is a separate file.
- Bumped to 1.7.1 so merging does not overwrite the `v1.7.0` image.

**Checked (Node 24.13 on the Mac)**
- `npm ci`, `npx prisma generate` and `npm test` pass.
- The tests start the real app with no secret, restart it, stay signed in, and reject a cookie forged with
  `super-secret`. These end-to-end tests fail against the old session setup.

**Not checked**
- No Docker image was built, because Docker was not running. Nothing was tested on Linux or on Unraid.
- A real Discord sign-in needs real credentials. The tests use a saved login instead.

**Next step**
Jake decides on the merge. PR 10 also creates this file, so whichever merges second has a conflict here: keep
both entries. After merging, check on Unraid that `session-secret` and `sessions.db` appear in
`/mnt/user/appdata/freetoplay/data/`, and that a sign-in survives a container restart.
