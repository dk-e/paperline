import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PDFDocument, PDFDict, PDFName, PDFHexString } from 'pdf-lib';
import { createCanvas } from '@napi-rs/canvas';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';

let context: BrowserContext, page: Page, url: string;
test.describe.configure({ mode: 'serial' });
const errors: string[] = [];
test.beforeAll(async () => {
  const extensionPath = path.resolve('dist');
  context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, viewport: { width: 1440, height: 1000 },
    args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  url = `chrome-extension://${worker.url().split('/')[2]}/index.html`;
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await mkdir('test-results/artifacts', { recursive: true });
});
test.afterAll(async () => { await context?.close(); });

async function addText(text: string, x = 85, y = 250, pageIndex = 0) {
  await page.getByRole('button', { name: 'Text tool', exact: true }).click();
  const canvas = page.locator('.pdf-page').nth(pageIndex);
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  const baseWidth = await canvas.locator('.annotation-layer').evaluate(el => parseFloat((el as HTMLElement).style.width));
  const scale = box!.width / baseWidth;
  await canvas.click({ position: { x: x * scale, y: y * scale } });
  await page.getByRole('textbox', { name: 'Edit text box' }).fill(text);
  await page.keyboard.press('Escape');
  return page.locator('.annotation-text').last();
}
async function savePdf(name: string) {
  const event = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Save PDF/ }).click();
  const download = await event;
  const filePath = path.resolve(`test-results/artifacts/${name}.pdf`);
  await download.saveAs(filePath);
  return { filePath, bytes: new Uint8Array(await readFile(filePath)) };
}
async function render(bytes: Uint8Array, index: number, name: string) {
  const loading = pdfjs.getDocument({ data: bytes.slice(), standardFontDataUrl: path.resolve('node_modules/pdfjs-dist/standard_fonts/') + '/' });
  const pdf = await loading.promise;
  const page = await pdf.getPage(index + 1), viewport = page.getViewport({ scale: 1 });
  const canvas = createCanvas(viewport.width, viewport.height);
  await page.render({ canvas: canvas as never, viewport }).promise;
  await writeFile(`test-results/artifacts/${name}.png`, canvas.toBuffer('image/png'));
  const data = canvas.getContext('2d').getImageData(0, 0, viewport.width, viewport.height);
  await loading.destroy();
  return data;
}

test('loads as a real Chrome extension, opens a PDF, edits, formats, and saves editable text', async () => {
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Open a PDF.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/artifacts/welcome.png' });
  await page.getByRole('button', { name: /Try a sample PDF/ }).click();
  await expect(page.locator('.pdf-page')).toHaveCount(2);
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  const box = await addText('A thoughtful note.\nCafé • £42 — voilà');
  await expect(box).toContainText('A thoughtful note.');
  await page.getByRole('button', { name: 'Bold', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Font size' }).fill('18');
  await page.getByRole('button', { name: 'Use colour #3563e9', exact: true }).click();
  await expect(box).toHaveCSS('font-weight', '700');
  await expect(box).toHaveCSS('font-size', '18px');
  await expect(box).toHaveCSS('color', 'rgb(53, 99, 233)');
  await page.getByRole('button', { name: 'Select tool', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Select tool', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: 'test-results/artifacts/editor.png' });
  const saved = await savePdf('edited');
  const pdf = await PDFDocument.load(saved.bytes);
  const annot = pdf.context.lookup(pdf.getPage(0).node.Annots()!.get(0)) as PDFDict;
  expect(annot.get(PDFName.of('Subtype'))!.toString()).toBe('/FreeText');
  const data = JSON.parse((annot.get(PDFName.of('PaperlineData')) as PDFHexString).decodeText());
  expect(data.text).toBe('A thoughtful note.\nCafé • £42 — voilà');
  expect(data.bold).toBe(true);
  await render(saved.bytes, 0, 'exported-page');
  await page.getByTestId('file-input').setInputFiles(saved.filePath);
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await expect(page.locator('.annotation-text')).toHaveCount(1);
  await page.locator('.annotation-text').dblclick();
  await expect(page.getByRole('textbox', { name: 'Edit text box' })).toHaveValue('A thoughtful note.\nCafé • £42 — voilà');
  await page.getByRole('textbox', { name: 'Edit text box' }).fill('Still editable.');
  // Saving while the textarea has focus must include the latest keystrokes.
  const resaved = await savePdf('re-edited');
  const pdf2 = await PDFDocument.load(resaved.bytes);
  expect(pdf2.getPage(0).node.Annots()!.size()).toBe(1);
  const annotation2 = pdf2.context.lookup(pdf2.getPage(0).node.Annots()!.get(0)) as PDFDict;
  expect((annotation2.get(PDFName.of('Contents')) as PDFHexString).decodeText()).toBe('Still editable.');
});

test('moves, resizes, duplicates, deletes and undoes edits', async () => {
  const box = page.locator('.annotation-text');
  await box.click();
  const before = await box.boundingBox();
  const handle = page.getByRole('button', { name: 'Move annotation', exact: true });
  const h = (await handle.boundingBox())!;
  await page.mouse.move(h.x + 8, h.y + 8); await page.mouse.down();
  await page.mouse.move(h.x + 88, h.y + 43, { steps: 12 }); await page.mouse.up();
  const moved = (await box.boundingBox())!;
  expect(moved.x - before!.x).toBeCloseTo(80, -1);
  expect(moved.y - before!.y).toBeCloseTo(35, -1);
  const resize = await page.getByRole('button', { name: 'Resize annotation', exact: true }).boundingBox();
  await page.mouse.move(resize!.x + 3, resize!.y + 3); await page.mouse.down();
  await page.mouse.move(resize!.x + 78, resize!.y + 3, { steps: 8 }); await page.mouse.up();
  expect((await box.boundingBox())!.width).toBeGreaterThan(moved.width + 65);
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(page.locator('.annotation-text')).toHaveCount(2);
  await page.getByRole('button', { name: 'Delete selected annotation' }).click();
  await expect(page.locator('.annotation-text')).toHaveCount(1);
  await page.getByRole('button', { name: /^Undo/ }).click();
  await expect(page.locator('.annotation-text')).toHaveCount(2);
  await page.getByRole('button', { name: /^Redo/ }).click();
  await expect(page.locator('.annotation-text')).toHaveCount(1);
});

test('highlights and draws; recovers a local draft after reload', async () => {
  await page.getByRole('button', { name: 'Highlight tool', exact: true }).click();
  let p = (await page.locator('.pdf-page').first().boundingBox())!;
  await page.mouse.move(p.x + 90, p.y + 350); await page.mouse.down();
  await page.mouse.move(p.x + 310, p.y + 373, { steps: 12 }); await page.mouse.up();
  await expect(page.locator('.annotation-highlight')).toHaveCount(1);
  await page.getByRole('button', { name: 'Draw tool', exact: true }).click();
  await page.mouse.move(p.x + 150, p.y + 440); await page.mouse.down();
  for (let i = 0; i < 15; i++) await page.mouse.move(p.x + 150 + i * 6, p.y + 440 + Math.sin(i / 3) * 15);
  await page.mouse.up();
  await expect(page.locator('.annotation-draw')).toHaveCount(1);
  await expect(page.getByRole('status', { name: 'Draft saved on this device', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await expect(page.locator('.annotation')).toHaveCount(3);
  await savePdf('all-tools');
});

test('nudges precisely, keeps live typing in the draft, and traps shortcut-modal focus', async () => {
  const box = page.locator('.annotation-text');
  await box.click();
  const before = (await box.boundingBox())!;
  const pdfPage = (await page.locator('.pdf-page').first().boundingBox())!;
  const scale = pdfPage.width / 612;
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Shift+ArrowDown');
  const after = (await box.boundingBox())!;
  expect(after.x - before.x).toBeCloseTo(scale, 0);
  expect(after.y - before.y).toBeCloseTo(10 * scale, 0);
  await page.locator('summary[aria-label="More options"]').click();
  await page.getByRole('button', { name: /^Keyboard shortcuts/ }).click();
  await expect(page.getByRole('button', { name: 'Close shortcuts' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Close shortcuts' })).toBeFocused();
  await page.keyboard.press('Delete');
  await expect(box).toHaveCount(1);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await box.dblclick();
  await page.getByRole('textbox', { name: 'Edit text box' }).fill('Recovered without leaving the text box.');
  await expect(page.getByRole('status', { name: 'Saving draft…', exact: true })).toBeVisible();
  await expect(page.getByRole('status', { name: 'Draft saved on this device', exact: true })).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Continue', exact: false }).click();
  await page.locator('.annotation-text').dblclick();
  await expect(page.getByRole('textbox', { name: 'Edit text box' })).toHaveValue('Recovered without leaving the text box.');
  await page.keyboard.press('Escape');
});

test('places exported text correctly on cropped pages at all four rotations', async () => {
  await page.getByTestId('file-input').setInputFiles('tests/fixtures/rotated.pdf');
  await expect(page.locator('.pdf-page')).toHaveCount(4);
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  for (let i = 0; i < 4; i++) await addText(`Rotation ${i * 90}: café £42`, 90, 300, i);
  const exported = await savePdf('rotations');
  const pdf = await PDFDocument.load(exported.bytes);
  for (let i = 0; i < 4; i++) {
    const ann = pdf.context.lookup(pdf.getPage(i).node.Annots()!.get(0)) as PDFDict;
    const a = JSON.parse((ann.get(PDFName.of('PaperlineData')) as PDFHexString).decodeText());
    const pixels = await render(exported.bytes, i, `rotation-${i * 90}`);
    let count = 0, minX = Infinity, minY = Infinity, maxX = 0, maxY = 0;
    for (let y = Math.floor(a.y); y < Math.ceil(a.y + a.height); y++) for (let x = Math.floor(a.x); x < Math.ceil(a.x + a.width); x++) {
      const offset = (y * pixels.width + x) * 4;
      if (pixels.data[offset] < 160 && pixels.data[offset + 1] < 160) { count++; minX = Math.min(x, minX); minY = Math.min(y, minY); maxX = Math.max(x, maxX); maxY = Math.max(y, maxY); }
    }
    expect(count, `Visible text on rotation ${i * 90}`).toBeGreaterThan(100);
    expect(minX).toBeGreaterThanOrEqual(a.x + 4);
    expect(minX).toBeLessThan(a.x + 12);
    expect(minY).toBeGreaterThanOrEqual(a.y + 5);
    expect(minY).toBeLessThan(a.y + 20);
    expect(maxX).toBeLessThan(a.x + a.width);
    expect(maxY).toBeLessThan(a.y + a.height);
  }
});

test('rejects invalid files and reports unsupported glyphs without losing work', async () => {
  await page.getByTestId('file-input').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not a PDF') });
  await expect(page.getByRole('alert')).toContainText('couldn’t open');
  await expect(page.locator('.pdf-page')).toHaveCount(4);
  await page.getByRole('button', { name: 'Dismiss error' }).click();
  await addText('Emoji 😀');
  await page.getByRole('button', { name: /^Save PDF/ }).click();
  await expect(page.getByRole('alert')).toContainText('cannot export');
  await expect(page.locator('.annotation-text')).toHaveCount(5);
  expect(errors).toEqual([]);
});

test('keeps the document in focus and reveals navigation and formatting on demand', async () => {
  await page.getByTestId('file-input').setInputFiles('public/sample.pdf');
  await expect(page.locator('.busy-overlay')).toHaveCount(0);
  await expect(page.locator('.pages-panel')).toHaveCount(0);
  await expect(page.getByRole('toolbar', { name: 'Text formatting' })).toHaveCount(0);
  expect((await page.locator('.app-header').boundingBox())!.height).toBe(56);
  expect((await page.locator('.pdf-page').first().boundingBox())!.width).toBeGreaterThan(950);
  await expect(page.getByRole('status', { name: 'Draft saved on this device', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/artifacts/simple-viewer.png', animations: 'disabled' });

  await page.getByRole('button', { name: 'Toggle page navigator' }).click();
  await expect(page.getByRole('complementary', { name: 'Page navigator' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Page number', exact: true }).fill('2');
  await page.getByRole('textbox', { name: 'Page number', exact: true }).press('Enter');
  await expect(page.getByRole('button', { name: 'Go to page 2', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.getByRole('button', { name: 'Close page navigator' }).click();
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('75');
  await expect.poll(async () => (await page.locator('.pdf-page').first().boundingBox())!.width).toBeCloseTo(459, 0);
  await page.getByRole('combobox', { name: 'Zoom', exact: true }).selectOption('fit');
  await page.getByRole('button', { name: 'Text tool', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: 'Text formatting' })).toBeVisible();
  await page.getByRole('button', { name: 'Close formatting', exact: true }).click();
  await expect(page.getByRole('toolbar', { name: 'Text formatting' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Select tool', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('fits the viewer and contextual controls into a narrow window', async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Text tool', exact: true }).click();
  const header = (await page.locator('.app-header').boundingBox())!;
  const palette = (await page.getByRole('toolbar', { name: 'Text formatting' }).boundingBox())!;
  const save = (await page.getByRole('button', { name: 'Save PDF', exact: true }).boundingBox())!;
  expect(header.width).toBe(390);
  expect(palette.x).toBeGreaterThanOrEqual(0);
  expect(palette.x + palette.width).toBeLessThanOrEqual(390);
  expect(save.x + save.width).toBeLessThanOrEqual(390);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(390);
  await page.screenshot({ path: 'test-results/artifacts/narrow-viewer.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('toolbar', { name: 'Text formatting' })).toHaveCount(0);
  await page.setViewportSize({ width: 1440, height: 1000 });
});
