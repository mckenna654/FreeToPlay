/** Covers only come from IGDB's image host, so a form can't make every visitor load an image from elsewhere. */
export function coverUrl(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value);
        if (url.protocol !== 'https:' || url.hostname !== 'images.igdb.com') return null;
        return url.href.replace('/t_cover_big/', '/t_1080p/');
    } catch { return null; }
}

// Whether a browser request to change something came from this app's own pages. Browsers don't
// send Sec-Fetch-Site over plain http, such as on a LAN address, so Origin covers that case. There,
// SameSite cookies treat other ports on the same address as the same site, so they can't help.
// Browsers always send Origin with a POST, so a request with neither header isn't from a browser
// page and can't be a forged request. The Host header and BASE_URL are both accepted because a
// reverse proxy may rewrite Host.
export function isOwnSiteRequest(headers: { site?: string; origin?: string; host?: string }, baseUrl?: string): boolean {
    if (headers.site) return ['same-origin', 'none'].includes(headers.site);
    if (!headers.origin) return true;
    try {
        const origin = new URL(headers.origin);
        if (origin.host === headers.host) return true;
        return !!baseUrl && origin.origin === new URL(baseUrl).origin;
    } catch {
        return false; // Includes "Origin: null", which sandboxed pages send
    }
}

// Picks a stable colour for a game without cover art. public/app.js repeats this for the live form preview.
export function artIndex(title: unknown): number {
    let hash = 7;
    for (const character of String(title ?? '')) hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
    return hash % 8;
}

export function validateSession(input: unknown, now = new Date()) {
    const body = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    const text = (key: string) => typeof body[key] === 'string' ? (body[key] as string).trim() : '';
    const values = { title: text('title'), gameTitle: text('gameTitle'), description: text('description'),
        date: text('date'), time: text('time'), maxPlayers: text('maxPlayers'), imageUrl: coverUrl(body.imageUrl) || '' };
    const startTime = new Date(text('startTimeIso') || `${values.date}T${values.time}`);
    const maxPlayers = Number(values.maxPlayers);
    const errors: string[] = [];
    if (!values.title || values.title.length > 100) errors.push('Give your session a title of 1–100 characters.');
    if (!values.gameTitle || values.gameTitle.length > 150) errors.push('Enter a game name of 1–150 characters.');
    if (values.description.length > 2000) errors.push('Keep your notes under 2,000 characters.');
    if (!Number.isInteger(maxPlayers) || maxPlayers < 1 || maxPlayers > 100) errors.push('Choose between 1 and 100 players.');
    if (!Number.isFinite(startTime.getTime()) || startTime <= now) errors.push('Choose a date and time in the future.');
    return { values, startTime, maxPlayers, errors };
}

const escapeCalendar = (text: string) => text.replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/;/g, '\\;').replace(/,/g, '\\,');
const calendarDate = (date: Date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// RFC 5545 folds content lines at 75 UTF-8 octets, without splitting characters.
function foldLine(line: string): string {
    const lines: string[] = [];
    let current = '';
    for (const char of line) {
        if (Buffer.byteLength(current + char, 'utf8') > 75) { lines.push(current); current = ' '; }
        current += char;
    }
    lines.push(current);
    return lines.join('\r\n');
}

export function sessionCalendar(session: { id: string; title: string; gameTitle: string; description: string; startTime: Date; createdAt: Date }, baseUrl: string) {
    return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//FreeToPlay//Game sessions//EN', 'CALSCALE:GREGORIAN',
        'BEGIN:VEVENT', `UID:${escapeCalendar(session.id)}@freetoplay`, `DTSTAMP:${calendarDate(session.createdAt)}`,
        `DTSTART:${calendarDate(session.startTime)}`, `SUMMARY:${escapeCalendar(session.title)}`,
        `DESCRIPTION:${escapeCalendar(`${session.gameTitle}\n\n${session.description}`)}`,
        `URL:${baseUrl.replace(/\/$/, '')}/sessions/${encodeURIComponent(session.id)}`, 'END:VEVENT', 'END:VCALENDAR', '']
        .map(foldLine).join('\r\n');
}
