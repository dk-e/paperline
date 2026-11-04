import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';
import { PDFDocument, StandardFonts, degrees } from 'pdf-lib';

let context: BrowserContext, page: Page;
const text = 'Copy this PDF text.';

test.beforeAll(async () => {
  const extensionPath = path.resolve('dist');
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  page = await context.newPage();
  await page.goto(`chrome-extension://${worker.url().split('/')[2]}/index.html`);
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  for (const rotation of [0, 90, 180, 270]) {
    const sheet = pdf.addPage([400, 400]);
    sheet.setCropBox(20, 20, 360, 360);
    sheet.setRotation(degrees(rotation));
    sheet.drawText(text, { x: 60, y: 300, size: 20, font });
  }
  await page.getByTestId('file-input').setInputFiles({ name: 'selectable.pdf', mimeType: 'application/pdf', buffer: Buffer.from(await pdf.save()) });
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
});
test.afterAll(async () => { await context?.close(); });

async function selectText(index: number) {
  const sheet = page.locator('.pdf-page').nth(index);
  await sheet.scrollIntoViewIfNeeded();
  const line = sheet.locator('.pdf-text-layer span').filter({ hasText: text });
  await expect(line).toHaveCount(1);
  const box = (await line.boundingBox())!;
  // Drag along the text baseline in each page's reading direction.
  const middleX = box.x + box.width / 2, middleY = box.y + box.height / 2;
  const starts = [[box.x + 1, middleY], [middleX, box.y + 1], [box.x + box.width - 1, middleY], [middleX, box.y + box.height - 1]];
  const ends = [[box.x + box.width - 1, middleY], [middleX, box.y + box.height - 1], [box.x + 1, middleY], [middleX, box.y + 1]];
  await page.mouse.move(starts[index][0], starts[index][1]);
  await page.mouse.down();
  await page.mouse.move(ends[index][0], ends[index][1], { steps: 20 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(text);
}

async function assertCopied() {
  await page.keyboard.press('Control+c');
  // Pasting into a real input checks native clipboard behavior without a
  // synthetic copy event or a clipboard permission grant.
  await page.evaluate(() => {
    const input = document.createElement('textarea');
    input.id = 'clipboard-check';
    input.style.cssText = 'position:fixed;top:60px;left:0;z-index:200';
    document.body.append(input); input.focus();
  });
  await page.keyboard.press('Control+v');
  await expect(page.locator('#clipboard-check')).toHaveValue(text);
  await page.locator('#clipboard-check').evaluate(el => el.remove());
}

test('selects PDF text with the mouse and copies it to the clipboard at different zoom levels', async () => {
  for (const zoom of ['75', '150']) {
    await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption(zoom);
    await selectText(0);
    await assertCopied();
  }
  await expect(page.locator('.annotation')).toHaveCount(0);
});

test('keeps text selectable on cropped and rotated pages', async () => {
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('100');
  for (const index of [1, 2, 3]) await selectText(index);
});


test('selects and copies existing PDF text naturally while any editing tool is active', async () => {
  for (const tool of ['Text tool', 'Highlight tool', 'Draw tool']) {
    await page.getByRole('button', { name: tool, exact: true }).click();
    await selectText(0);
    await assertCopied();
    await expect(page.locator('.annotation')).toHaveCount(0);
    await expect(page.getByRole('button', { name: tool, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
});

test('selects visible sample text using page coordinates, including on a high-DPI display', async () => {
  const display = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true,
    viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2,
    args: [`--disable-extensions-except=${path.resolve('dist')}`, `--load-extension=${path.resolve('dist')}`],
  });
  try {
    const worker = display.serviceWorkers()[0] ?? await display.waitForEvent('serviceworker');
    const tab = await display.newPage();
    await tab.goto(`chrome-extension://${worker.url().split('/')[2]}/index.html`);
    await expect(tab).toHaveTitle('paperline');
    expect(await worker.evaluate(() => ({ name: chrome.runtime.getManifest().name, version: chrome.runtime.getManifest().version }))).toEqual({ name: 'paperline', version: '1.4.0' });
    await tab.getByRole('button', { name: /Try a sample PDF/ }).click();
    await expect(tab.locator('.busy-overlay')).toHaveCount(0);
    await tab.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('100');
    const sheet = tab.locator('.pdf-page').first();
    await sheet.scrollIntoViewIfNeeded();
    await expect(sheet.locator('.pdf-text-layer')).toContainText('Good things start');
    const box = (await sheet.boundingBox())!;
    // Coordinates come from the visible sample PDF artwork, independently of
    // the text layer's DOM bounds. Selection must match the rendered ink.
    const fixture = await PDFDocument.create();
    const font = await fixture.embedFont(StandardFonts.TimesRoman);
    const width = font.widthOfTextAtSize('Good things start', 42);
    await tab.mouse.move(box.x + 58.5, box.y + 145);
    await tab.mouse.down();
    await tab.mouse.move(box.x + 58 + width - 0.5, box.y + 145, { steps: 25 });
    await tab.mouse.up();
    await expect.poll(() => tab.evaluate(() => getSelection()?.toString())).toBe('Good things start');
    await tab.keyboard.press('Control+c');
    await tab.evaluate(() => {
      const input = document.createElement('textarea'); input.id = 'paste';
      input.style.cssText = 'position:fixed;top:60px;left:0;z-index:200';
      document.body.append(input); input.focus();
    });
    await tab.keyboard.press('Control+v');
    await expect(tab.locator('#paste')).toHaveValue('Good things start');
  } finally { await display.close(); }
});
