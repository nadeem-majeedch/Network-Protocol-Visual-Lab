import { test, expect } from '@playwright/test';

test.describe('Network Protocol Visual Lab', () => {
  test('loads the simulator with the default lab and no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Network Protocol Visual Lab/i })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Labs' })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('creates a topology in the editor', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Topology editor' }).click();

    // Add devices via the palette.
    await page.getByRole('button', { name: '+ PC' }).click();
    await page.getByRole('button', { name: '+ Switch' }).click();
    await page.getByRole('button', { name: '+ Router' }).click();
    await page.getByRole('button', { name: '+ Web server' }).click();

    // The canvas now shows the added devices.
    const canvas = page.locator('.topology-canvas');
    await expect(canvas).toBeVisible();
    await expect(canvas.getByText('PC1')).toBeVisible();
    await expect(canvas.getByText('Switch1')).toBeVisible();
    await expect(canvas.getByText('Router1')).toBeVisible();

    // Validation reports the (expected) valid state.
    await expect(page.getByText('Topology valid ✓')).toBeVisible();
  });

  test('runs a simulation and animates packets', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Run/i }).click();

    // Packets appear as chips and events as timeline rows.
    await expect(page.locator('.packet-chips .chip').first()).toBeVisible();
    await expect(page.locator('.event-log .event').first()).toBeVisible();

    // Playback controls are present once a run exists.
    await expect(page.getByRole('button', { name: /Pause|Play/i })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Step backward' })).toBeEnabled();
  });

  test('selecting a packet shows its protocol layers in the inspector', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Run/i }).click();
    await page.locator('.packet-chips .chip').first().click();

    const inspector = page.locator('.inspector');
    await expect(inspector.getByText('ETHERNET')).toBeVisible();
    await expect(inspector.getByRole('tab', { name: 'Explain' })).toBeVisible();
    await expect(inspector.getByText(/Source MAC/i)).toBeVisible();

    // The Explain tab renders the deterministic educational section.
    await inspector.getByRole('tab', { name: 'Explain' }).click();
    await expect(inspector.getByText('Explain this packet')).toBeVisible();
    await expect(inspector.getByText('Ethernet layer')).toBeVisible();
  });

  test('inspecting an event shows its structured fields', async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: /Run/i }).click();

    // Wait for events to exist, then open the first one.
    await expect(page.locator('.event-log .event .event-row').first()).toBeVisible();
    await page.locator('.event-log .event .event-row').first().click();

    const eventInspector = page.locator('[aria-label="Event inspector"]');
    await expect(eventInspector).toBeVisible();
    // Every event exposes at least its type and time.
    await expect(eventInspector.getByText('Event', { exact: true })).toBeVisible();
    await expect(eventInspector.getByText(/ms$/).first()).toBeVisible();
  });
});
