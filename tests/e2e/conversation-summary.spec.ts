import { test, expect } from '@playwright/test';

// Live network calls need more time; product agent timeout is unchanged.
test.setTimeout(process.env.RUN_LIVE_E2E === '1' ? 180000 : 60000);

for (const width of [1440, 390]) {
  test(`P3 summary opens without remounting, moving the composer or scrolling at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByText('Yardım etmeye hazır')).toBeVisible();
    const thread = await (await page.request.post('/api/threads')).json();
    for (let i = 0; i < 10; i++) {
      const r = await page.request.post(`/api/threads/${thread.id}/messages`, {
        data: { content: i === 0 ? 'İzin başvurusu nasıl yapılır?' : 'Teşekkürler' },
      });
      expect(r.status()).toBe(201);
    }
    await page.goto(`/chat/${thread.id}`);
    await expect(page.locator('.message')).toHaveCount(20);
    await expect(page.getByRole('button', { name: 'Özeti göster' })).toHaveCount(0);
    const input = page.getByRole('textbox', { name: 'Mesajın' });
    const handle = await input.elementHandle();
    const bounds = await input.boundingBox();
    await input.fill('Teşekkürler');
    await input.press('Enter');
    await expect(page.locator('.message')).toHaveCount(22);
    const toggle = page.getByRole('button', { name: 'Özeti göster' });
    await expect(toggle).toBeVisible();
    await expect(input).toBeFocused();
    expect(await handle!.evaluate((el) => el.isConnected)).toBe(true);
    expect(await input.boundingBox()).toEqual(bounds);
    const conversation = page.getByRole('region', { name: 'Sohbet' });
    await conversation.evaluate((el) => el.scrollTo({ top: 0, behavior: 'instant' }));
    const before = await conversation.evaluate((el) => el.scrollTop);
    await toggle.click();
    await expect(page.getByRole('region', { name: 'Konuşma özeti' })).toContainText(
      'Özetlenen bölümdeki son konu: İzin başvuru süreci',
    );
    expect(await conversation.evaluate((el) => el.scrollTop)).toBe(before);
    expect(await input.boundingBox()).toEqual(bounds);
    await page.getByRole('button', { name: 'Özeti kapat' }).press('Escape');
    await expect(page.getByRole('region', { name: 'Konuşma özeti' })).toHaveCount(0);
    await expect(toggle).toBeFocused();
    expect(await conversation.evaluate((el) => el.scrollTop)).toBe(before);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await page.reload();
    await expect(page.locator('.message')).toHaveCount(22);
    await expect(toggle).toBeVisible();
  });
}

test('P1 UI delete below threshold retains topic, clears personalization and preserves old messages', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Yardım etmeye hazır')).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Mesajın' });
  for (const content of ['İzin başvurusu nasıl yapılır?', 'Veganım']) {
    await input.fill(content);
    await input.press('Enter');
    await expect(page.locator('.new-chat')).toBeEnabled();
  }
  await page.getByRole('button', { name: 'Beslenme tercihi kaydını sil' }).click();
  await expect(page.getByTestId('memory-item')).toHaveCount(0);
  await page.getByRole('button', { name: 'Özeti göster' }).click();
  await expect(page.getByRole('region', { name: 'Konuşma özeti' })).toContainText(
    'İzin başvuru süreci',
  );
  await expect(page.getByRole('region', { name: 'Konuşma özeti' })).not.toContainText(/vegan/i);
  await page.getByRole('button', { name: 'Özeti kapat' }).click();
  await expect(page.locator('.message.user')).toContainText(['İzin başvurusu', 'Veganım']);
  await input.fill('Peki kaç gün önceden?');
  await input.press('Enter');
  await expect(page.locator('.message.assistant').last()).toContainText('5 iş günü');
  await expect(page.locator('.new-chat')).toBeEnabled();
  await input.fill('Yemek seçenekleri neler?');
  await input.press('Enter');
  await expect(page.locator('.new-chat')).toBeEnabled();
  await expect(page.locator('.message.assistant').last()).not.toContainText('Beslenme tercihini');
  await expect(page.getByTestId('memory-item')).toHaveCount(0);
});
