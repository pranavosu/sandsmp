import { test, expect } from '@playwright/test';

/**
 * Helper: wait for the simulation to either reach "running" state (buttons visible)
 * or "error" state (error message visible). Returns true if running, false if errored.
 */
async function waitForSimulationInit(page: import('@playwright/test').Page): Promise<boolean> {
  // Race: either the Sand button appears (running) or an error message appears
  const sandBtn = page.getByRole('button', { name: 'Sand' });
  const errorText = page.getByText(/WebGPU is required|Failed to initialize/);

  await Promise.race([
    sandBtn.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
    errorText.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
  ]);

  return await sandBtn.isVisible();
}

// Requirements: 12.1, 12.2 — Application loads, canvas present
test('application loads with canvas element and title', async ({ page }) => {
  await page.goto('/');

  // Page title/heading is present
  await expect(page.locator('h1')).toContainText('Falling Sand');

  // Canvas element exists in the DOM (may be hidden if WebGPU unavailable)
  const canvas = page.locator('canvas');
  await expect(canvas).toBeAttached({ timeout: 15_000 });
});

// Requirements: 12.2 — WebGPU error handling
test('displays error message when WebGPU is unavailable', async ({ browser }) => {
  // Launch a context that overrides navigator.gpu to be undefined
  const context = await browser.newContext();
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'gpu', { value: undefined, writable: false });
  });
  const page = await context.newPage();
  await page.goto('/');

  // Should show an error message about WebGPU
  const alert = page.getByText('WebGPU is required');
  await expect(alert).toBeVisible({ timeout: 15_000 });

  await context.close();
});

// Requirements: 12.5 — Element selector buttons switch the active element type
test('element selector buttons switch active element', async ({ page }) => {
  await page.goto('/');

  const isRunning = await waitForSimulationInit(page);
  if (!isRunning) {
    test.skip(true, 'WebGPU not available in headless mode — simulation did not start');
    return;
  }

  const sandBtn = page.getByRole('button', { name: 'Sand' });
  const waterBtn = page.getByRole('button', { name: 'Water' });
  const wallBtn = page.getByRole('button', { name: 'Wall' });
  const fireBtn = page.getByRole('button', { name: 'Fire' });

  // Sand is selected by default
  await expect(sandBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(waterBtn).toHaveAttribute('aria-pressed', 'false');

  // Click Water — it becomes selected, Sand deselected
  await waterBtn.click();
  await expect(waterBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(sandBtn).toHaveAttribute('aria-pressed', 'false');

  // Click Wall
  await wallBtn.click();
  await expect(wallBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(waterBtn).toHaveAttribute('aria-pressed', 'false');

  // Click Fire
  await fireBtn.click();
  await expect(fireBtn).toHaveAttribute('aria-pressed', 'true');
  await expect(wallBtn).toHaveAttribute('aria-pressed', 'false');
});

// Requirements: 12.3 — Painting Sand via mouse click changes canvas pixels
test('painting Sand changes canvas pixels', async ({ page }) => {
  await page.goto('/');

  const isRunning = await waitForSimulationInit(page);
  if (!isRunning) {
    test.skip(true, 'WebGPU not available in headless mode — simulation did not start');
    return;
  }

  const canvas = page.locator('canvas');

  // Take a screenshot before painting
  const before = await canvas.screenshot();

  // Paint Sand by clicking in the middle of the canvas
  const box = (await canvas.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  // Wait a few frames for the paint to take effect
  await page.waitForTimeout(200);

  // Take a screenshot after painting
  const after = await canvas.screenshot();

  // The screenshots should differ (pixels changed)
  expect(Buffer.compare(before, after)).not.toBe(0);
});

// Requirements: 12.4 — After painting Sand, canvas continues to update (Sand falls)
test('simulation animates after painting Sand', async ({ page }) => {
  await page.goto('/');

  const isRunning = await waitForSimulationInit(page);
  if (!isRunning) {
    test.skip(true, 'WebGPU not available in headless mode — simulation did not start');
    return;
  }

  const canvas = page.locator('canvas');
  const box = (await canvas.boundingBox())!;

  // Paint Sand near the top of the canvas so it has room to fall
  await page.mouse.click(box.x + box.width / 2, box.y + box.height * 0.2);
  await page.waitForTimeout(100);

  // Capture frame after painting
  const frame1 = await canvas.screenshot();

  // Wait for Sand to fall
  await page.waitForTimeout(500);

  // Capture another frame — should differ as Sand has fallen
  const frame2 = await canvas.screenshot();

  expect(Buffer.compare(frame1, frame2)).not.toBe(0);
});
