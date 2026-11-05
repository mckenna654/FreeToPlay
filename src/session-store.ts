import { randomBytes } from 'crypto';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import session from 'express-session';

// Values that have shipped in this repository, so anyone can read them. A cookie signed
// with one of these could be forged, so they count as "no secret set".
const PUBLIC_SECRETS = new Set(['super-secret', 'super-secret-session-key']);
const GENERATED_SECRET_LENGTH = 64;
const FALLBACK_TTL_MS = 1000 * 60 * 60 * 24;
const PURGE_INTERVAL_MS = 1000 * 60 * 60;

function loadOrCreateSecret(file: string): string {
    try {
        if (fs.existsSync(file)) {
            const saved = fs.readFileSync(file, 'utf8').trim();
            if (saved.length >= GENERATED_SECRET_LENGTH) return saved;
        }
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const secret = randomBytes(GENERATED_SECRET_LENGTH / 2).toString('hex');
        // Write then rename, so a crash cannot leave a half-written secret behind.
        const temporary = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(temporary, `${secret}\n`, { mode: 0o600 });
        fs.renameSync(temporary, file);
        console.log(`Created a login secret at ${file}. Keep this file private.`);
        return secret;
    } catch (error) {
        throw new Error(`Could not read or create the login secret at ${file}. Make that folder writable, or set SESSION_SECRET.`, { cause: error });
    }
}

// SESSION_SECRET wins when it is a real value. Otherwise use a random secret saved next to
// the database, so installs that never set one stay secure and keep working across restarts.
export function resolveSessionSecret(dataDirectory: string, configured = process.env.SESSION_SECRET): string {
    const value = configured?.trim();
    if (value && !PUBLIC_SECRETS.has(value)) return configured as string;
    if (value) console.warn('Ignoring SESSION_SECRET because it is a publicly known example value. Using a generated secret instead.');
    return loadOrCreateSecret(path.join(dataDirectory, 'session-secret'));
}

function expiryOf(sess: session.SessionData): number {
    const expires = sess.cookie?.expires;
    return expires ? new Date(expires).getTime() : Date.now() + FALLBACK_TTL_MS;
}

// Keeps logins in their own SQLite file, so they survive restarts. It is separate from the
// Prisma database because deleting it only signs people out. It keeps SQLite's default
// journal rather than WAL, the same as the main database, because WAL is unreliable on
// network and FUSE shares such as Unraid's /mnt/user.
export class SqliteSessionStore extends session.Store {
    private db: Database.Database;
    private purgeTimer: NodeJS.Timeout;

    constructor(file: string) {
        super();
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            this.db = new Database(file);
            this.db.exec(`
                CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires INTEGER NOT NULL);
                CREATE INDEX IF NOT EXISTS sessions_expires ON sessions (expires);
            `);
            this.purgeExpired();
        } catch (error) {
            throw new Error(`Could not open the login store at ${file}. Deleting that file is safe: it only signs everyone out.`, { cause: error });
        }
        this.purgeTimer = setInterval(() => {
            try {
                this.purgeExpired();
            } catch (error) {
                console.error('Could not clear expired logins:', error);
            }
        }, PURGE_INTERVAL_MS);
        this.purgeTimer.unref();
    }

    purgeExpired() {
        this.db.prepare('DELETE FROM sessions WHERE expires <= ?').run(Date.now());
    }

    close() {
        clearInterval(this.purgeTimer);
        this.db.close();
    }

    // The callback runs outside the try, so an error it throws is not reported as a store error.
    private respond<T>(work: () => T, callback?: (error: any, value?: T) => void) {
        let value: T;
        try {
            value = work();
        } catch (error) {
            callback?.(error);
            return;
        }
        callback?.(null, value);
    }

    get(sid: string, callback: (error: any, sess?: session.SessionData | null) => void) {
        this.respond(() => {
            const row = this.db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expires > ?').get(sid, Date.now()) as { sess: string } | undefined;
            return row ? JSON.parse(row.sess) as session.SessionData : null;
        }, callback);
    }

    set(sid: string, sess: session.SessionData, callback?: (error?: any) => void) {
        this.respond(() => {
            this.db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expires) VALUES (?, ?, ?)').run(sid, JSON.stringify(sess), expiryOf(sess));
        }, callback);
    }

    destroy(sid: string, callback?: (error?: any) => void) {
        this.respond(() => {
            this.db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid);
        }, callback);
    }

    // Only moves the expiry of a live session, so a page view can neither revive an expired
    // login nor overwrite one saved by a request running alongside it.
    touch(sid: string, sess: session.SessionData, callback?: () => void) {
        this.respond(() => {
            this.db.prepare('UPDATE sessions SET expires = ? WHERE sid = ? AND expires > ?').run(expiryOf(sess), sid, Date.now());
        }, callback);
    }
}
