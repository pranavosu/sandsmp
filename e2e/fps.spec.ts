import { test, expect } from '@playwright/test';

/**
 * FPS performance test.
 *
 * Loads the simulation, waits for it to run, then measures the actual
 * frame rate reported by the FPS badge. We assert ≥50 fps as a floor
 * that catches the "stuck at 30fps" regression.
 */

async function waitForRunning(page: import('@playwright/test').Page): Promise<boolean> {
  const sandBtn = page.getByRole('button', { name: 'Sand' });
  const errorText = page.getByText(/WebGPU is required|Failed to initialize/);
  await Promise.race([
    sandBtn.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
    errorText.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {}),
  ]);
  return sandBtn.isVisible();
}

test('simulation runs above 50 fps on an idle grid', async ({ page }) => {
  // Capture console logs for timing breakdown
  const logs: string[] = [];
  page.on('console', msg => {
    if (msg.text().includes('[frame]')) logs.push(msg.text());
  });

  await page.goto('/');
  const isRunning = await waitForRunning(page);
  if (!isRunning) {
    test.skip(true, 'WebGPU not available — simulation did not start');
    return;
  }

  // Let the simulation settle for 3 seconds so the FPS counter stabilises.
  await page.waitForTimeout(3000);

  // Print timing breakdown
  for (const log of logs) console.log(log);

  const fpsBadge = page.getByTestId('fps-badge');
  const fpsText = await fpsBadge.textContent();
  const fps = parseInt(fpsText?.replace(/[^0-9]/g, '') ?? '0', 10);

  console.log(`Measured FPS: ${fps}`);
  expect(fps, `FPS is ${fps}, expected ≥50`).toBeGreaterThanOrEqual(50);
});

test('simulation runs above 50 fps with active sand', async ({ page }) => {
  await page.goto('/');
  const isRunning = await waitForRunning(page);
  if (!isRunning) {
    test.skip(true, 'WebGPU not available — simulation did not start');
    return;
  }

  await page.waitForTimeout(1000);

  // Paint sand by dragging across the top of the canvas
  const canvas = page.locator('canvas');
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 20, box.y + box.height * 0.15);
  await page.mouse.down();
  for (let x = 20; x < box.width - 20; x += 10) {
    await page.mouse.move(box.x + x, box.y + box.height * 0.15, { steps: 2 });
  }
  await page.mouse.up();

  // Let sand fall and FPS stabilise
  await page.waitForTimeout(3000);

  const fpsBadge = page.getByTestId('fps-badge');
  const fpsText = await fpsBadge.textContent();
  const fps = parseInt(fpsText?.replace(/[^0-9]/g, '') ?? '0', 10);

  console.log(`Measured FPS with active sand: ${fps}`);
  expect(fps, `FPS is ${fps}, expected ≥50`).toBeGreaterThanOrEqual(50);
});
