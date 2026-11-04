import { test, expect, chromium, type BrowserContext, type Worker } from '@playwright/test';
import { createServer, type Server } from 'node:http';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomBytes } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';

let context: BrowserContext, worker: Worker, server: Server, base: string, editorUrl: string, profile: string;
const pdf = await readFile('public/sample.pdf');
const largeDocument = await PDFDocument.load(pdf);
await largeDocument.attach(randomBytes(400000), 'fixture.bin');
const largePdf = Buffer.from(await largeDocument.save());
const requests: string[] = [];
const authRequests: { cookie: string; referer: string; site: string }[] = [];
const moodlePath = '/pluginfile.php/8946269/mod_resource/content/1/Lab%205%20-%20Subnets%20and%20VLANs.pdf';
const launch = (directory: string) => chromium.launchPersistentContext(directory, {
  channel: 'chromium', headless: true, acceptDownloads: true,
  viewport: { width: 1280, height: 900 },
  args: [`--disable-extensions-except=${path.resolve('dist')}`, `--load-extension=${path.resolve('dist')}`],
});
const background = (c: BrowserContext) => c.serviceWorkers()[0] ? Promise.resolve(c.serviceWorkers()[0]) : c.waitForEvent('serviceworker');

test.beforeAll(async () => {
  server = createServer((req, res) => {
    const url = new URL(req.url!, 'http://localhost'); requests.push(req.url!);
    if (url.pathname === '/course') {
      res.setHeader('Content-Type', 'text/html');
      res.setHeader('Set-Cookie', 'moodle-session=fixture; HttpOnly; SameSite=Strict; Path=/');
      res.end(`<a href="${moodlePath}">Moodle lab PDF</a><a href="${moodlePath}" target="_blank">Moodle lab in new tab</a><a href="${moodlePath}?large=1">Large Moodle PDF</a><a href="/mod/resource/view.php?id=123">Moodle resource redirect</a><a href="/mod/resource/view.php?id=123&embed=1">Moodle resource embed</a>`);
    } else if (url.pathname === '/mod/resource/view.php') {
      if (url.searchParams.has('embed')) { res.setHeader('Content-Type', 'text/html'); res.end(`<object type="application/pdf" data="${moodlePath}"></object>`); }
      else { res.writeHead(302, { Location: moodlePath }); res.end(); }
    } else if (url.pathname === moodlePath) {
      authRequests.push({ cookie: req.headers.cookie || '', referer: req.headers.referer || '', site: String(req.headers['sec-fetch-site'] || '') });
      if (!req.headers.cookie?.includes('moodle-session=fixture') || !req.headers.referer?.endsWith('/course')) {
        res.setHeader('Content-Type', 'text/html'); res.end('<h1>Sign in to Moodle</h1>');
      } else { res.setHeader('Content-Type', 'application/pdf'); res.end(url.searchParams.has('large') ? largePdf : pdf); }
    } else if (url.pathname === '/embedded') {
      res.setHeader('Content-Type', 'text/html'); res.end('<iframe src="/report.pdf" width="900" height="700"></iframe>');
    } else if (url.pathname === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<title>Download test</title><a href="/report.pdf">PDF link</a><a href="${base.replace('127.0.0.1', 'localhost')}/report.pdf">External PDF link</a><a href="/binary" download="downloaded.pdf">Download PDF</a><a href="/note.txt" download>Download text</a><button id="blob">Download a generated PDF</button><script>document.querySelector('#blob').onclick=async()=>{const b=await(await fetch('/blob-content')).blob();const a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='generated.pdf';a.click()};</script>`);
    } else if (url.pathname === '/note.txt') { res.setHeader('Content-Type', 'text/plain'); res.end('Ordinary download'); }
    else {
      res.setHeader('Content-Type', url.pathname === '/binary' ? 'application/octet-stream' : url.pathname === '/wrong.pdf' ? 'text/plain' : 'application/pdf');
      if (url.pathname === '/binary' || url.pathname === '/attachment') res.setHeader('Content-Disposition', 'attachment; filename="downloaded.pdf"');
      if (url.pathname === '/opaque') res.setHeader('Content-Disposition', "inline; filename*=UTF-8''caf%C3%A9.pdf");
      res.end(pdf);
    }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number }; base = `http://127.0.0.1:${address.port}`;
  profile = await mkdtemp(path.join(tmpdir(), 'paperline-auto-test-'));
  // Unpacked extensions in Chrome for Testing receive local-file access.
  context = await launch(profile); worker = await background(context);
  const id = worker.url().split('/')[2]; editorUrl = `chrome-extension://${id}/index.html`;
  // Use Chrome's real filenames rather than Playwright's default GUID rename.
  // The extension must identify application/octet-stream downloads by filename.
  const cdp = await context.browser()!.newBrowserCDPSession();
  await cdp.send('Browser.setDownloadBehavior', { behavior: 'allow', downloadPath: path.join(profile, 'downloads'), eventsEnabled: true });
  await expect.poll(() => worker.evaluate(() => chrome.extension.isAllowedFileSchemeAccess())).toBe(true);
  await expect.poll(() => worker.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).length)).toBe(5);
});
test.afterAll(async () => {
  await context?.close();
  await new Promise<void>(resolve => server?.close(() => resolve()));
  if (profile) await rm(profile, { recursive: true, force: true });
});

async function assertLoaded(page: import('@playwright/test').Page) {
  await expect(page.locator('.pdf-page')).toHaveCount(2);
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  expect(page.url()).toBe(editorUrl);
}

test('automatically opens inline PDF links in a new tab, with no fetch loop', async () => {
  const page = await context.newPage();
  const start = requests.length;
  await page.goto(base);
  const opened = context.waitForEvent('page');
  await page.getByRole('link', { name: 'PDF link', exact: true }).click();
  const editor = await opened; await assertLoaded(editor);
  expect(page.url()).toBe(base + '/');
  await editor.close();
  expect(requests.slice(start).filter(r => r === '/report.pdf')).toHaveLength(1);
  await page.close();
});

test('opens cross-origin PDF links in a new tab without replacing the source page', async () => {
  const page = await context.newPage(); await page.goto(base);
  const opened = context.waitForEvent('page');
  await page.getByRole('link', { name: 'External PDF link', exact: true }).click();
  const editor = await opened; await assertLoaded(editor);
  expect(page.url()).toBe(base + '/');
  await editor.close(); await page.close();
});

test('recognizes MIME-only and attachment PDFs and preserves their full query strings', async () => {
  for (const route of ['/opaque?token=one%26two&filename=thing.pdf&source=wrong', '/attachment?x=1&y=2']) {
    const page = await context.newPage();
    await page.goto(base + route);
    await assertLoaded(page);
    expect(requests).toContain(route);
    if (route.startsWith('/opaque')) await expect(page.locator('.document-name')).toContainText('café.pdf');
    await page.close();
  }
});

test('opens completed PDF downloads from the actual local file, once', async () => {
  const page = await context.newPage(); await page.goto(base);
  const opened = context.waitForEvent('page');
  const downloaded = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download PDF', exact: true }).click();
  const download = await downloaded;
  expect(await download.failure()).toBeNull();
  const editor = await opened; await assertLoaded(editor);
  await expect(editor.locator('.document-name')).toContainText('downloaded.pdf');
  const downloads = await worker.evaluate(() => chrome.downloads.search({ filenameRegex: 'downloaded\\.pdf$' }));
  expect(downloads.length).toBeGreaterThan(0);
  // The request is made once to download the file; the editor reads file://.
  expect(requests.filter(r => r === '/binary')).toHaveLength(1);
  await editor.close(); await page.close();
});

test('opens blob-generated PDF downloads using downloaded bytes', async () => {
  const page = await context.newPage(); await page.goto(base);
  const opened = context.waitForEvent('page');
  await page.getByRole('button', { name: 'Download a generated PDF' }).click();
  const editor = await opened; await assertLoaded(editor);
  await expect(editor.locator('.document-name')).toContainText('generated.pdf');
  await editor.close(); await page.close();
});

test('automatically handles local PDF navigation', async () => {
  const page = await context.newPage();
  await page.goto(pathToFileURL(path.resolve('public/sample.pdf')).href);
  await assertLoaded(page);
  await page.close();
});

test('respects both opt-outs, leaves non-PDF downloads alone, and does not reopen exports', async () => {
  const page = await context.newPage(); await page.goto(base);
  const before = context.pages().length;
  const textDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download text', exact: true }).click();
  expect(await (await textDownload).failure()).toBeNull();
  expect(context.pages()).toHaveLength(before);

  const options = await context.newPage(); await options.goto(editorUrl.replace('index.html', 'options.html'));
  await options.getByRole('switch', { name: /^Open PDF links automatically/ }).uncheck();
  await expect(options.getByRole('status')).toContainText('Saved.');
  expect(await worker.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).length)).toBe(0);
  // A real PDF navigation now stays with Chrome's built-in viewer.
  await page.goto(base + '/report.pdf');
  expect(page.url()).toBe(base + '/report.pdf');
  await expect(page.locator('.pdf-page')).toHaveCount(0);
  await page.goto(base);
  await options.getByRole('switch', { name: /^Open completed PDF downloads/ }).uncheck();
  await expect(options.getByRole('switch', { name: /^Open completed PDF downloads/ })).toBeEnabled();
  const disabledDownload = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Download PDF', exact: true }).click();
  const completed = await disabledDownload; expect(await completed.failure()).toBeNull();
  // Await the worker's handling of the completed event, rather than sleeping.
  await worker.evaluate(async () => { await chrome.downloads.search({ state: 'complete' }); });
  expect(context.pages()).toHaveLength(before + 1);

  await options.getByRole('switch', { name: /^Open PDF links automatically/ }).check();
  await expect.poll(() => worker.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).length)).toBe(5);
  await options.getByRole('switch', { name: /^Open completed PDF downloads/ }).check();
  await expect(options.getByRole('switch', { name: /^Open completed PDF downloads/ })).toBeEnabled();
  await page.goto(base + '/report.pdf'); await assertLoaded(page);
  const count = context.pages().length;
  const exported = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Save PDF/ }).click();
  expect(await (await exported).failure()).toBeNull();
  const ownDownloads = await worker.evaluate(() => chrome.downloads.search({}));
  expect(ownDownloads.some(item => item.url.startsWith('blob:' + editorUrl.replace('index.html', '')))).toBe(true);
  expect(context.pages()).toHaveLength(count);
  await options.close(); await page.close();
});

test('explains missing file access with a direct path to Chrome settings', async () => {
  const isolated = await launch('');
  try {
    const bg = await background(isolated), id = bg.url().split('/')[2];
    const page = await isolated.newPage();
    await page.addInitScript(() => { chrome.extension.isAllowedFileSchemeAccess = async () => false; });
    const source = pathToFileURL(path.resolve('public/sample.pdf')).href;
    await page.goto(`chrome-extension://${id}/index.html?source=${encodeURIComponent(source)}`);
    await expect(page.getByText('One Chrome setting to open this PDF', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Open extension details', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Try again', exact: true })).toBeVisible();
  } finally { await isolated.close(); }
});


test('opens a signed-in Moodle link using its original cookies and referrer', async () => {
  const page = await context.newPage(); await page.goto(base + '/course');
  const start = authRequests.length;
  const opened = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Moodle lab PDF', exact: true }).click();
  const editor = await opened; await assertLoaded(editor);
  expect(page.url()).toBe(base + '/course');
  await expect(editor.locator('.document-name')).toContainText('Lab 5 - Subnets and VLANs.pdf');
  expect(authRequests.slice(start)).toHaveLength(1);
  expect(authRequests.at(-1)!.cookie).toContain('moodle-session=fixture');
  expect(authRequests.at(-1)!.referer).toBe(base + '/course');
  expect(authRequests.at(-1)!.site).toBe('same-origin');
  await editor.close(); await page.close();
});

test('copies visible PDF text immediately after opening a Moodle link in a new tab', async () => {
  const page = await context.newPage(); await page.goto(base + '/course');
  const opened = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Moodle lab PDF', exact: true }).click();
  const editor = await opened; await assertLoaded(editor);
  expect(page.url()).toBe(base + '/course');
  // No toolbar interaction: double-click a word straight from the PDF.
  const heading = editor.locator('.pdf-text-layer span').filter({ hasText: /^Good things start$/ });
  await expect(heading).toHaveCount(1);
  await heading.dblclick({ position: { x: 20, y: 15 } });
  await expect.poll(() => editor.evaluate(() => getSelection()?.toString())).toBe('Good');
  await editor.keyboard.press('Control+c');
  await editor.evaluate(() => {
    const input = document.createElement('textarea'); input.id = 'paste-check';
    input.style.cssText = 'position:fixed;top:60px;left:0;z-index:200';
    document.body.append(input); input.focus();
  });
  await editor.keyboard.press('Control+v');
  await expect(editor.locator('#paste-check')).toHaveValue('Good');
  await editor.close(); await page.close();
});

test('preserves authenticated target=_blank links without replacing the course page', async () => {
  const page = await context.newPage(); await page.goto(base + '/course');
  const opened = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Moodle lab in new tab', exact: true }).click();
  const editor = await opened; await assertLoaded(editor);
  expect(page.url()).toBe(base + '/course');
  await editor.close(); await page.close();
});

test('opens PDF URLs even with incorrect headers and embedded PDF frames', async () => {
  const page = await context.newPage(); await page.goto(base + '/wrong.pdf'); await assertLoaded(page);
  await page.goto(base + '/embedded');
  await expect(page.frameLocator('iframe').locator('.pdf-page')).toHaveCount(2);
  expect(page.url()).toBe(base + '/embedded');
  await page.close();
});

test('recovers when declarative redirects are missing instead of staying in Chrome viewer', async () => {
  await worker.evaluate(async () => {
    const rules = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: rules.map(rule => rule.id) });
  });
  const page = await context.newPage();
  await page.goto(base + '/report.pdf');
  await assertLoaded(page);
  await page.evaluate(() => chrome.runtime.sendMessage({ type: 'paperline:sync-rules' }));
  await expect.poll(() => worker.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).length)).toBe(5);
  await page.close();
});

test('shows the installed version and repairs automatic opening from settings', async () => {
  const page = await context.newPage(); await page.goto(editorUrl.replace('index.html', 'options.html'));
  await expect(page.getByText('Paperline 1.4.0.', { exact: false })).toBeVisible();
  await page.getByRole('switch', { name: /^Open PDF links automatically/ }).uncheck();
  await expect(page.getByText('Automatic PDF links are off', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Enable & repair automatic opening', exact: true }).click();
  await expect(page.getByText('Automatic opening is ready', { exact: true })).toBeVisible();
  await expect(page.getByRole('switch', { name: /^Open PDF links automatically/ })).toBeChecked();
  await expect(page.getByRole('switch', { name: /^Open completed PDF downloads/ })).toBeChecked();
  await page.close();
});

test('follows Moodle resource redirects and embedded resource pages in the signed-in context', async () => {
  for (const label of ['Moodle resource redirect', 'Moodle resource embed']) {
    const page = await context.newPage(); await page.goto(base + '/course');
    const opened = context.waitForEvent('page');
    await page.getByRole('link', { name: label, exact: true }).click();
    const editor = await opened; await assertLoaded(editor);
    expect(page.url()).toBe(base + '/course');
    await expect(editor.locator('.document-name')).toContainText('Lab 5 - Subnets and VLANs.pdf');
    expect(authRequests.at(-1)!.referer).toBe(base + '/course');
    await editor.close(); await page.close();
  }
});

test('transfers an authenticated PDF across multiple message chunks', async () => {
  const page = await context.newPage(); await page.goto(base + '/course');
  const opened = context.waitForEvent('page');
  await page.getByRole('link', { name: 'Large Moodle PDF', exact: true }).click();
  const editor = await opened; await assertLoaded(editor);
  expect(page.url()).toBe(base + '/course');
  await expect(editor.locator('.document-name')).toContainText('Lab 5 - Subnets and VLANs.pdf');
  await editor.close(); await page.close();
});

test('offers a site-access grant instead of silently falling back to Chrome', async () => {
  const page = await context.newPage();
  await page.addInitScript(() => {
    const contains = chrome.permissions.contains.bind(chrome.permissions);
    let withheld = true;
    chrome.permissions.contains = async permissions => withheld ? false : contains(permissions);
    chrome.permissions.request = async () => { withheld = false; return true; };
  });
  await page.goto(editorUrl + '?source=' + encodeURIComponent(base + '/report.pdf'));
  await expect(page.getByText('Allow Paperline on this site', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Allow site & open', exact: true }).click();
  await assertLoaded(page);
  await page.close();
});

test('opens an HTTP download even when local-file access is switched off', async () => {
  await worker.evaluate(() => {
    globalThis.__originalFileAccess = chrome.extension.isAllowedFileSchemeAccess;
    chrome.extension.isAllowedFileSchemeAccess = async () => false;
  });
  const page = await context.newPage();
  try {
    await page.goto(base);
    const opened = context.waitForEvent('page');
    const downloaded = page.waitForEvent('download');
    await page.getByRole('link', { name: 'Download PDF', exact: true }).click();
    expect(await (await downloaded).failure()).toBeNull();
    const editor = await opened; await assertLoaded(editor);
    await expect(editor.locator('.document-name')).toContainText('downloaded');
    await editor.close();
  } finally {
    await worker.evaluate(() => { chrome.extension.isAllowedFileSchemeAccess = globalThis.__originalFileAccess; });
    await page.close();
  }
});

test('keeps automatic PDF opening after a full browser restart', async () => {
  await context.close();
  context = await launch(profile); worker = await background(context);
  await expect.poll(() => worker.evaluate(async () => (await chrome.declarativeNetRequest.getDynamicRules()).length)).toBe(5);
  const page = await context.newPage(); await page.goto(base + '/opaque?file=lab&version=2'); await assertLoaded(page);
  await page.close();
});
