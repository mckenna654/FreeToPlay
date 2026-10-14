// An isolated app instance: temporary SQLite database, fake local identity,
// and no Discord credentials or outbound bot notifications.
const { mkdtempSync, readFileSync, readdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');

async function startFixture() {
    const directory = mkdtempSync(path.join(tmpdir(), 'freetoplay-test-'));
    process.env.DATABASE_URL = 'file:' + path.join(directory, 'test.db');
    process.env.DISCORD_CLIENT_ID = '';
    process.env.DISCORD_CLIENT_SECRET = '';
    process.env.DISCORD_BOT_TOKEN = '';
    process.env.DISCORD_CHANNEL_ID = '';
    process.env.IGDB_CLIENT_ID = '';
    process.env.IGDB_CLIENT_SECRET = '';
    process.env.BASE_URL = 'http://localhost:3000';
    process.env.SESSION_SECRET = 'isolated-fixture-only';
    const Database = require('better-sqlite3');
    const db = new Database(path.join(directory, 'test.db'));
    const migrations = path.resolve(__dirname, '../prisma/migrations');
    for (const name of readdirSync(migrations).sort()) {
        if (name !== 'migration_lock.toml') db.exec(readFileSync(path.join(migrations, name, 'migration.sql'), 'utf8'));
    }
    db.close();
    const prisma = require('../dist/src/prisma').default;
    const people = [
        { id: 'alex', username: 'Alex' }, { id: 'sam', username: 'Sam' },
        { id: 'jules', username: 'Jules' }, { id: 'morgan', username: 'Morgan' }
    ];
    for (const person of people) await prisma.user.create({ data: person });
    const startTime = new Date();
    startTime.setDate(startTime.getDate() + 1);
    startTime.setHours(20, 0, 0, 0);
    const second = new Date(startTime); second.setDate(second.getDate() + 2);
    const third = new Date(startTime); third.setDate(third.getDate() + 4);
    const definitions = [
        { id: 'bug-hunt', title: 'Friday night bug hunt', gameTitle: 'Helldivers 2', startTime, creatorId: 'alex', maxPlayers: 4, players: ['alex', 'sam'] },
        { id: 'farm', title: 'A slower kind of Sunday', gameTitle: 'Stardew Valley', startTime: second, creatorId: 'sam', maxPlayers: 4, players: ['sam'] },
        { id: 'squad', title: 'One more round', gameTitle: 'Counter-Strike 2', startTime: third, creatorId: 'jules', maxPlayers: 2, players: ['jules', 'morgan'] }
    ];
    for (const { players, ...session } of definitions) {
        await prisma.gameSession.create({ data: { ...session,
            description: 'A few relaxed games with the usual crew. Meet in Discord five minutes before we start.\nNew players welcome.',
            rsvps: { create: players.map(userId => ({ userId, status: 'CONFIRMED' })) }
        } });
    }
    const passport = require('passport');
    passport.session = () => (req, res, next) => {
        const person = people.find(p => p.id === req.headers['x-test-user']);
        if (person) req.user = person;
        next();
    };
    const app = require('../dist/src/web').default;
    const server = await new Promise((resolve, reject) => {
        const server = app.listen(0, '127.0.0.1', error => error ? reject(error) : resolve(server));
    });
    const baseUrl = 'http://127.0.0.1:' + server.address().port;
    const month = [startTime.getFullYear(), String(startTime.getMonth() + 1).padStart(2, '0')].join('-');
    return { app, server, baseUrl, prisma, month, startTime, directory,
        close: async () => { await new Promise(resolve => server.close(resolve)); await prisma.$disconnect(); }
    };
}

module.exports = { startFixture };
if (require.main === module) startFixture().then(fixture => console.log(JSON.stringify({ baseUrl: fixture.baseUrl, month: fixture.month })));
