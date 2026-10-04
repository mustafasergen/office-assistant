import { test, expect } from '@playwright/test';

test('first message keeps the composer, focus and messages without reloading session/history', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Yardım etmeye hazır')).toBeVisible();
  const input = page.getByRole('textbox', { name: 'Mesajın' });
  const composer = await input.elementHandle();
  const bounds = await input.boundingBox();
  const redundantReads: string[] = [];
  page.on('request', (request) => {
    const path = new URL(request.url()).pathname;
    if (
      path === '/api/session' ||
      (request.method() === 'GET' && /\/messages$/.test(path)) ||
      path === '/api/documents'
    )
      redundantReads.push(path);
  });
  // Slow the answer so the optimistic state and keyboard focus can be checked reliably.
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/api/threads/*/messages', async (route) => {
    if (route.request().method() === 'POST') await gate;
    await route.continue();
  });
  await input.fill('Yıllık izin kaç gün?');
  await input.press('Enter');
  await expect(page.locator('.message.user')).toContainText('Yıllık izin kaç gün?');
  await expect(input).toBeFocused();
  release();
  await expect(page.locator('.message.assistant')).toContainText('20 iş günü');
  await expect(page).toHaveURL(/\/chat\/[^/]+$/);
  await expect(page.locator('.new-chat')).toBeEnabled();
  expect(await composer!.evaluate((element) => element.isConnected)).toBe(true);
  await expect(input).toBeFocused();
  expect(redundantReads).toEqual([]);
  expect(await input.boundingBox()).toEqual(bounds);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  const firstUrl = page.url();
  await input.fill('Yemek kartı limiti ne kadar?');
  await input.press('Enter');
  await expect(page.locator('.message.assistant')).toHaveCount(2);
  await expect(page.locator('.new-chat')).toBeEnabled();
  expect(page.url()).toBe(firstUrl);
  expect(redundantReads).toEqual([]);
  await expect(page.locator('.thread-row')).toHaveCount(1);
});

test('promoted URL supports reload, old threads, back/forward and active conversation deletion', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Yardım etmeye hazır')).toBeVisible();
  await page.getByRole('textbox', { name: 'Mesajın' }).fill('Yıllık izin kaç gün?');
  await page.getByRole('textbox', { name: 'Mesajın' }).press('Enter');
  await expect(page.locator('.message.assistant')).toContainText('20 iş günü');
  await expect(page).toHaveURL(/\/chat\/[^/]+$/);
  await expect(page.locator('.new-chat')).toBeEnabled();
  const firstUrl = page.url();
  await page.locator('.new-chat').click();
  await expect(page.getByText('Merhaba, iyi ki buradasın.')).toBeVisible();
  await expect(page.getByText('Yardım etmeye hazır')).toBeVisible();
  const secondUrl = page.url();
  expect(secondUrl).not.toBe(firstUrl);
  await page.getByRole('textbox', { name: 'Mesajın' }).fill('Yemek kartı limiti ne kadar?');
  await page.getByRole('textbox', { name: 'Mesajın' }).press('Enter');
  await expect(page.locator('.message.assistant')).toContainText('350');
  await expect(page.locator('.new-chat')).toBeEnabled();
  await page.goBack();
  await expect(page).toHaveURL(firstUrl);
  await expect(page.locator('.message.assistant')).toContainText('20 iş günü');
  await expect(page.locator('.message.user')).toHaveCount(1);
  await page.goForward();
  await expect(page).toHaveURL(secondUrl);
  await expect(page.locator('.message.assistant')).toContainText('350');
  await page.getByRole('button', { name: 'Yıllık izin kaç gün?', exact: true }).click();
  await expect(page).toHaveURL(firstUrl);
  await expect(page.locator('.message.assistant')).toContainText('20 iş günü');
  await page.reload();
  await expect(page.locator('.message.assistant')).toContainText('20 iş günü');
  await expect(page.locator('.thread-list button.active')).toHaveText('Yıllık izin kaç gün?');
  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'Yıllık izin kaç gün? konuşmasını sil' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Yardım etmeye hazır')).toBeVisible();
  await expect(page.locator('.message')).toHaveCount(0);
});

test('a failed first message keeps its thread and allows retry without creating another one', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.getByText('Yardım etmeye hazır')).toBeVisible();
  let fail = true;
  await page.route('**/api/threads/*/messages', async (route) => {
    if (route.request().method() === 'POST' && fail) {
      fail = false;
      await route.fulfill({ status: 503, json: { message: 'Geçici test hatası' } });
    } else await route.continue();
  });
  const input = page.getByRole('textbox', { name: 'Mesajın' });
  await input.fill('Yıllık izin kaç gün?');
  await input.press('Enter');
  await expect(page.locator('.error-banner')).toContainText('Geçici test hatası');
  await expect(page).toHaveURL(/\/chat\/[^/]+$/);
  const url = page.url();
  await expect(input).toHaveValue('Yıllık izin kaç gün?');
  await expect(input).toBeFocused();
  await input.press('Enter');
  await expect(page.locator('.message.assistant')).toContainText('20 iş günü');
  await expect(page.locator('.new-chat')).toBeEnabled();
  expect(page.url()).toBe(url);
  await expect(page.locator('.thread-row')).toHaveCount(1);
});
