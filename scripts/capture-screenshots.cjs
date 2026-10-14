// Run after npm run build, with Playwright available in your environment.
// PLAYWRIGHT_MODULE_PATH and CHROME_EXECUTABLE can point to an existing install.
// Uses only temporary fixture data; never reads .env or connects to Discord.
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { startFixture } = require('../tests/support.cjs');

(async () => {
    const fixture = await startFixture();
    const output = path.resolve(__dirname, '../docs/screenshots');
    mkdirSync(output, { recursive: true });
    let browser;
    try {
        browser = await chromium.launch({
            headless: true,
            ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {})
        });
        const context = await browser.newContext({
            viewport: { width: 1440, height: 1100 },
            timezoneId: 'Australia/Sydney',
            extraHTTPHeaders: { 'x-test-user': 'alex' }
        });
        const page = await context.newPage();
        await page.goto(fixture.baseUrl + '/?month=' + fixture.month);
        await page.locator('.lobby-hero').screenshot({ path: output + '/lobby-banner.png' });
        await page.screenshot({ path: output + '/lobby.png', fullPage: true });
        await page.goto(fixture.baseUrl + '/sessions/bug-hunt');
        await page.screenshot({ path: output + '/session.png', fullPage: true });
        await page.goto(fixture.baseUrl + '/sessions/new');
        await page.getByRole('combobox').fill('Helldivers 2');
        await page.getByLabel('Session name').fill('Friday night bug hunt');
        const date = new Date(fixture.startTime);
        const friday = (5 - date.getDay() + 7) % 7;
        date.setDate(date.getDate() + friday);
        await page.getByLabel('Date', { exact: true }).fill([
            date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'),
            String(date.getDate()).padStart(2, '0')
        ].join('-'));
        await page.getByLabel('Start time').fill('20:00');
        await page.getByLabel('Details and notes').fill('A few relaxed games with the usual crew. Meet in Discord five minutes before we drop.');
        await page.getByRole('heading', { name: 'What are we playing?' }).click();
        await page.screenshot({ path: output + '/create-session.png', fullPage: true });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(fixture.baseUrl + '/');
        await page.screenshot({ path: output + '/mobile.png', fullPage: true });
        await page.goto(fixture.baseUrl + '/sessions/bug-hunt');
        await page.screenshot({ path: output + '/mobile-session.png', fullPage: true });
        console.log('Screenshots saved to ' + output);
    } finally {
        if (browser) await browser.close();
        await fixture.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
