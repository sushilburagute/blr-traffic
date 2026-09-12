import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors: string[] = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await mkdir('artifacts', { recursive: true });
const origin = process.env.REVIEW_URL ?? 'http://localhost:3000';
await page.goto(origin);
await page.getByRole('button', { name: /Let’s hit the road/ }).waitFor();
await page.waitForFunction(
  () =>
    document.querySelector('[aria-label="Asset loading"]')?.getAttribute('aria-valuenow') === '100',
  {},
  { timeout: 40000 },
);
await page.screenshot({ path: 'artifacts/landing.png', fullPage: true });
await page.getByRole('button', { name: /Let’s hit the road/ }).click();
await page.getByRole('button', { name: 'Play simulation', exact: true }).waitFor();
await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
await page.getByRole('button', { name: '32×', exact: true }).click();
await page.waitForTimeout(8000);
await page.screenshot({ path: 'artifacts/simulator.png', fullPage: true });
await page
  .getByRole('button', { name: /^Iblur / })
  .click()
  .catch(() => {});
await page.waitForTimeout(1500);
await page.screenshot({ path: 'artifacts/junction.png', fullPage: true });
await page.getByRole('button', { name: 'Finish now', exact: false }).click();
await page.waitForURL('**/report');
await page.getByRole('heading', { name: 'So, how was the drive?' }).waitFor();
await page.screenshot({ path: 'artifacts/report.png', fullPage: true });
await page.setViewportSize({ width: 390, height: 844 });
await page.goto(origin);
await page.screenshot({ path: 'artifacts/mobile.png', fullPage: true });
console.log(JSON.stringify({ errors }, null, 2));
await writeFile('artifacts/browser-errors.json', JSON.stringify(errors, null, 2));
await browser.close();
