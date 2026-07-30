import express from 'express';
import session from 'express-session';
import passport from 'passport';
import { Strategy as DiscordStrategy } from 'passport-discord';
import path from 'path';
import expressLayouts from 'express-ejs-layouts';
import prisma from './prisma';
import { notifyNewSession, notifySessionJoin } from './bot';

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

// Sessions
app.use(session({
    secret: process.env.SESSION_SECRET || 'super-secret',
    resave: false,
    saveUninitialized: false,
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
    const sessions = await prisma.session.findMany({
        where: {
            startTime: { gte: new Date() } // Future sessions only
        },
        orderBy: { startTime: 'asc' },
        include: {
            creator: true,
            participants: { include: { user: true } }
        }
    });
    res.render('index', { sessions });
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

    const { game, imageUrl, content, date, time } = req.body;
    const startTime = new Date(`${date}T${time}`);
    const user = req.user as any;

    try {
        const session = await prisma.session.create({
            data: {
                game,
                imageUrl: imageUrl || null,
                content,
                startTime,
                creatorId: user.id
            }
        });

        // Add creator as first participant
        await prisma.sessionParticipant.create({
            data: {
                sessionId: session.id,
                userId: user.id
            }
        });

        if (process.env.DISCORD_CHANNEL_ID) {
            await notifyNewSession({
                game,
                imageUrl: imageUrl || undefined,
                content,
                startTime,
                creatorName: user.username
            }, process.env.DISCORD_CHANNEL_ID);
        }

        res.redirect('/');
    } catch (error) {
        console.error(error);
        res.redirect('/sessions/new?error=failed');
    }
});

// Join Session
app.post('/sessions/:id/join', async (req, res) => {
    if (!req.user) return res.redirect('/auth/discord');
    
    const user = req.user as any;
    const sessionId = req.params.id;

    try {
        const session = await prisma.session.findUnique({ where: { id: sessionId } });
        if (!session) return res.status(404).send('Session not found');

        // Check if already participating
        const existing = await prisma.sessionParticipant.findUnique({
            where: {
                sessionId_userId: {
                    sessionId,
                    userId: user.id
                }
            }
        });

        if (!existing) {
            await prisma.sessionParticipant.create({
                data: {
                    sessionId,
                    userId: user.id
                }
            });

            if (process.env.DISCORD_CHANNEL_ID) {
                await notifySessionJoin({
                    game: session.game,
                    startTime: session.startTime
                }, user.username, process.env.DISCORD_CHANNEL_ID);
            }
        }
        
        res.redirect('/');
    } catch (error) {
        console.error(error);
        res.redirect('/?error=failed_to_join');
    }
});

// Leave Session
app.post('/sessions/:id/leave', async (req, res) => {
    if (!req.user) return res.redirect('/auth/discord');
    
    const user = req.user as any;
    const sessionId = req.params.id;

    try {
        await prisma.sessionParticipant.delete({
            where: {
                sessionId_userId: {
                    sessionId,
                    userId: user.id
                }
            }
        });
        res.redirect('/');
    } catch (error) {
        console.error(error);
        res.redirect('/');
    }
});


export default app;
