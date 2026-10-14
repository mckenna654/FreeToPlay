const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startFixture } = require('./support.cjs');
const { validateSession, sessionCalendar, coverUrl } = require('../dist/src/session-utils');
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
        ['/sessions/bug-hunt', 'alex', 'You’re on the list.'],
        ['/sessions/new?date=2030-10-15', 'alex', '2030-10-15'],
        ['/?month=2030-01', null, 'No missions on the calendar.']
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
