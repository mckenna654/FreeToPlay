# Handoff

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
