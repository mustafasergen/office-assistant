import { test, expect } from '@playwright/test';

test('sources, memory save/delete, and memory across new conversations', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Yardım etmeye hazır')).toBeVisible();
  await page.getByRole('button', { name: /Biraz mola zamanı/ }).click();
  await expect(page.locator('.message.assistant')).toContainText('20 iş günü');
  await page.locator('.sources').getByRole('button', { name: 'İzin politikası' }).click();
  await expect(page.getByRole('dialog')).toContainText('20 iş günüdür');
  await page.getByRole('button', { name: 'Dokümanı kapat' }).click();

  await page.getByRole('textbox', { name: 'Mesajın' }).fill('Vejetaryenim');
  await page.getByRole('button', { name: 'Mesaj gönder' }).click();
  await expect(page.getByTestId('memory-item')).toContainText('Vejetaryen');
  await page.getByRole('button', { name: /Yeni konuşma/ }).click();
  await expect(page.getByText('Merhaba, iyi ki buradasın.')).toBeVisible();
  await page.getByRole('textbox', { name: 'Mesajın' }).fill('Yemek seçenekleri neler?');
  await page.getByRole('button', { name: 'Mesaj gönder' }).click();
  await expect(page.locator('.message.assistant')).toContainText('Beslenme tercihini (vejetaryen)');

  await page.getByRole('button', { name: 'Beslenme tercihi kaydını sil' }).click();
  await expect(page.getByTestId('memory-item')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Mesajın' }).fill('Beslenme tercihim ne?');
  await page.getByRole('button', { name: 'Mesaj gönder' }).click();
  await expect(page.locator('.message.assistant').last()).toContainText(
    'Beslenme tercihi bilgisi şu an hafızamda bulunmuyor.',
  );
  await expect(page.getByTestId('memory-item')).toHaveCount(0);
  await page.getByRole('button', { name: /Yeni konuşma/ }).click();
  await page.getByRole('textbox', { name: 'Mesajın' }).fill('Yemek seçenekleri neler?');
  await page.getByRole('button', { name: 'Mesaj gönder' }).click();
  await expect(page.locator('.message.assistant')).toBeVisible();
  await expect(page.locator('.message.assistant')).not.toContainText('Beslenme tercihini');
  await page.reload();
  await expect(page.locator('.message.assistant')).toBeVisible();
  await expect(page.getByTestId('memory-item')).toHaveCount(0);
});

test('mobile layout exposes conversation and knowledge panels without overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByText('Yardım etmeye hazır')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Bilgi ve hafıza panelini aç' }).click();
  await expect(page.getByRole('heading', { name: 'Bilgi kütüphanesi' })).toBeVisible();
  await page.getByRole('button', { name: 'Bilgi panelini kapat' }).click();
  await page.getByRole('button', { name: 'Konuşmaları aç' }).click();
  await expect(page.getByRole('button', { name: /Yeni konuşma/ })).toBeVisible();
});
