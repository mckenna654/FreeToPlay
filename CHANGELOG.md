# Changelog

All notable changes to FreeToPlay are documented here.  
The project follows [Semantic Versioning](https://semver.org/) on a **1.x** line.

---

## [1.7.0] — 2026-10-14

### Added
- Calendar/agenda switch, session search, open-spots and my-sessions filters.
- Session calendar downloads (.ics), copyable invite links, and date shortcuts from the calendar.
- Guided session form with live preview, keyboard-accessible IGDB suggestions, and preserved input on validation errors.
- Integration tests using an isolated SQLite database.

### Changed
- Redesigned the dashboard, event details, and scheduling flow as a co-op gaming lobby with original sci-fi artwork, dark surfaces, violet/lime accents, and bold game-menu typography.
- Mobile navigation now includes hosting and personal sessions; phones default to the agenda view.
- New controller logo, matching Discord thumbnail and browser icon, and updated desktop/mobile screenshots in the README.

### Fixed
- Session start times now preserve the browser's selected instant across server timezones.
- Creating a session and reserving its host's spot is atomic.
- Game suggestions render as text instead of injecting HTML.
- Corrected asset and template paths when running the TypeScript development server.
- Updated Docker build and runtime stages to Node 24 to support the current SQLite and Prisma dependencies; documented the matching local development requirement.

---

## [1.6.1] — 2026-07-31

### Added
- Added visual loading states and error messages to the IGDB autocomplete search dropdown so users know when the API is fetching or failing.

---

## [1.6.1] — 2026-07-31

### Fixed
- **High-Res Images:** Fixed an issue where IGDB images appeared pixelated in the web dashboard banners and Discord embeds. The API now fetches `1080p` resolution images, preferring beautiful 16:9 gameplay artworks over vertical box art when available.

---

## [1.6.0] — 2026-07-31

### Changed
- **Game Search Provider:** Migrated game search and artwork to the **IGDB API** (powered by Twitch).
- Autocomplete search now securely authenticates with Twitch, caches the OAuth token automatically, and pulls high-resolution box art.
- Added `IGDB_CLIENT_ID` and `IGDB_CLIENT_SECRET` for IGDB authentication.

### Fixed
- Added robust loading states ("Searching IGDB...") and explicit error messaging to the search dropdown.
- Fixed severe Node.js 20 networking bugs (`ENOTFOUND`) by shifting the Docker base image to Debian `bookworm-slim` and globally forcing `ipv4first` DNS resolution to guarantee API connectivity on all Unraid networks.

---

## [1.5.1] — 2026-07-31

### Fixed
- Docker images are only built from `main` (historical release tags no longer rebuild old broken images)
- Clearer container startup errors when a migration fails
- Recovery guidance if `prod.db` is stuck after a bad update

### Upgrade / recovery
If the container loops on Prisma migration errors after a Force Update:

```bash
rm -f /mnt/user/appdata/freetoplay/data/prod.db
rm -f /mnt/user/appdata/freetoplay/data/prod.db-journal
```

Then set the image to `ghcr.io/mckenna654/freetoplay:latest` (or `:v1.5.1`) and restart.

---

## [1.5.0] — 2026-07-31

### Added
- Final branding with `large-logo.png` (README) and `small-logo.png` (web UI)
- MIT License
- Polished README, topics, and Docker/Unraid docs
- Larger sidebar logo treatment

### Changed
- Consolidated public docs around the stable 1.x release line

---

## [1.4.0] — 2026-07-31

### Added
- Discord embed **Web Dashboard** link button
- Clickable event title linking to the session page
- Reverse proxy support (`trust proxy` + secure cookies for HTTPS / Nginx Proxy Manager)

---

## [1.3.0] — 2026-07-31

### Added
- Hosts can cancel/delete their own events from the web UI
- Discord cancellation sync: deletes the original embed and posts a cancel notice
- Stores Discord message IDs for reliable cleanup

---

## [1.2.0] — 2026-07-31

### Added
- Modern dark SaaS dashboard (slate theme)
- Full monthly calendar grid
- Sidebar: upcoming sessions + active members
- Event detail pages with cover banner, roster, capacity bar
- RSVP statuses: Confirmed / Tentative / Declined
- Interactive Discord buttons (Join / Tentative / Decline)
- Prisma schema overhaul (`GameSession`, `RSVP`)

---

## [1.1.0] — 2026-07-31

### Added
- Video game database API integration
- Game name autocomplete when scheduling
- Automatic cover art on dashboard cards and Discord embeds

---

## [1.0.0] — 2026-07-31

### Added
- Initial FreeToPlay release
- Discord OAuth login
- Create / join gaming sessions via web UI
- Discord bot announcements for new sessions
- SQLite + Prisma persistence
- Docker image + Unraid-friendly compose/volume layout
- Tailwind dark UI foundation
