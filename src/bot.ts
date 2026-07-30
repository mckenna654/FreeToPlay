import { Client, GatewayIntentBits, TextChannel, EmbedBuilder } from 'discord.js';

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

client.once('clientReady', () => {
    console.log(`Bot logged in as ${client.user?.tag}`);
});

export const notifyNewSession = async (session: { game: string; content: string; startTime: Date; creatorName: string }, channelId: string) => {
    try {
        const channel = await client.channels.fetch(channelId) as TextChannel;
        if (channel) {
            const embed = new EmbedBuilder()
                .setTitle('🎮 New Gaming Session Suggested!')
                .setThumbnail('https://github.com/mckenna654/FreeToPlay/raw/main/public/discord-size.png')
                .setColor(0x00FF00)
                .addFields(
                    { name: 'Game', value: session.game, inline: true },
                    { name: 'Content', value: session.content, inline: true },
                    { name: 'Time', value: session.startTime.toLocaleString() },
                    { name: 'Suggested By', value: session.creatorName }
                )
                .setTimestamp();
            
            await channel.send({ embeds: [embed] });
        }
    } catch (error) {
        console.error('Failed to send Discord notification:', error);
    }
};

export const notifySessionJoin = async (session: { game: string; startTime: Date }, joinerName: string, channelId: string) => {
    try {
        const channel = await client.channels.fetch(channelId) as TextChannel;
        if (channel) {
            await channel.send(`👋 **${joinerName}** joined the session for **${session.game}** scheduled at ${session.startTime.toLocaleString()}!`);
        }
    } catch (error) {
        console.error('Failed to send Discord join notification:', error);
    }
};

export default client;
