import 'dotenv/config';
import app from './web';
import bot from './bot';

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
    console.log(`Web server listening on port ${PORT}`);
});

if (process.env.DISCORD_BOT_TOKEN) {
    bot.login(process.env.DISCORD_BOT_TOKEN).catch(err => {
        console.error('Failed to log in Discord bot:', err);
    });
} else {
    console.warn('DISCORD_BOT_TOKEN is not set. Bot will not start.');
}
