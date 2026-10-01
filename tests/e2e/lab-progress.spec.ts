import { test, expect } from '@playwright/test';

/**
 * Laboratory framework end-to-end: the Lab Progress panel is visible, a
 * numbered lab opened from the sidebar shows its framework write-up
 * (objectives, hints, completion criteria), and completing a run marks
 * the lab done — client-side, with no console errors.
 */

test.describe('Lab progress (client-side framework)', () => {
  test('progress panel lists the curriculum and a run marks Lab 01 complete', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Network Protocol/i })).toBeVisible();

    // The progress panel mirrors the whole catalog (45 labs, none done yet).
    const progress = page.locator('[aria-label="Lab progress"]');
    await expect(progress).toBeVisible();
    await expect(progress.getByText(/0\/45/)).toBeVisible();
    await expect(progress.getByRole('button', { name: /Lab 01/ })).toBeVisible();
    await expect(progress.getByRole('button', { name: /Lab 18/ })).toBeVisible();

    // Nothing is complete on a fresh browser profile.
    await expect(progress.getByRole('button', { name: /Lab 01/ })).toContainText('○');

    // Open Lab 01 from the progress panel: its framework write-up appears.
    await progress.getByRole('button', { name: /Lab 01/ }).click();
    await expect(page.getByRole('heading', { name: /Lab 01 — Ethernet Frames/ })).toBeVisible();
    await expect(page.getByText('Learning objectives')).toBeVisible();
    await expect(page.getByText('Prerequisites')).toBeVisible();
    await expect(page.getByText('Simulation controls')).toBeVisible();
    await expect(page.getByText('Expected observations')).toBeVisible();
    await expect(page.getByText('Completion criteria')).toBeVisible();

    // Hints start collapsed and reveal on demand.
    await expect(page.getByRole('button', { name: 'Show hints' })).toBeVisible();

    // Run the lab to completion; the sidebar then marks it done.
    await page.getByRole('button', { name: /Run/i }).click();
    await expect(page.getByRole('status', { name: 'Simulation status' })).toContainText('COMPLETE', { timeout: 15000 });
    await expect(progress.getByRole('button', { name: /Lab 01/ })).toContainText('✓');
    await expect(page.getByText(/✓ Complete — /)).toBeVisible();

    // The completion marker also shows in the lab navigation.
    await expect(page.getByRole('navigation', { name: 'Labs' }).getByText('✓')).toBeVisible();

    expect(errors).toEqual([]);
  });

  test('Lab 18 completes through the flagship-style journey and persists client-side', async ({ page }) => {
    await page.goto('/');
    const progress = page.locator('[aria-label="Lab progress"]');

    await progress.getByRole('button', { name: /Lab 18/ }).click();
    await expect(page.getByRole('heading', { name: /Lab 18 — Complete Web Request/ })).toBeVisible();
    await page.getByRole('button', { name: /Run/i }).click();
    await expect(page.getByRole('status', { name: 'Simulation status' })).toContainText('COMPLETE', { timeout: 15000 });
    await expect(progress.getByRole('button', { name: /Lab 18/ })).toContainText('✓');

    // Reload: progress survives because it is persisted in localStorage.
    await page.reload();
    await expect(page.locator('[aria-label="Lab progress"]').getByRole('button', { name: /Lab 18/ })).toContainText('✓');
  });
});
