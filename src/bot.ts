import { Client, GatewayIntentBits, TextChannel, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Interaction } from 'discord.js';
import prisma from './prisma';

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

            const channelId = process.env.DISCORD_CHANNEL_ID;
            if (!channelId) return;

            const channel = await client.channels.fetch(channelId).catch(() => null) as TextChannel | null;
            if (!channel) return;

            for (const session of expiredSessions) {
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
                    }, 2 * 60 * 60 * 1000);
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

// Handle Button Interactions
client.on('interactionCreate', async (interaction: Interaction) => {
    if (!interaction.isButton()) return;

    const [action, sessionId] = interaction.customId.split('_');
    
    if (['confirm', 'tentative', 'decline'].includes(action)) {
        await interaction.deferReply({ ephemeral: true });
        
        try {
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

            await prisma.rSVP.upsert({
                where: {
                    sessionId_userId: {
                        sessionId,
                        userId: user.id
                    }
                },
                update: { status: statusMap[action] },
                create: {
                    sessionId,
                    userId: user.id,
                    status: statusMap[action]
                }
            });

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
            await interaction.editReply('❌ Failed to update your RSVP status.');
        }
    }
});

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
            
            await channel.send({ embeds: [embed] });
        }
    } catch (error) {
        console.error('Failed to send cancellation notification:', error);
    }
};
