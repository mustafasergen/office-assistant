import { test, expect } from '@playwright/test';

for (const viewport of [
  { width: 1440, height: 500 },
  { width: 320, height: 568 },
  { width: 844, height: 390 },
]) {
  test(`side panels keep long content accessible at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const longText = 'ÇokUzunKesintisizBirBaşlıkVeyaKullanıcıBilgisi'.repeat(6);
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const json =
        path === '/api/session'
          ? { id: 'user' }
          : path === '/api/health/ready'
            ? { status: 'ok', provider: 'mock' }
            : path === '/api/threads'
              ? Array.from({ length: 60 }, (_, i) => ({ id: String(i), title: `${i} ${longText}` }))
              : path === '/api/documents'
                ? Array.from({ length: 30 }, (_, i) => ({
                    id: String(i),
                    title: `${i} ${longText}`,
                    slug: String(i),
                  }))
                : path === '/api/memories'
                  ? Array.from({ length: 30 }, (_, i) => ({
                      id: String(i),
                      key: `Bilgi ${i}`,
                      value: longText,
                    }))
                  : [];
      await route.fulfill({ json });
    });
    await page.goto('/');
    await expect(page.getByText('Yardım etmeye hazır')).toBeVisible();
    if (viewport.width <= 700) await page.getByRole('button', { name: 'Konuşmaları aç' }).click();
    const threads = page.locator('.thread-list');
    expect(await threads.evaluate((el) => el.clientHeight)).toBeGreaterThan(80);
    await threads.locator('button').last().scrollIntoViewIfNeeded();
    await expect(threads.locator('button').last()).toBeInViewport();
    await expect(page.locator('.profile')).toBeInViewport();
    expect(await threads.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    if (viewport.width <= 700)
      await page.locator('.mobile-overlay').click({ position: { x: viewport.width - 10, y: 100 } });
    if (viewport.width <= 1180)
      await page.getByRole('button', { name: 'Bilgi ve hafıza panelini aç' }).click();
    const content = page.locator('.context-content');
    await content.locator('.document-list button').last().scrollIntoViewIfNeeded();
    await expect(content.locator('.document-list button').last()).toBeInViewport();
    const lastMemory = content.getByTestId('memory-item').last();
    await lastMemory.scrollIntoViewIfNeeded();
    await expect(lastMemory.getByRole('button')).toBeInViewport();
    expect(await content.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(page.locator('.context-header')).toBeInViewport();
    await expect(page.locator('.context-footer')).toBeInViewport();
    const bounds = await lastMemory.getByRole('button').boundingBox();
    expect(bounds!.width).toBeGreaterThanOrEqual(27);
    expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
      viewport.height,
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(
      viewport.width,
    );
  });
}
