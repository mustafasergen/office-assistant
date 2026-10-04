import { test, expect } from '@playwright/test';

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1440, height: 500 },
  { width: 390, height: 844 },
]) {
  test(`long chat scrolls inside its panel at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const id = '00000000-0000-4000-8000-000000000001';
    const createdAt = '2026-10-03T12:00:00Z';
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      const json = path.endsWith('/messages')
        ? Array.from({ length: 60 }, (_, index) => ({
            id: String(index),
            threadId: id,
            role: index % 2 ? 'assistant' : 'user',
            content: `Mesaj ${index}: ${'Uzun sohbet içeriği. '.repeat(25)}`,
            status: 'completed',
            metadata: {},
            createdAt,
          }))
        : path === '/api/threads'
          ? Array.from({ length: 40 }, (_, index) => ({
              id: index === 0 ? id : String(index),
              title: `Konuşma ${index}`,
              createdAt,
              updatedAt: createdAt,
            }))
          : path === '/api/session'
            ? { id }
            : path === '/api/health/ready'
              ? { status: 'ok', provider: 'mock' }
              : [];
      await route.fulfill({ json });
    });
    await page.goto(`/chat/${id}`);
    await expect(page.locator('.message')).toHaveCount(60);
    const conversation = page.getByRole('region', { name: 'Sohbet' });
    await expect
      .poll(() => conversation.evaluate((element) => element.scrollTop))
      .toBeGreaterThan(0);
    const boxesBefore = await page
      .locator('.topbar, .composer-area, .sidebar, .context-panel')
      .evaluateAll((elements) =>
        elements.map((element) => ({
          top: element.getBoundingClientRect().top,
          height: element.getBoundingClientRect().height,
        })),
      );
    await conversation.evaluate((element) => element.scrollTo({ top: 0, behavior: 'instant' }));
    await expect.poll(() => conversation.evaluate((element) => element.scrollTop)).toBe(0);
    expect(
      await page
        .locator('.topbar, .composer-area, .sidebar, .context-panel')
        .evaluateAll((elements) =>
          elements.map((element) => ({
            top: element.getBoundingClientRect().top,
            height: element.getBoundingClientRect().height,
          })),
        ),
    ).toEqual(boxesBefore);
    const layout = await page.evaluate(() => ({
      documentHeight: document.documentElement.scrollHeight,
      documentWidth: document.documentElement.scrollWidth,
      scrollY: window.scrollY,
      composerBottom: document.querySelector('.composer-area')!.getBoundingClientRect().bottom,
    }));
    expect(layout.documentHeight).toBeLessThanOrEqual(viewport.height);
    expect(layout.documentWidth).toBeLessThanOrEqual(viewport.width);
    expect(layout.scrollY).toBe(0);
    expect(layout.composerBottom).toBeLessThanOrEqual(viewport.height);
    if (viewport.width > 1180) {
      for (const panel of ['.sidebar', '.context-panel'])
        expect((await page.locator(panel).boundingBox())!.height).toBe(viewport.height);
      expect(
        await page
          .locator('.thread-list')
          .evaluate((element) => element.scrollHeight > element.clientHeight),
      ).toBe(true);
    }
  });
}
