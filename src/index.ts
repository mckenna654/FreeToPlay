import 'dotenv/config';
import app from './web';
import { client as bot } from './bot';

const PORT = process.env.PORT || 3000;

// A stray failed promise is logged rather than ending the process, so one bad Discord call
// can't take the website down.
process.on('unhandledRejection', reason => console.error('Unhandled rejection:', reason));

app.listen(PORT, (error?: Error) => {
    if (error) {
        // Exit so the failure is visible and the container's restart policy can act on it
        console.error(`Could not start the web server on port ${PORT}:`, error);
        process.exit(1);
    }
    console.log(`Web server listening on port ${PORT}`);
});

if (process.env.DISCORD_BOT_TOKEN) {
    bot.login(process.env.DISCORD_BOT_TOKEN).catch((err: any) => {
        console.error('Failed to log in Discord bot:', err);
    });
} else {
    console.warn('DISCORD_BOT_TOKEN is not set. Bot will not start.');
}
