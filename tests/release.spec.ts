import { test, expect, chromium } from '@playwright/test';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('the downloadable ZIP installs as paperline 1.4.0 and copies PDF text without a mode switch', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'paperline-release-'));
  const archive = path.resolve('release/paperline-1.4.0.zip');
  execFileSync('python3', ['-m', 'zipfile', '-e', archive, directory]);
  const extension = path.join(directory, 'dist');
  const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
  expect({ name: manifest.name, version: manifest.version }).toEqual({ name: 'paperline', version: '1.4.0' });
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium', headless: true, viewport: { width: 1280, height: 900 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    const page = await context.newPage();
    const origin = `chrome-extension://${worker.url().split('/')[2]}`;
    await page.goto(origin + '/options.html');
    await expect(page.getByText('Paperline 1.4.0.', { exact: false })).toBeVisible();
    await page.goto(origin + '/index.html');
    await expect(page).toHaveTitle('paperline');
    await page.getByRole('button', { name: /Try a sample PDF/ }).click();
    await expect(page.locator('.busy-overlay')).toHaveCount(0);
    const heading = page.locator('.pdf-text-layer span').filter({ hasText: /^Good things start$/ });
    await heading.dblclick({ position: { x: 20, y: 15 } });
    await expect.poll(() => page.evaluate(() => getSelection()?.toString())).toBe('Good');
    await page.keyboard.press('Control+c');
    await page.evaluate(() => {
      const input = document.createElement('textarea'); input.id = 'paste';
      input.style.cssText = 'position:fixed;top:60px;left:0;z-index:200';
      document.body.append(input); input.focus();
    });
    await page.keyboard.press('Control+v');
    await expect(page.locator('#paste')).toHaveValue('Good');
  } finally {
    await context.close();
    await rm(directory, { recursive: true, force: true });
  }
});
