import { Client, GatewayIntentBits, TextChannel, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Interaction } from 'discord.js';
import prisma from './prisma';
import { saveRsvp } from './rsvp';
import { coverUrl } from './session-utils';

export const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

const startCleanupCron = () => {
    // Run every 10 minutes to check for expired sessions
    setInterval(async () => {
        try {
            const now = new Date();
            // 6 hours ago
            const sixHoursAgo = new Date(now.getTime() - 6 * 60 * 60 * 1000);
            
            const expiredSessions = await prisma.gameSession.findMany({
                where: {
                    startTime: { lte: sixHoursAgo },
                    discordMessageId: { not: null }
                }
            });

            if (expiredSessions.length === 0) return;

            for (const session of expiredSessions) {
                // Use the channel the post went to, in case the configured channel has changed since
                const channelId = session.discordChannelId || process.env.DISCORD_CHANNEL_ID;
                if (!channelId) continue;
                const channel = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
                if (!channel) continue;

                // 1. Delete original active message (with buttons)
                if (session.discordMessageId) {
                    try {
                        const oldMsg = await channel.messages.fetch(session.discordMessageId);
                        if (oldMsg) await oldMsg.delete();
                    } catch (e) {
                        console.error(`Could not delete old message for session ${session.id}:`, e);
                    }
                }

                // 2. Unlink message in DB so this doesn't run again for this session
                await prisma.gameSession.update({
                    where: { id: session.id },
                    data: { discordMessageId: null }
                });

                // 3. Post 'Session Over' message
                try {
                    const embed = new EmbedBuilder()
                        .setTitle(`🏁 Session Concluded: ${session.title}`)
                        .setColor(0x64748B) // Slate 500
                        .setDescription(`The session for **${session.gameTitle}** has ended. Hope you had fun!`);

                    const overMsg = await channel.send({ embeds: [embed] });

                    // 4. Delete the 'Session Over' message after 2 hours (2 * 60 * 60 * 1000 ms)
                    setTimeout(async () => {
                        try {
                            await overMsg.delete();
                        } catch (e) {
                            console.error('Could not delete session over message:', e);
                        }
                    }, 2 * 60 * 60 * 1000).unref();
                } catch (e) {
                    console.error('Could not send session over message:', e);
                }
            }
        } catch (error) {
            console.error('Cleanup cron job error:', error);
        }
    }, 10 * 60 * 1000);
};

client.once('clientReady', () => {
    console.log(`Bot logged in as ${client.user?.tag}`);
    startCleanupCron();
});

// Without a listener, a Discord connection error would be thrown and end the whole process
client.on('error', error => console.error('Discord client error:', error));

// Handle Button Interactions. Discord calls can fail at any point, including the very first
// reply, and a rejection escaping this handler would take the website down with the bot.
export const handleInteraction = async (interaction: Interaction) => {
    if (!interaction.isButton()) return;

    const [action, sessionId] = interaction.customId.split('_');
    
    if (['confirm', 'tentative', 'decline'].includes(action)) {
        try {
            await interaction.deferReply({ ephemeral: true });

            const user = await prisma.user.upsert({
                where: { id: interaction.user.id },
                update: {
                    username: interaction.user.username,
                    avatar: interaction.user.avatar ? `https://cdn.discordapp.com/avatars/${interaction.user.id}/${interaction.user.avatar}.png` : null,
                },
                create: {
                    id: interaction.user.id,
                    username: interaction.user.username,
                    avatar: interaction.user.avatar ? `https://cdn.discordapp.com/avatars/${interaction.user.id}/${interaction.user.avatar}.png` : null,
                }
            });

            const statusMap: Record<string, string> = {
                'confirm': 'CONFIRMED',
                'tentative': 'TENTATIVE',
                'decline': 'DECLINED'
            };

            const result = await saveRsvp(sessionId, user.id, statusMap[action]);
            if (result === 'full') {
                await interaction.editReply('This session is full. You can still choose Tentative.');
                return;
            }
            if (result === 'missing') {
                await interaction.editReply('This session no longer exists.');
                return;
            }

            // Re-render and update the original Discord message
            await updateSessionDiscordMessage(sessionId);

            const session = await prisma.gameSession.findUnique({
                where: { id: sessionId },
                include: { rsvps: true }
            });

            if (session) {
                const confirmedCount = session.rsvps.filter(r => r.status === 'CONFIRMED').length;
                await interaction.editReply(`✅ You have marked yourself as **${statusMap[action]}** for **${session.gameTitle}**. (${confirmedCount}/${session.maxPlayers} slots filled)`);
            } else {
                await interaction.editReply(`✅ Your RSVP status has been updated.`);
            }

        } catch (error) {
            console.error('RSVP Error:', error);
            await interaction.editReply('❌ Failed to update your RSVP status.').catch(replyError => {
                console.error('Could not tell the user their RSVP failed:', replyError);
            });
        }
    }
};
client.on('interactionCreate', handleInteraction);

export const notifyNewSession = async (session: { id: string, gameTitle: string; gameCoverUrl?: string | null; title: string; description: string; startTime: Date; creatorName: string; maxPlayers: number }, channelId: string) => {
    try {
        const channel = await client.channels.fetch(channelId) as TextChannel;
        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const eventUrl = `${baseUrl}/sessions/${session.id}`;

        if (channel) {
            const embed = new EmbedBuilder()
                .setTitle(`🎮 ${session.title}`)
                .setURL(eventUrl)
                .setThumbnail('https://github.com/mckenna654/FreeToPlay/raw/main/public/small-logo.png')
                .setColor(0x0F172A) // Slate 900
                .setDescription(`**${session.gameTitle}**\n\n${session.description}`)
                .addFields(
                    { name: 'Time', value: `<t:${Math.floor(session.startTime.getTime() / 1000)}:F>`, inline: true },
                    { name: 'Slots', value: `1 / ${session.maxPlayers} Filled`, inline: true },
                    { name: 'Host', value: session.creatorName, inline: true }
                );

            if (session.gameCoverUrl) {
                embed.setImage(session.gameCoverUrl);
            }

            const row = new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(`confirm_${session.id}`)
                        .setLabel('Join (Confirmed)')
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(`tentative_${session.id}`)
                        .setLabel('Tentative')
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId(`decline_${session.id}`)
                        .setLabel('Decline')
                        .setStyle(ButtonStyle.Danger),
                    new ButtonBuilder()
                        .setLabel('Web Dashboard')
                        .setStyle(ButtonStyle.Link)
                        .setURL(baseUrl)
                );

            const message = await channel.send({ embeds: [embed], components: [row] });
            return message.id;
        }
    } catch (error) {
        console.error('Failed to send Discord notification:', error);
        return null;
    }
};

export const updateSessionDiscordMessage = async (sessionId: string) => {
    try {
        const session = await prisma.gameSession.findUnique({
            where: { id: sessionId },
            include: { creator: true, rsvps: true }
        });

        if (!session || !session.discordChannelId || !session.discordMessageId) return;

        const channel = await client.channels.fetch(session.discordChannelId).catch(() => null) as TextChannel | null;
        if (!channel) return;

        const message = await channel.messages.fetch(session.discordMessageId).catch(() => null);
        if (!message) return;

        const confirmedCount = session.rsvps.filter(r => r.status === 'CONFIRMED').length;

        const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
        const eventUrl = `${baseUrl}/sessions/${session.id}`;

        const embed = new EmbedBuilder()
            .setTitle(`🎮 ${session.title}`)
            .setURL(eventUrl)
            .setThumbnail('https://github.com/mckenna654/FreeToPlay/raw/main/public/small-logo.png')
            .setColor(0x0F172A)
            .setDescription(`**${session.gameTitle}**\n\n${session.description}`)
            .addFields(
                { name: 'Time', value: `<t:${Math.floor(session.startTime.getTime() / 1000)}:F>`, inline: true },
                { name: 'Slots', value: `${confirmedCount} / ${session.maxPlayers} Filled`, inline: true },
                { name: 'Host', value: session.creator.username, inline: true }
            );

        const cover = coverUrl(session.gameCoverUrl);
        if (cover) {
            embed.setImage(cover);
        }

        const row = new ActionRowBuilder<ButtonBuilder>()
            .addComponents(
                new ButtonBuilder()
                    .setCustomId(`confirm_${session.id}`)
                    .setLabel('Join (Confirmed)')
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(`tentative_${session.id}`)
                    .setLabel('Tentative')
                    .setStyle(ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId(`decline_${session.id}`)
                    .setLabel('Decline')
                    .setStyle(ButtonStyle.Danger),
                new ButtonBuilder()
                    .setLabel('Web Dashboard')
                    .setStyle(ButtonStyle.Link)
                    .setURL(baseUrl)
            );

        await message.edit({ embeds: [embed], components: [row] });
    } catch (error) {
        console.error(`Failed to update Discord message for session ${sessionId}:`, error);
    }
};

export const notifySessionCancelled = async (session: { title: string; gameTitle: string; creatorName: string }, channelId: string, messageId: string | null) => {
    try {
        const channel = await client.channels.fetch(channelId) as TextChannel;
        if (channel) {
            if (messageId) {
                try {
                    const oldMessage = await channel.messages.fetch(messageId);
                    if (oldMessage) {
                        await oldMessage.delete();
                    }
                } catch (e) {
                    console.error('Could not delete original session message:', e);
                }
            }
            
            const embed = new EmbedBuilder()
                .setTitle(`❌ Event Cancelled: ${session.title}`)
                .setColor(0xE11D48) // Rose 600
                .setDescription(`The session for **${session.gameTitle}** hosted by **${session.creatorName}** has been cancelled.`);
            
            const cancelMsg = await channel.send({ embeds: [embed] });

            // Delete the cancellation message after 2 hours
            setTimeout(async () => {
                try {
                    await cancelMsg.delete();
                } catch (e) {
                    console.error('Could not delete cancellation message:', e);
                }
            }, 2 * 60 * 60 * 1000).unref();
        }
    } catch (error) {
        console.error('Failed to send cancellation notification:', error);
    }
};
