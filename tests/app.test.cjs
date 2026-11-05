const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startFixture } = require('./support.cjs');
const { validateSession, sessionCalendar, coverUrl, artIndex, isOwnSiteRequest } = require('../dist/src/session-utils');
let fixture;
before(async () => { fixture = await startFixture(); });
after(async () => { if (fixture) await fixture.close(); });
const get = (url, user) => fetch(fixture.baseUrl + url, { headers: user ? { 'x-test-user': user } : {} });
const post = (url, data, user = 'alex') => fetch(fixture.baseUrl + url, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-test-user': user },
    body: new URLSearchParams(data)
});

test('noticeboard, guest, agenda, event, and host form render', async () => {
    for (const [url, user, expected] of [
        ['/', null, 'Connect Discord'], ['/?view=agenda', 'alex', 'My sessions'],
        ['/sessions/bug-hunt', 'alex', 'You’re on the list'],
        ['/sessions/new?date=2030-10-15', 'alex', '2030-10-15'],
        ['/?month=2030-01', null, 'Nothing on the calendar']
    ]) {
        const response = await get(url, user);
        assert.equal(response.status, 200, url);
        assert.ok((await response.text()).includes(expected), url);
    }
});
test('search and filters select sessions and preserve month navigation state', async () => {
    const response = await get('/?month=' + fixture.month + '&view=agenda&q=Helldivers&filter=mine', 'alex');
    const html = await response.text();
    const agenda = html.split('<div class="agenda">')[1].split('</div>\n')[0];
    assert.ok(agenda.includes('Friday night bug hunt'));
    assert.ok(!agenda.includes('A slower kind of Sunday'));
    assert.ok(html.includes('q=Helldivers&amp;filter=mine&amp;view=agenda'));
    const open = await get('/?month=' + fixture.month + '&filter=open');
    const openHtml = await open.text();
    const calendar = openHtml.split('<div class="calendar-days">')[1];
    assert.ok(!calendar.includes('One more round'));
    assert.ok(calendar.includes('Friday night bug hunt'));
});
test('invalid month and array query input do not crash the board', async () => {
    for (const query of ['month=2026-99', 'month[]=x', 'q[]=x', 'month=0000-00']) {
        assert.equal((await get('/?' + query)).status, 200);
    }
});
test('form rejects invalid data and preserves user input', async () => {
    const count = await fixture.prisma.gameSession.count();
    const response = await post('/sessions', { title: 'Keep my title', gameTitle: 'Test', maxPlayers: '-2', date: '2000-01-01', time: '20:00' });
    assert.equal(response.status, 400);
    const html = await response.text();
    assert.ok(html.includes('Keep my title'));
    assert.ok(html.includes('Choose a date and time in the future.'));
    assert.equal(await fixture.prisma.gameSession.count(), count);
});
test('session creation respects browser instant and reserves host spot', async () => {
    const startTimeIso = '2035-01-01T09:00:00.000Z';
    const response = await post('/sessions', { title: 'Timezone test', gameTitle: 'Chess', maxPlayers: '3', date: '2035-01-01', time: '20:00', startTimeIso, description: '', imageUrl: 'javascript:alert(1)' });
    assert.equal(response.status, 302);
    const id = response.headers.get('location').split('/').pop();
    const saved = await fixture.prisma.gameSession.findUnique({ where: { id }, include: { rsvps: true } });
    assert.equal(saved.startTime.toISOString(), startTimeIso);
    assert.equal(saved.gameCoverUrl, null);
    assert.equal(saved.rsvps.length, 1);
    assert.equal(saved.rsvps[0].userId, 'alex');
    assert.equal(saved.rsvps[0].status, 'CONFIRMED');
});
test('RSVP remains functional and host-only cancellation is enforced', async () => {
    const response = await post('/sessions/bug-hunt/rsvp', { status: 'TENTATIVE' }, 'morgan');
    assert.equal(response.status, 302);
    const rsvp = await fixture.prisma.rSVP.findUnique({ where: { sessionId_userId: { sessionId: 'bug-hunt', userId: 'morgan' } } });
    assert.equal(rsvp.status, 'TENTATIVE');
    assert.equal((await post('/sessions/bug-hunt/delete', {}, 'morgan')).status, 403);
    assert.equal((await post('/sessions/farm/delete', {}, 'sam')).status, 302);
    assert.equal(await fixture.prisma.rSVP.count({ where: { sessionId: 'farm' } }), 0);
});
test('calendar endpoint downloads valid UTC event and handles missing session', async () => {
    const response = await get('/sessions/bug-hunt/calendar.ics');
    assert.equal(response.status, 200);
    assert.ok(response.headers.get('content-type').includes('text/calendar'));
    assert.ok(response.headers.get('content-disposition').includes('attachment'));
    const text = await response.text();
    assert.ok(text.includes('BEGIN:VCALENDAR\r\n'));
    assert.ok(text.includes('SUMMARY:Friday night bug hunt'));
    assert.ok(/DTSTART:\d{8}T\d{6}Z/.test(text));
    assert.equal((await get('/sessions/missing/calendar.ics')).status, 404);
});
test('calendar escaping and UTF-8 line folding prevent injected properties', () => {
    const calendar = sessionCalendar({ id: 'test', title: 'Hello, squad;\nBEGIN:FAKE', gameTitle: '🎮'.repeat(40), description: 'Line 1\nLine 2', startTime: new Date('2030-01-01Z'), createdAt: new Date('2030-01-01Z') }, 'https://example.com');
    assert.ok(calendar.includes('Hello\\, squad\\;\\nBEGIN:FAKE'));
    assert.ok(calendar.split('\r\n').every(line => Buffer.byteLength(line) <= 75));
    assert.ok(!calendar.includes('\r\nBEGIN:FAKE'));
});
test('unsafe images and malformed form data are rejected', () => {
    assert.equal(coverUrl('javascript:alert(1)'), null);
    assert.equal(coverUrl('https://images.igdb.com/t_cover_big/test.jpg'), 'https://images.igdb.com/t_1080p/test.jpg');
    assert.ok(validateSession({ title: [], maxPlayers: '1.5', startTimeIso: 'oops' }).errors.length >= 3);
    assert.ok(validateSession(undefined).errors.length >= 3);
});
test('games without cover art keep the same colour', () => {
    assert.equal(artIndex('Helldivers 2'), artIndex('Helldivers 2'));
    for (const title of ['Helldivers 2', 'Stardew Valley', '🎮', '', null]) {
        assert.ok(Number.isInteger(artIndex(title)) && artIndex(title) >= 0 && artIndex(title) < 8);
    }
});
test('the next session leads the lobby and the queue does not repeat it', async () => {
    const html = await (await get('/')).text();
    const hero = html.split('<header class="lobby-hero">')[1].split('</header>')[0];
    assert.ok(hero.includes('Friday night bug hunt'));
    assert.ok(hero.includes('2 of 4 seats taken'));
    const queue = html.split('<section class="up-next"')[1].split('</section>')[0];
    assert.ok(!queue.includes('Friday night bug hunt'));
    assert.ok(queue.includes('One more round'));
});

const person = 'alex';
const seatedSession = (id, maxPlayers, players) => fixture.prisma.gameSession.create({ data: {
    id, title: id, gameTitle: 'Test game', description: '', maxPlayers, creatorId: person,
    startTime: new Date(Date.now() + 1000 * 60 * 60 * 24 * 3),
    rsvps: { create: players.map(userId => ({ userId, status: 'CONFIRMED' })) }
} });
const rsvpOf = (sessionId, userId) => fixture.prisma.rSVP.findUnique({ where: { sessionId_userId: { sessionId, userId } } });

test('requests from other sites cannot change anything', async () => {
    await seatedSession('cross-site', 4, ['alex']);
    const send = site => fetch(fixture.baseUrl + '/sessions/cross-site/delete', {
        method: 'POST', redirect: 'manual',
        headers: { 'x-test-user': 'alex', 'sec-fetch-site': site }
    });
    assert.equal((await send('cross-site')).status, 403);
    assert.equal((await send('same-site')).status, 403);
    assert.ok(await fixture.prisma.gameSession.findUnique({ where: { id: 'cross-site' } }));
    assert.equal((await send('same-origin')).status, 302);
    assert.equal(await fixture.prisma.gameSession.findUnique({ where: { id: 'cross-site' } }), null);
});
test('signing out needs a POST, so a link or image cannot do it', async () => {
    assert.equal((await get('/logout', 'alex')).status, 404);
    assert.equal((await post('/logout', {})).status, 302);
    assert.ok((await (await get('/', 'alex')).text()).includes('action="/logout" method="POST"'));
});
test('a full session refuses another confirmed player but still takes a maybe', async () => {
    await seatedSession('full-web', 2, ['alex', 'sam']);
    const refused = await post('/sessions/full-web/rsvp', { status: 'CONFIRMED' }, 'jules');
    assert.equal(refused.headers.get('location'), '/sessions/full-web?error=full');
    assert.equal(await rsvpOf('full-web', 'jules'), null);
    assert.ok((await (await get('/sessions/full-web?error=full', 'jules')).text()).includes('This session is full'));
    assert.match(await (await get('/sessions/full-web', 'jules')).text(), /value="CONFIRMED"[^>]* disabled/);

    await post('/sessions/full-web/rsvp', { status: 'TENTATIVE' }, 'jules');
    assert.equal((await rsvpOf('full-web', 'jules')).status, 'TENTATIVE');
    // Someone who already has a seat can confirm again, and giving a seat up frees it.
    assert.ok((await post('/sessions/full-web/rsvp', { status: 'CONFIRMED' }, 'sam')).headers.get('location').endsWith('/sessions/full-web'));
    await post('/sessions/full-web/rsvp', { status: 'DECLINED' }, 'sam');
    await post('/sessions/full-web/rsvp', { status: 'CONFIRMED' }, 'jules');
    assert.equal((await rsvpOf('full-web', 'jules')).status, 'CONFIRMED');
});
test('two people racing for the last seat cannot both get it', async () => {
    const { saveRsvp } = require('../dist/src/rsvp');
    await seatedSession('race', 2, ['alex']);
    const results = await Promise.all(['sam', 'jules', 'morgan'].map(userId => saveRsvp('race', userId, 'CONFIRMED')));
    assert.deepEqual([...results].sort(), ['full', 'full', 'saved']);
    assert.equal(await fixture.prisma.rSVP.count({ where: { sessionId: 'race', status: 'CONFIRMED' } }), 2);
});
test('an RSVP with no form data does not crash, and a missing session is a 404', async () => {
    const empty = await fetch(fixture.baseUrl + '/sessions/bug-hunt/rsvp', { method: 'POST', redirect: 'manual', headers: { 'x-test-user': 'alex' } });
    assert.equal(empty.status, 302);
    assert.equal((await post('/sessions/not-a-session/rsvp', { status: 'CONFIRMED' })).status, 404);
});

const buttonClick = (customId, userId, overrides = {}) => {
    const replies = [];
    return { replies, interaction: {
        isButton: () => true, customId,
        user: { id: userId, username: userId, avatar: null },
        deferReply: async () => {},
        editReply: async message => { replies.push(message); },
        ...overrides
    } };
};
test('a failed Discord reply cannot crash the app', async () => {
    const { handleInteraction } = require('../dist/src/bot');
    const log = console.error;
    console.error = () => {};
    try {
        const failing = async () => { throw new Error('Unknown interaction'); };
        // The first reply fails, then telling the user about it fails as well.
        const { interaction } = buttonClick('confirm_bug-hunt', 'alex', { deferReply: failing, editReply: failing });
        await assert.doesNotReject(handleInteraction(interaction));
    } finally {
        console.error = log;
    }
});
test('Discord buttons respect the player limit and name a deleted session', async () => {
    const { handleInteraction } = require('../dist/src/bot');
    await seatedSession('full-bot', 1, ['alex']);
    const full = buttonClick('confirm_full-bot', 'sam');
    await handleInteraction(full.interaction);
    assert.match(full.replies[0], /full/);
    assert.equal(await rsvpOf('full-bot', 'sam'), null);

    const maybe = buttonClick('tentative_full-bot', 'sam');
    await handleInteraction(maybe.interaction);
    assert.equal((await rsvpOf('full-bot', 'sam')).status, 'TENTATIVE');

    const gone = buttonClick('confirm_not-a-session', 'sam');
    await handleInteraction(gone.interaction);
    assert.match(gone.replies[0], /no longer exists/);
});
test('cancelling deletes first, and tidies up the channel the post went to', async () => {
    const { client } = require('../dist/src/bot');
    await seatedSession('cancel-me', 4, ['alex']);
    await fixture.prisma.gameSession.update({ where: { id: 'cancel-me' }, data: { discordChannelId: 'saved-channel', discordMessageId: 'post' } });
    const fetchChannel = client.channels.fetch;
    const seen = [];
    client.channels.fetch = async id => {
        seen.push({ id, stillSaved: !!(await fixture.prisma.gameSession.findUnique({ where: { id: 'cancel-me' } })) });
        return { messages: { fetch: async () => ({ delete: async () => {} }) }, send: async () => ({ delete: async () => {} }) };
    };
    process.env.DISCORD_CHANNEL_ID = 'newer-channel';
    try {
        assert.equal((await post('/sessions/cancel-me/delete', {})).status, 302);
    } finally {
        client.channels.fetch = fetchChannel;
        process.env.DISCORD_CHANNEL_ID = '';
    }
    assert.deepEqual(seen, [{ id: 'saved-channel', stillSaved: false }]);
});
test('a session outside the grid is still sent, so the browser can place it by local day', async () => {
    const html = await (await get('/?month=' + fixture.month)).text();
    assert.match(html, /class="calendar-day [^"]*" data-date="\d{4}-\d{2}-\d{2}"/);
    assert.match(html, /class="calendar-event [^"]*" data-start="\d{4}-\d{2}-\d{2}T[^"]+Z"/);
    const nextMonth = new Date(fixture.startTime); nextMonth.setDate(1); nextMonth.setMonth(nextMonth.getMonth() + 1);
    const first = new Date(nextMonth); first.setDate(first.getDate() - first.getDay());
    await seatedSession('edge-of-grid', 4, ['alex']);
    const dayBefore = new Date(first); dayBefore.setDate(dayBefore.getDate() - 1); dayBefore.setHours(23, 30, 0, 0);
    await fixture.prisma.gameSession.update({ where: { id: 'edge-of-grid' }, data: { startTime: dayBefore } });
    const month = nextMonth.getFullYear() + '-' + String(nextMonth.getMonth() + 1).padStart(2, '0');
    const edge = await (await get('/?month=' + month)).text();
    const extra = edge.split('<div class="calendar-extra" hidden>')[1].split('</div>')[0];
    assert.ok(extra.includes('edge-of-grid'));
    await fixture.prisma.gameSession.delete({ where: { id: 'edge-of-grid' } });
});
test('covers are only accepted from the IGDB image host', () => {
    assert.equal(coverUrl('https://images.igdb.com/igdb/image/upload/t_1080p/abc.jpg'), 'https://images.igdb.com/igdb/image/upload/t_1080p/abc.jpg');
    for (const url of ['https://evil.example/a.png', 'http://images.igdb.com/a.jpg', 'https://images.igdb.com.evil.example/a.jpg', 'https://evil.example/images.igdb.com/a.jpg']) {
        assert.equal(coverUrl(url), null, url);
    }
    const { values } = validateSession({ imageUrl: 'https://evil.example/a.png' });
    assert.equal(values.imageUrl, '');
});
test('over plain http, where browsers send no Sec-Fetch-Site, Origin decides', async () => {
    await seatedSession('over-http', 4, ['alex']);
    const port = new URL(fixture.baseUrl).port;
    const send = origin => fetch(fixture.baseUrl + '/sessions/over-http/rsvp', {
        method: 'POST', redirect: 'manual',
        headers: { 'x-test-user': 'sam', origin, 'content-type': 'application/x-www-form-urlencoded' },
        body: 'status=CONFIRMED'
    });
    for (const origin of [`http://127.0.0.1:${Number(port) + 1}`, 'http://evil.example', 'https://127.0.0.1.evil.example', 'null']) {
        assert.equal((await send(origin)).status, 403, origin);
        assert.equal(await rsvpOf('over-http', 'sam'), null, origin);
    }
    assert.equal((await send(`http://127.0.0.1:${port}`)).status, 302);
    assert.equal((await rsvpOf('over-http', 'sam')).status, 'CONFIRMED');
});
test('the own-site check handles proxies and its fallbacks', () => {
    const base = 'https://f2p.example.com/';
    // A proxy that rewrites Host is still recognised through BASE_URL.
    assert.equal(isOwnSiteRequest({ origin: 'https://f2p.example.com', host: 'freetoplay:3000' }, base), true);
    // The same name on another scheme or port is a different site.
    assert.equal(isOwnSiteRequest({ origin: 'http://f2p.example.com', host: 'freetoplay:3000' }, base), false);
    assert.equal(isOwnSiteRequest({ origin: 'https://f2p.example.com:8443', host: 'freetoplay:3000' }, base), false);
    // Sec-Fetch-Site wins when the browser sends it, even if Origin would pass.
    assert.equal(isOwnSiteRequest({ site: 'same-site', origin: 'https://f2p.example.com', host: 'f2p.example.com' }, base), false);
    assert.equal(isOwnSiteRequest({ site: 'same-origin' }, base), true);
    // Broken values are refused rather than crashing, including a missing or invalid BASE_URL.
    assert.equal(isOwnSiteRequest({ origin: 'not a url', host: 'a' }, base), false);
    assert.equal(isOwnSiteRequest({ origin: 'http://other', host: 'a' }), false);
    assert.equal(isOwnSiteRequest({ origin: 'http://other', host: 'a' }, 'nonsense'), false);
    // No browser page sends neither header, so there is nothing to forge.
    assert.equal(isOwnSiteRequest({ host: 'a' }, base), true);
});
