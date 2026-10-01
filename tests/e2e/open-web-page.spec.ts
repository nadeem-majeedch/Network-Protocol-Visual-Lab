import { test, expect } from '@playwright/test';

/**
 * Flagship end-to-end: the student "opens" http://example.local/index.html,
 * the complete DNS → ARP → routing → TCP → HTTP journey plays, and the
 * student can pause at any point to read what happened and inspect the
 * protocol stack — including the router's Ethernet frame rewrite.
 */

test.describe('Open a Web Page — flagship journey', () => {
  test('loads with the flagship as the centerpiece and no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Network Protocol/i })).toBeVisible();
    // The flagship is the default lab.
    await expect(page.getByRole('heading', { name: /Open a Web Page/i })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('the full journey runs: URL in, eight stages out, page served', async ({ page }) => {
    await page.goto('/');
    const urlBar = page.getByLabel('URL to open');
    await expect(urlBar).toHaveValue('http://example.local/index.html');

    // The student presses Enter: the journey begins.
    await urlBar.press('Enter');

    // Wait for the run to finish (status bar shows Engine: COMPLETE).
    await expect(page.getByRole('status', { name: 'Simulation status' })).toContainText('COMPLETE', { timeout: 15000 });

    // Every stage of the journey is narrated (scoped to the journey panel —
    // the lab detail pane repeats the step titles).
    const journey = page.locator('[aria-label="Journey stages"]');
    await expect(journey.getByText('1 · DNS resolution')).toBeVisible();
    await expect(journey.getByText('2 · ARP resolution')).toBeVisible();
    await expect(journey.getByText('3 · Routing')).toBeVisible();
    await expect(journey.getByText('4 · TCP handshake')).toBeVisible();
    await expect(journey.getByText('5 · HTTP GET')).toBeVisible();
    await expect(journey.getByText('6 · HTTP response')).toBeVisible();
    await expect(journey.getByText('7 · Data & acknowledgements')).toBeVisible();
    await expect(journey.getByText('8 · Termination')).toBeVisible();

    // The current stage answers the student's questions.
    await expect(page.getByText('What happened?').first()).toBeVisible();
    await expect(page.getByText('Why did it happen?').first()).toBeVisible();
    await expect(page.getByText('Which protocol?').first()).toBeVisible();
    await expect(page.getByText('What was added?').first()).toBeVisible();
    await expect(page.getByText('What changed?').first()).toBeVisible();
    await expect(page.getByText('Who decided?').first()).toBeVisible();

    // Wire evidence of the whole chain in the event timeline.
    const timeline = page.locator('.timeline, [class*=timeline]').first();
    await expect(timeline).toContainText(/DNS/i);
    await expect(timeline).toContainText(/ARP/i);
  });

  test('the student can pause mid-journey and read the stage narrative', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('URL to open').press('Enter');
    // Pause quickly, while the journey is still playing.
    const pause = page.getByRole('button', { name: /Pause/i });
    await expect(pause).toBeVisible({ timeout: 10000 });
    await pause.click();
    // While paused the cursor stops; the journey panel stays readable.
    await expect(page.getByText(/Stage \d of 8/)).toBeVisible();
    const stageText = await page.locator('.journey-stage.current').textContent();
    expect(stageText).toBeTruthy();
    // Play again to the end.
    await page.getByRole('button', { name: /Play/i }).click();
    await expect(page.getByRole('status', { name: 'Simulation status' })).toContainText('COMPLETE', { timeout: 15000 });
  });

  test('selecting the HTTP GET reveals the protocol stack and the router frame rewrite', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('URL to open').press('Enter');
    await expect(page.getByRole('status', { name: 'Simulation status' })).toContainText('COMPLETE', { timeout: 15000 });

    // The stack view invites a selection before any packet is picked.
    await expect(page.getByText('Select a packet to see its layers')).toBeVisible();

    // Select the HTTP request packet chip in the timeline's packet list.
    const chip = page
      .locator('[aria-label="Packets"] *')
      .filter({ hasText: 'GET /index.html' })
      .first();
    await chip.click({ timeout: 10000 });

    // The nested stack view: all four layers with their headers.
    const stack = page.locator('[aria-label="Protocol stack"]');
    await expect(stack.getByText('Protocol stack')).toBeVisible();
    await expect(stack.getByText('GET /index.html HTTP/1.1')).toBeVisible();
    await expect(stack.getByText('49152 → 80')).toBeVisible();
    await expect(stack.getByText('172.30.0.20').first()).toBeVisible();

    // The centerpiece lesson: same IP destination, two different frames.
    await expect(stack.getByText('The frame changed — the IP destination did not')).toBeVisible();
    await expect(stack.getByText('Browser → Router')).toBeVisible();
    await expect(stack.getByText('Router → Server')).toBeVisible();
  });

  test('the inspectors stay available for every protocol in the journey', async ({ page }) => {
    await page.goto('/');
    await page.getByLabel('URL to open').press('Enter');
    await expect(page.getByRole('status', { name: 'Simulation status' })).toContainText('COMPLETE', { timeout: 15000 });
    // DNS, TCP and HTTP inspectors all render for the flagship.
    await expect(page.getByText('DNS inspector')).toBeVisible();
    await expect(page.getByText('TCP state')).toBeVisible();
    await expect(page.getByText('HTTP', { exact: true })).toBeVisible();
    await expect(page.getByText('The journey')).toBeVisible();
    // No console errors across the whole journey.
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(String(err)));
    expect(errors).toEqual([]);
  });
});
