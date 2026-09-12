import { test, expect } from '@playwright/test';
import { encode } from '../src/lib/share';
import { presetConfig } from '../src/lib/presets';
import { readFile } from 'node:fs/promises';
import type { ScenarioConfig, SimStats } from '../src/sim/types';
test('landing preloads assets and permits choosing a commute', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Your commute/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Let’s hit the road/ })).toBeEnabled({
    timeout: 40000,
  });
  await page.getByRole('button', { name: 'Car', exact: true }).click();
  await page.getByRole('button', { name: 'Every gap is mine' }).click();
  await page.getByRole('button', { name: /Let’s hit the road/ }).click();
  await expect(page).toHaveURL(/\/sim/);
  await expect(page.getByRole('heading', { name: 'Monday 9 AM', exact: true })).toBeVisible();
  await expect(page.getByRole('note', { name: 'Getting started 2 of 3' })).toBeVisible();
  await page.getByRole('button', { name: 'Next tip', exact: true }).click();
  await expect(page.getByRole('note', { name: 'Getting started 3 of 3' })).toBeVisible();
  await page.getByRole('button', { name: 'Got it', exact: true }).click();
  expect(errors).toEqual([]);
});
test('short Sunday run reaches a report with trips and survives reload', async ({ page }) => {
  const c = { ...presetConfig('sunday-morning'), durationMin: 5 };
  await page.goto(`/s/${encode(c)}`);
  await expect(page).toHaveURL(/\/sim/);
  await expect(page.getByRole('button', { name: 'Play simulation', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: /Skip to end/ }).click();
  await expect(page).toHaveURL(/\/report/, { timeout: 60000 });
  await expect(page.getByRole('heading', { name: 'So, how was the drive?' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /[1-9]\d* completed trips/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'So, how was the drive?' })).toBeVisible({
    timeout: 60000,
  });
});
test('share round trip restores the preset and expert patches mark Custom', async ({ page }) => {
  await page.goto(`/s/${encode(presetConfig('sunday-morning'))}`);
  await expect(page).toHaveURL(/\/sim/);
  await expect(page.getByRole('heading', { name: 'Sunday morning', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Expert mode', exact: true }).click();
  await page.getByRole('slider', { name: 'Vehicles per hour', exact: true }).fill('4000');
  await page.getByRole('button', { name: 'Apply & restart', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Custom', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Help', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your field guide', exact: true })).toBeVisible();
});
test('invalid share links fail safely and guide has metadata', async ({ page }) => {
  await page.goto('/s/invalid');
  await expect(page.getByRole('heading', { name: 'This link could not be opened' })).toBeVisible();
  await page.goto('/guide');
  await expect(
    page.getByRole('heading', { name: 'How the model works', exact: true }),
  ).toBeVisible();
  await expect(page.locator('link[rel=canonical]')).toHaveAttribute(
    'href',
    'https://blr-traffic.sush.dev/guide',
  );
});
test('mobile landing has no horizontal overflow', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'How do you get there?' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
test('early report replays live weather and the exact endpoint on reload and sharing', async ({
  page,
}) => {
  const config = { ...presetConfig('sunday-morning'), durationMin: 5 };
  await page.goto(`/s/${encode(config)}`);
  await expect(page).toHaveURL(/\/sim/);
  await page.getByRole('button', { name: 'Play simulation', exact: true }).click();
  await page.getByRole('button', { name: '32×', exact: true }).click();
  await page.waitForFunction(
    () =>
      parseFloat(
        (document.querySelector('.playback-progress i') as HTMLElement)?.style.width ?? '0',
      ) > 1,
  );
  await page.getByRole('button', { name: 'Toggle rain', exact: true }).click();
  await page.getByRole('button', { name: 'Finish now', exact: false }).click();
  await expect(page).toHaveURL(/\/report/);
  async function download() {
    const event = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download JSON' }).click();
    const file = await event;
    return JSON.parse(await readFile((await file.path())!, 'utf8')) as {
      config: ScenarioConfig;
      stats: SimStats;
    };
  }
  const before = await download();
  expect(before.config.liveEvents?.some((e) => e.kind === 'rain' && e.on)).toBe(true);
  expect(before.stats.simTime).toBeLessThan(300);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'So, how was the drive?' })).toBeVisible({
    timeout: 60000,
  });
  const reloaded = await download();
  expect(reloaded.stats).toEqual(before.stats);
  await page.goto(`/s/${encode(before.config)}?result=1&until=${before.stats.simTime}`);
  await expect(page).toHaveURL(/\/report/, { timeout: 60000 });
  const shared = await download();
  expect(shared.stats).toEqual(before.stats);
});
test('map has a sized canvas and keyboard controls keep working after junction clicks', async ({
  page,
}) => {
  await page.goto('/sim?dur=5');
  await page.getByRole('button', { name: 'Play simulation', exact: true }).waitFor();
  await expect(page.locator('.map-container canvas').first()).toBeVisible({ timeout: 30000 });
  expect(
    await page
      .locator('.map-container canvas')
      .first()
      .evaluate((el) => el.clientWidth > 300 && el.clientHeight > 300),
  ).toBe(true);
  await page.getByRole('button', { name: /^Iblur / }).click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.junction-card')).toHaveCount(0);
  await page.locator('h1').click();
  await page.keyboard.press('?');
  await expect(page.getByRole('heading', { name: 'Your field guide' })).toBeVisible();
});
