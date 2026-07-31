import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { Strategy as DiscordStrategy } from 'passport-discord';
import path from 'path';
import expressLayouts from 'express-ejs-layouts';
import prisma from './prisma';
import { notifyNewSession, notifySessionCancelled, updateSessionDiscordMessage } from './bot';
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, format, isSameMonth, isToday, addMonths, subMonths } from 'date-fns';

const app = express();

// Set up EJS
app.use(expressLayouts);
app.set('layout', 'layout');
app.set('view engine', 'ejs');
app.set('views', path.resolve(__dirname, '../../src/views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.resolve(__dirname, '../../public')));

app.set('trust proxy', 1);

// Sessions
app.use(session({
    secret: process.env.SESSION_SECRET || 'super-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: process.env.NODE_ENV === 'production' && process.env.BASE_URL?.startsWith('https'), // true if behind HTTPS proxy
        maxAge: 1000 * 60 * 60 * 24 * 7 // 1 week
    }
}));

// Passport Config
passport.serializeUser((user: any, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
    try {
        const user = await prisma.user.findUnique({ where: { id } });
        done(null, user);
    } catch (error) {
        done(error, null);
    }
});

if (process.env.DISCORD_CLIENT_ID && process.env.DISCORD_CLIENT_SECRET) {
    passport.use(new DiscordStrategy({
        clientID: process.env.DISCORD_CLIENT_ID,
        clientSecret: process.env.DISCORD_CLIENT_SECRET,
        callbackURL: `${process.env.BASE_URL}/auth/discord/callback`,
        scope: ['identify']
    } as any, async (accessToken: any, refreshToken: any, profile: any, done: any) => {
        try {
            const user = await prisma.user.upsert({
                where: { id: profile.id },
                update: {
                    username: profile.username,
                    avatar: profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` : null,
                },
                create: {
                    id: profile.id,
                    username: profile.username,
                    avatar: profile.avatar ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png` : null,
                }
            });
            return done(null, user);
        } catch (error) {
            return done(error as Error, undefined);
        }
    }));
}

app.use(passport.initialize());
app.use(passport.session());

// Pass user to views
app.use((req, res, next) => {
    res.locals.user = req.user;
    next();
});

// Routes
app.get('/api/games/search', async (req, res) => {
    if (!process.env.RAWG_API_KEY) {
        return res.json([]);
    }
    
    const query = req.query.q as string;
    if (!query) return res.json([]);

    try {
        const response = await fetch(`https://api.rawg.io/api/games?search=${encodeURIComponent(query)}&key=${process.env.RAWG_API_KEY}&page_size=5`);
        const data = await response.json();
        res.json(data.results || []);
    } catch (error) {
        console.error('Error fetching games from RAWG:', error);
        res.json([]);
    }
});

app.get('/', async (req, res) => {
    // Determine Target Month
    const monthQuery = req.query.month as string;
    let targetDate = new Date();
    if (monthQuery && /^\d{4}-\d{2}$/.test(monthQuery)) {
        const [year, month] = monthQuery.split('-');
        targetDate = new Date(parseInt(year), parseInt(month) - 1, 1);
    }

    // Generate Calendar Days
    const monthStart = startOfMonth(targetDate);
    const monthEnd = endOfMonth(targetDate);
    const startDate = startOfWeek(monthStart);
    const endDate = endOfWeek(monthEnd);
    const calendarDays = eachDayOfInterval({ start: startDate, end: endDate });

    // Navigation links
    const prevMonth = format(subMonths(monthStart, 1), 'yyyy-MM');
    const nextMonth = format(addMonths(monthStart, 1), 'yyyy-MM');

    // Fetch all sessions in the interval
    const sessions = await prisma.gameSession.findMany({
        where: {
            startTime: {
                gte: startDate,
                lte: endDate
            }
        },
        orderBy: { startTime: 'asc' },
        include: {
            creator: true,
            rsvps: { include: { user: true } }
        }
    });

    // Upcoming widget data (Future sessions globally)
    const today = new Date();
    const upcomingSessions = await prisma.gameSession.findMany({
        where: { startTime: { gte: today } },
        orderBy: { startTime: 'asc' },
        take: 5
    });

    // Recent Members widget data
    const activeMembers = await prisma.user.findMany({
        take: 8,
        orderBy: { id: 'desc' }
    });

    res.render('index', {
        sessions,
        upcomingSessions,
        activeMembers,
        calendarDays,
        monthStart,
        prevMonth,
        nextMonth,
        isSameMonth,
        isToday,
        format
    });
});

app.get('/auth/discord', passport.authenticate('discord'));

app.get('/auth/discord/callback', passport.authenticate('discord', {
    failureRedirect: '/',
    successRedirect: '/'
}));

app.get('/logout', (req, res, next) => {
    req.logout((err) => {
        if (err) return next(err);
        res.redirect('/');
    });
});

// Create Session
app.get('/sessions/new', (req, res) => {
    if (!req.user) return res.redirect('/auth/discord');
    res.render('new-session');
});

app.post('/sessions', async (req, res) => {
    if (!req.user) return res.redirect('/auth/discord');

    const { gameTitle, imageUrl, title, description, maxPlayers, date, time } = req.body;
    const startTime = new Date(`${date}T${time}`);
    const user = req.user as any;

    try {
        const session = await prisma.gameSession.create({
            data: {
                gameTitle,
                gameCoverUrl: imageUrl || null,
                title,
                description,
                maxPlayers: parseInt(maxPlayers) || 4,
                startTime,
                creatorId: user.id
            }
        });

        // Add creator as CONFIRMED
        await prisma.rSVP.create({
            data: {
                sessionId: session.id,
                userId: user.id,
                status: 'CONFIRMED'
            }
        });

        if (process.env.DISCORD_CHANNEL_ID) {
            const messageId = await notifyNewSession({
                id: session.id,
                gameTitle,
                gameCoverUrl: imageUrl || null,
                title,
                description,
                startTime,
                maxPlayers: session.maxPlayers,
                creatorName: user.username
            }, process.env.DISCORD_CHANNEL_ID);

            if (messageId) {
                await prisma.gameSession.update({
                    where: { id: session.id },
                    data: { 
                        discordMessageId: messageId,
                        discordChannelId: process.env.DISCORD_CHANNEL_ID
                    }
                });
            }
        }

        res.redirect(`/sessions/${session.id}`);
    } catch (error) {
        console.error(error);
        res.redirect('/sessions/new?error=failed');
    }
});

// View Session Details
app.get('/sessions/:id', async (req, res) => {
    const session = await prisma.gameSession.findUnique({
        where: { id: req.params.id },
        include: {
            creator: true,
            rsvps: { include: { user: true } }
        }
    });

    if (!session) return res.status(404).send('Session not found');

    res.render('event', { session, format });
});

// RSVP Update
app.post('/sessions/:id/rsvp', async (req, res) => {
    if (!req.user) return res.redirect('/auth/discord');

    const user = req.user as any;
    const sessionId = req.params.id;
    const { status } = req.body;

    try {
        if (['CONFIRMED', 'TENTATIVE', 'DECLINED'].includes(status)) {
            await prisma.rSVP.upsert({
                where: {
                    sessionId_userId: { sessionId, userId: user.id }
                },
                update: { status },
                create: {
                    sessionId,
                    userId: user.id,
                    status
                }
            });

            // Update Discord message embed to reflect new slot count
            await updateSessionDiscordMessage(sessionId);
        }
        res.redirect(`/sessions/${sessionId}`);
    } catch (error) {
        console.error(error);
        res.redirect(`/sessions/${sessionId}?error=failed`);
    }
});

// Delete Session
app.post('/sessions/:id/delete', async (req, res) => {
    if (!req.user) return res.redirect('/auth/discord');

    const user = req.user as any;
    const sessionId = req.params.id;

    try {
        const session = await prisma.gameSession.findUnique({ 
            where: { id: sessionId },
            include: { creator: true }
        });
        if (!session) return res.status(404).send('Session not found');

        // Verify the logged-in user is the creator of the event
        if (session.creatorId !== user.id) {
            return res.status(403).send('Unauthorized');
        }

        if (process.env.DISCORD_CHANNEL_ID) {
            await notifySessionCancelled({
                title: session.title,
                gameTitle: session.gameTitle,
                creatorName: session.creator.username
            }, process.env.DISCORD_CHANNEL_ID, session.discordMessageId);
        }

        await prisma.gameSession.delete({
            where: { id: sessionId }
        });

        res.redirect('/');
    } catch (error) {
        console.error(error);
        res.redirect(`/sessions/${sessionId}?error=delete_failed`);
    }
});

export default app;
