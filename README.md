# FreeToPlay 🎮

<p align="center">
  <img src="public/full-size.png" alt="FreeToPlay Logo" width="400">
</p>

FreeToPlay is a simple Discord Bot and web application designed to help you and your friends easily schedule gaming sessions. With our busy lives, it's difficult to align schedules. FreeToPlay allows users to authenticate via Discord, create gaming sessions (e.g., "Halo Combat Evolved - Co-Op Campaign"), and allow others to join. The bot posts a message to a designated Discord channel whenever a session is created or someone joins!

## Features

- **Discord Authentication:** Log in seamlessly with your Discord account.
- **Session Scheduling:** Create upcoming gaming sessions with a specified game, details, date, and time.
- **RSVP System:** Users can easily join or leave existing sessions.
- **Discord Bot Notifications:** Automatically sends notifications to your server when a session is scheduled or when someone joins.
- **Modern UI:** Designed with Tailwind CSS.

## Screenshots

*(Add screenshots here once the web design is finalized)*

## Prerequisites

- Node.js (v18 or higher)
- A Discord Developer Application (to get Client ID, Secret, and Bot Token)

## Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/yourusername/FreeToPlay.git
   cd FreeToPlay
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Database Setup:**
   The project uses SQLite via Prisma. Initialize the database:
   ```bash
   npx prisma migrate dev
   ```

4. **Environment Variables:**
   Create a `.env` file in the root directory based on `.env.example` (or configure the following values):
   ```env
   DATABASE_URL="file:./dev.db"
   DISCORD_CLIENT_ID="your_discord_client_id"
   DISCORD_CLIENT_SECRET="your_discord_client_secret"
   DISCORD_BOT_TOKEN="your_discord_bot_token"
   DISCORD_CHANNEL_ID="your_discord_channel_id"
   SESSION_SECRET="your_random_secret_string"
   PORT=3000
   BASE_URL="http://localhost:3000"
   ```

5. **Discord Application Configuration:**
   - In your Discord Developer Portal, add an **OAuth2 Redirect URI**: `http://localhost:3000/auth/discord/callback` (or your production URL).
   - Give the Bot the following intents: **Message Content Intent** (if needed for reading, though currently it just posts embeds).
   - Ensure the Bot is invited to your server and has permissions to send messages and embeds in the target channel.

## Running the Application

**Development Mode:**
```bash
npm run dev
```

**Production Mode:**
```bash
npm run build
npm start
```

## Future Ideas

- **Gaming API Integration:** Integrate IGDB or RAWG APIs to fetch game cover art and search for game titles.
- **Calendar View:** A full monthly calendar view for upcoming sessions.

## License

ISC License
