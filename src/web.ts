import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { Strategy as DiscordStrategy } from 'passport-discord';
import path from 'path';
import expressLayouts from 'express-ejs-layouts';
import prisma from './prisma';
import { notifyNewSession, notifySessionCancelled, updateSessionDiscordMessage } from './bot';
import { startOfMonth, endOfMonth, startOfWeek, endOfWeek, eachDayOfInterval, format, isSameMonth, isToday, addMonths, subMonths } from 'date-fns';
import dns from 'dns';
import { coverUrl, sessionCalendar, validateSession } from './session-utils';

// Force IPv4 DNS resolution for fetch/axios to fix ENOTFOUND errors
dns.setDefaultResultOrder('ipv4first');


const app = express();

// Set up EJS
app.use(expressLayouts);
app.set('layout', 'layout');
app.set('view engine', 'ejs');
const projectRoot = path.resolve(__dirname, path.basename(path.dirname(__dirname)) === 'dist' ? '../..' : '..');
app.set('views', path.join(projectRoot, 'src/views'));

// Middleware
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(projectRoot, 'public')));

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
    res.locals.currentPath = req.path;
    res.locals.coverUrl = coverUrl;
    res.locals.format = format;
    res.locals.timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    res.locals.error = typeof req.query.error === 'string' ? 'Something went wrong. Please try again.' : null;
    next();
});

// IGDB Token Caching
let igdbAccessToken: string | null = null;
let igdbTokenExpiry: number = 0;

async function getIGDBToken() {
    if (igdbAccessToken && Date.now() < igdbTokenExpiry) {
        return igdbAccessToken;
    }
    try {
        const response = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${process.env.IGDB_CLIENT_ID}&client_secret=${process.env.IGDB_CLIENT_SECRET}&grant_type=client_credentials`, { method: 'POST' });
        
        if (!response.ok) {
            console.error('Twitch Auth Failed:', await response.text());
            return null;
        }

        const data = await response.json();
        if (data.access_token) {
            igdbAccessToken = data.access_token;
            // expires_in is in seconds. Subtract 5 mins for safety.
            igdbTokenExpiry = Date.now() + ((data.expires_in - 300) * 1000); 
        }
    } catch (e) {
        console.error('Failed to fetch IGDB token (Network/DNS error):', e);
    }
    return igdbAccessToken;
}

// Routes
app.get('/api/games/search', async (req, res) => {
    if (!process.env.IGDB_CLIENT_ID || !process.env.IGDB_CLIENT_SECRET) {
        return res.json([]);
    }

    const query = req.query.q as string;
    if (!query) return res.json([]);

    try {
        const token = await getIGDBToken();
        if (!token) return res.json([]);

        // Sanitize query to prevent syntax errors in IGDB apicalypse
        const safeQuery = query.replace(/"/g, '');

        const response = await fetch('https://api.igdb.com/v4/games', {
            method: 'POST',
            headers: {
                'Client-ID': process.env.IGDB_CLIENT_ID,
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/json',
                'Content-Type': 'text/plain'
            },
            body: `search "${safeQuery}"; fields name, cover.image_id, artworks.image_id; limit 5;`
        });
        
        const data = await response.json();
        
        if (Array.isArray(data)) {
            // Map IGDB format to what our frontend expects
            const results = data.map((game: any) => {
                // Prefer 16:9 artworks for banners, fallback to cover art
                const imageId = (game.artworks && game.artworks.length > 0) ? game.artworks[0].image_id : game.cover?.image_id;
                return {
                    name: game.name,
                    // Use 1080p high-res image instead of small cover
                    background_image: imageId ? `https://images.igdb.com/igdb/image/upload/t_1080p/${imageId}.jpg` : null
                };
            });
            return res.json(results);
        }
        
        res.json([]);
    } catch (error) {
        console.error('Error fetching games from IGDB:', error);
        res.json([]);
    }
});

app.get('/', async (req, res) => {
    // Determine Target Month
    const monthQuery = req.query.month as string;
    let targetDate = new Date();
    if (typeof monthQuery === 'string' && /^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/.test(monthQuery)) {
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
        take: 3,
        include: { creator: true, rsvps: true }
    });

    // Recent Members widget data
    const activeMembers = await prisma.user.findMany({
        take: 8,
        orderBy: { id: 'desc' }
    });

    const query = typeof req.query.q === 'string' ? req.query.q.slice(0, 100).trim() : '';
    const filter = req.query.filter === 'open' ? 'open' : req.query.filter === 'mine' && req.user ? 'mine' : 'all';
    const view = req.query.view === 'agenda' ? 'agenda' : req.query.view === 'calendar' ? 'calendar' : 'auto';
    const filteredSessions = sessions.filter(s => {
        const matchesSearch = `${s.title} ${s.gameTitle} ${s.creator.username}`.toLowerCase().includes(query.toLowerCase());
        const matchesFilter = filter === 'open' ? s.startTime > today && s.rsvps.filter(r => r.status === 'CONFIRMED').length < s.maxPlayers
            : filter === 'mine' ? s.creatorId === (req.user as any).id || s.rsvps.some(r => r.userId === (req.user as any).id && r.status !== 'DECLINED') : true;
        return matchesSearch && matchesFilter;
    });
    const monthSessions = filteredSessions.filter(s => isSameMonth(s.startTime, monthStart));
    const link = (changes: Record<string, string>) => {
        const params = new URLSearchParams({ month: format(monthStart, 'yyyy-MM'), q: query, filter, ...(view !== 'auto' ? { view } : {}), ...changes });
        return `/?${params}`;
    };
    res.render('index', {
        sessions: filteredSessions,
        monthSessions, query, filter, view, link,
        monthCount: sessions.filter(s => isSameMonth(s.startTime, monthStart)).length,
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
    const date = typeof req.query.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date) ? req.query.date : '';
    res.render('new-session', { values: { date }, errors: [] });
});

app.post('/sessions', async (req, res) => {
    if (!req.user) return res.redirect('/auth/discord');

    const { values, startTime, maxPlayers, errors } = validateSession(req.body);
    if (errors.length) return res.status(400).render('new-session', { values, errors });
    const { gameTitle, imageUrl, title, description } = values;
    const user = req.user as any;

    try {
        const session = await prisma.gameSession.create({
            data: {
                gameTitle,
                gameCoverUrl: imageUrl || null,
                title,
                description,
                maxPlayers,
                startTime,
                creatorId: user.id,
                rsvps: { create: { userId: user.id, status: 'CONFIRMED' } }
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
        res.status(500).render('new-session', { values, errors: ['Your session could not be saved. Please try again.'] });
    }
});

app.get('/sessions/:id/calendar.ics', async (req, res) => {
    const session = await prisma.gameSession.findUnique({ where: { id: req.params.id } });
    if (!session) return res.status(404).send('Session not found');
    res.setHeader('Content-Disposition', 'attachment; filename="freetoplay-session.ics"');
    res.type('text/calendar').send(sessionCalendar(session, process.env.BASE_URL || 'http://localhost:3000'));
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
