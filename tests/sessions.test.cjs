// Login secret and saved logins. The end-to-end tests start the real app as its own process
// (no stubbed passport), with a clean environment and no Discord credentials.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createHmac } = require('node:crypto');
const { mkdtempSync, readFileSync, statSync, writeFileSync } = require('node:fs');
const { createServer } = require('node:net');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { promisify } = require('node:util');
const Database = require('better-sqlite3');
const express = require('express');
const session = require('express-session');
const { createDatabase } = require('./support.cjs');
const { resolveSessionSecret, SqliteSessionStore } = require('../dist/src/session-store');

const appEntry = path.resolve(__dirname, '../dist/src/index.js');
const temporaryDirectory = () => mkdtempSync(path.join(tmpdir(), 'freetoplay-session-test-'));
const secretFile = directory => path.join(directory, 'session-secret');
const inOneHour = () => new Date(Date.now() + 1000 * 60 * 60).toISOString();
const sessionFor = (userId, expires = inOneHour()) => ({
    cookie: { originalMaxAge: 1000 * 60 * 60, expires, httpOnly: true, path: '/' },
    passport: { user: userId }
});
const save = (store, sid, sess) => promisify(store.set.bind(store))(sid, sess);
const load = (store, sid) => promisify(store.get.bind(store))(sid);

// The same format express-session uses for its cookie.
function loginCookie(sid, secret) {
    const signature = createHmac('sha256', secret).update(sid).digest('base64').replace(/=+$/, '');
    return 'connect.sid=' + encodeURIComponent(`s:${sid}.${signature}`);
}

async function freePort() {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address();
    await new Promise(resolve => server.close(resolve));
    return port;
}

// Only the listed variables reach the app, and the temporary working directory has no .env.
async function bootApp(directory, extraEnv = {}) {
    const port = await freePort();
    const child = spawn(process.execPath, [appEntry], {
        cwd: directory,
        env: { PATH: process.env.PATH, NODE_ENV: 'production', PORT: String(port), BASE_URL: 'http://localhost', DATABASE_URL: 'file:' + path.join(directory, 'prod.db'), ...extraEnv }
    });
    let output = '';
    const exited = new Promise(resolve => child.once('exit', resolve));
    await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('App did not start:\n' + output)), 30000);
        const collect = chunk => {
            output += chunk;
            if (output.includes('Web server listening')) { clearTimeout(timeout); resolve(); }
        };
        child.stdout.on('data', collect);
        child.stderr.on('data', collect);
        child.once('exit', code => { clearTimeout(timeout); reject(new Error(`App exited with ${code}:\n${output}`)); });
    });
    return {
        output: () => output,
        isSignedIn: async cookie => {
            const response = await fetch(`http://127.0.0.1:${port}/`, { headers: cookie ? { cookie } : {} });
            assert.equal(response.status, 200);
            return !(await response.text()).includes('Connect Discord');
        },
        stop: async () => { child.kill(); await exited; }
    };
}

function installWithUser() {
    const directory = temporaryDirectory();
    const db = createDatabase(path.join(directory, 'prod.db'));
    db.prepare('INSERT INTO User (id, username) VALUES (?, ?)').run('alex', 'Alex');
    db.close();
    return directory;
}

async function addLogin(directory, sid) {
    const store = new SqliteSessionStore(path.join(directory, 'sessions.db'));
    await save(store, sid, sessionFor('alex'));
    store.close();
}

test('a real SESSION_SECRET is used as it is and nothing is written', () => {
    const directory = temporaryDirectory();
    assert.equal(resolveSessionSecret(directory, 'my-own-long-secret'), 'my-own-long-secret');
    assert.throws(() => statSync(secretFile(directory)));
});

test('with no secret set, a private random secret is generated once and reused', () => {
    const directory = temporaryDirectory();
    for (const unset of [undefined, '', '   ']) {
        const secret = resolveSessionSecret(directory, unset);
        assert.match(secret, /^[0-9a-f]{64}$/);
        assert.equal(resolveSessionSecret(directory, undefined), secret);
    }
    assert.equal(statSync(secretFile(directory)).mode & 0o777, 0o600);
    assert.notEqual(resolveSessionSecret(temporaryDirectory(), undefined), resolveSessionSecret(directory, undefined));
});

test('publicly known example secrets are never used', () => {
    const directory = temporaryDirectory();
    const generated = resolveSessionSecret(directory, undefined);
    assert.equal(resolveSessionSecret(directory, 'super-secret'), generated);
    assert.equal(resolveSessionSecret(directory, 'super-secret-session-key'), generated);
});

test('a truncated secret file is replaced rather than trusted', () => {
    const directory = temporaryDirectory();
    writeFileSync(secretFile(directory), 'abc');
    assert.match(resolveSessionSecret(directory, undefined), /^[0-9a-f]{64}$/);
});

test('a secret that cannot be stored stops startup with a clear message', () => {
    const blocked = path.join(temporaryDirectory(), 'not-a-folder');
    writeFileSync(blocked, '');
    assert.throws(() => resolveSessionSecret(blocked, undefined), /Could not read or create the login secret/);
});

test('the store saves, updates and removes sessions, and they survive reopening', async () => {
    const file = path.join(temporaryDirectory(), 'sessions.db');
    let store = new SqliteSessionStore(file);
    assert.equal(await load(store, 'missing'), null);
    await save(store, 'one', sessionFor('alex'));
    await save(store, 'one', sessionFor('sam'));
    assert.equal((await load(store, 'one')).passport.user, 'sam');
    store.close();

    store = new SqliteSessionStore(file);
    assert.equal((await load(store, 'one')).passport.user, 'sam');
    await promisify(store.destroy.bind(store))('one');
    assert.equal(await load(store, 'one'), null);
    store.close();
});

test('expired sessions stay expired, and touch only extends a live one without changing it', async () => {
    const file = path.join(temporaryDirectory(), 'sessions.db');
    const store = new SqliteSessionStore(file);
    const touch = promisify(store.touch.bind(store));
    const past = new Date(Date.now() - 1000).toISOString();
    await save(store, 'old', sessionFor('alex', past));
    assert.equal(await load(store, 'old'), null);
    await touch('old', sessionFor('sam'));
    assert.equal(await load(store, 'old'), null);
    await touch('never-saved', sessionFor('sam'));
    assert.equal(await load(store, 'never-saved'), null);

    const db = new Database(file);
    const expiryOf = sid => db.prepare('SELECT expires FROM sessions WHERE sid = ?').get(sid).expires;
    await save(store, 'live', sessionFor('alex'));
    const before = expiryOf('live');
    await touch('live', sessionFor('sam', new Date(before + 60000).toISOString()));
    assert.equal(expiryOf('live'), before + 60000);
    assert.equal((await load(store, 'live')).passport.user, 'alex');

    store.purgeExpired();
    assert.deepEqual(db.prepare('SELECT sid FROM sessions').all(), [{ sid: 'live' }]);
    db.close();
    store.close();
});

test('a login made through express-session itself survives a store and server restart', async () => {
    const file = path.join(temporaryDirectory(), 'sessions.db');
    const start = async () => {
        const store = new SqliteSessionStore(file);
        const app = express();
        app.use(session({ secret: 'round-trip-secret', store, resave: false, saveUninitialized: false, cookie: { maxAge: 60000 } }));
        app.post('/login', (req, res) => { req.session.person = 'alex'; res.end(); });
        app.post('/logout', (req, res) => req.session.destroy(() => res.end()));
        app.get('/whoami', (req, res) => res.end(req.session.person || 'guest'));
        const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
        const url = `http://127.0.0.1:${server.address().port}`;
        return { url, stop: async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); store.close(); } };
    };
    const whoami = async (url, cookie) => (await fetch(url + '/whoami', { headers: { cookie } })).text();

    let running = await start();
    try {
        const login = await fetch(running.url + '/login', { method: 'POST' });
        const cookie = login.headers.get('set-cookie').split(';')[0];
        assert.equal(await whoami(running.url, cookie), 'alex');

        await running.stop();
        running = await start();
        assert.equal(await whoami(running.url, cookie), 'alex');

        await fetch(running.url + '/logout', { method: 'POST', headers: { cookie } });
        assert.equal(await whoami(running.url, cookie), 'guest');
    } finally {
        await running.stop();
    }
});

test('an install with no secret stays signed in across a restart and rejects forged cookies', async () => {
    const directory = installWithUser();
    let app = await bootApp(directory);
    try {
        const secret = readFileSync(secretFile(directory), 'utf8').trim();
        assert.match(secret, /^[0-9a-f]{64}$/);
        assert.ok(!app.output().includes('MemoryStore'), 'should not use the in-memory store');
        assert.ok(!app.output().includes(secret), 'the secret must not be logged');

        await addLogin(directory, 'real-login');
        assert.equal(await app.isSignedIn(), false);
        assert.equal(await app.isSignedIn(loginCookie('real-login', secret)), true);
        assert.equal(await app.isSignedIn(loginCookie('real-login', 'super-secret')), false);

        await app.stop();
        app = await bootApp(directory);
        assert.equal(readFileSync(secretFile(directory), 'utf8').trim(), secret);
        assert.equal(await app.isSignedIn(loginCookie('real-login', secret)), true);
    } finally {
        await app.stop();
    }
});

test('an install with its own SESSION_SECRET keeps using it', async () => {
    const directory = installWithUser();
    await addLogin(directory, 'real-login');
    const app = await bootApp(directory, { SESSION_SECRET: 'an-install-chose-this-value' });
    try {
        assert.equal(await app.isSignedIn(loginCookie('real-login', 'an-install-chose-this-value')), true);
        assert.throws(() => statSync(secretFile(directory)));
    } finally {
        await app.stop();
    }
});

test('an install still on the example secret moves to a generated one', async () => {
    const directory = installWithUser();
    await addLogin(directory, 'real-login');
    const app = await bootApp(directory, { SESSION_SECRET: 'super-secret-session-key' });
    try {
        assert.ok(app.output().includes('publicly known example value'));
        assert.equal(await app.isSignedIn(loginCookie('real-login', 'super-secret-session-key')), false);
        assert.equal(await app.isSignedIn(loginCookie('real-login', readFileSync(secretFile(directory), 'utf8').trim())), true);
    } finally {
        await app.stop();
    }
});
