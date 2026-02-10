import type { Page } from "playwright-core";

/**
 * Generates a Gaussian-distributed random number using the Box-Muller transform.
 * Returns a value centered around `mean` with standard deviation `stdDev`.
 */
function gaussianRandom(mean: number, stdDev: number): number {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + z * stdDev;
}

/**
 * Returns a random delay in ms using Gaussian distribution, clamped to [min, max].
 */
export function randomDelay(min: number, max: number): number {
  const mean = (min + max) / 2;
  const stdDev = (max - min) / 4; // ~95% of values fall within [min, max]
  return Math.round(Math.max(min, Math.min(max, gaussianRandom(mean, stdDev))));
}

/**
 * Waits a human-like amount of time (Gaussian-distributed).
 */
export async function humanDelay(
  page: Page,
  min = 200,
  max = 800
): Promise<void> {
  const ms = randomDelay(min, max);
  await page.waitForTimeout(ms);
}

/**
 * Moves the mouse to a random position on the page to simulate idle movement.
 */
export async function randomMouseMove(page: Page): Promise<void> {
  const x = Math.floor(Math.random() * 800) + 100;
  const y = Math.floor(Math.random() * 500) + 100;
  await page.mouse.move(x, y, { steps: randomDelay(5, 15) });
}

/**
 * Types text character-by-character with random delays between keystrokes.
 * More human-like than Playwright's instant `fill()`.
 */
export async function humanType(
  page: Page,
  selector: string,
  text: string
): Promise<void> {
  await page.click(selector);
  // Clear existing value first
  await page.fill(selector, "");
  for (const char of text) {
    await page.keyboard.type(char, { delay: randomDelay(40, 120) });
  }
}

/**
 * Scrolls the page by a small random amount to simulate human browsing.
 */
export async function humanScroll(page: Page): Promise<void> {
  const scrollY = randomDelay(100, 400);
  await page.mouse.wheel(0, scrollY);
  await humanDelay(page, 100, 300);
}

/**
 * Returns a slightly randomized viewport size to avoid the exact 1920x1080 fingerprint.
 */
export function randomizedViewport(): { width: number; height: number } {
  const widths = [1920, 1903, 1912, 1920, 1920, 1536, 1440, 1920];
  const heights = [1080, 1067, 1074, 1080, 1080, 864, 900, 1080];
  const i = Math.floor(Math.random() * widths.length);
  return { width: widths[i], height: heights[i] };
}

/**
 * Extra Chromium launch args that reduce automation fingerprint leaks.
 * These are free, require no external deps, and don't break functionality.
 */
export const STEALTH_LAUNCH_ARGS = [
  "--no-sandbox",
  "--disable-setuid-sandbox",
  "--disable-dev-shm-usage",
  "--disable-accelerated-2d-canvas",
  "--disable-gpu",
  // Anti-detection args
  "--disable-blink-features=AutomationControlled",
  "--disable-features=IsolateOrigins,site-per-process",
  "--disable-webrtc-hw-encoding",
  "--disable-webrtc-hw-decoding",
  "--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
];

/**
 * Common locale/timezone context options for browser context.
 */
export const STEALTH_CONTEXT_OPTIONS = {
  locale: "en-US",
  timezoneId: "America/New_York",
  permissions: [] as string[],
};
