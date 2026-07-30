# Changelog

All notable changes to FreeToPlay are documented here.  
The project follows [Semantic Versioning](https://semver.org/) on a **1.x** line.

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
- RAWG Video Games Database API integration
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
