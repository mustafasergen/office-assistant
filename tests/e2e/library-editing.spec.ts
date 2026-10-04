import { test, expect } from '@playwright/test';

let createdId: string | undefined;
test.afterEach(async ({ page }) => {
  if (createdId) await page.request.delete(`/api/documents/${createdId}`);
  createdId = undefined;
});

test('creates, edits and removes library content and deletes a conversation', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Yardım etmeye hazır')).toBeVisible();
  if (await page.getByRole('button', { name: 'Bilgi ve hafıza panelini aç' }).isVisible())
    await page.getByRole('button', { name: 'Bilgi ve hafıza panelini aç' }).click();
  const title = `Test rehberi ${Date.now()}`;
  await page.getByRole('button', { name: 'Doküman ekle' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('textbox', { name: 'Başlık', exact: true }).fill(title);
  await dialog
    .getByRole('textbox', { name: 'Alt açıklama', exact: true })
    .fill('Kısa test açıklaması');
  await dialog
    .getByRole('textbox', { name: 'İçerik', exact: true })
    .fill('Test rehberindeki toplantı odası KOBALT olarak adlandırılır.');
  const createdResponse = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/documents') && response.request().method() === 'POST',
  );
  await dialog.getByRole('button', { name: 'Kaydet', exact: true }).click();
  const created = await (await createdResponse).json();
  expect(created.id).toBeTruthy();
  createdId = created.id;
  await expect(dialog).not.toBeVisible();
  await page
    .locator('.document-list')
    .getByRole('button', { name: new RegExp(title) })
    .click();
  await dialog.getByRole('button', { name: 'Düzenle', exact: true }).click();
  await dialog.getByRole('textbox', { name: 'Başlık', exact: true }).fill(`${title} güncel`);
  await dialog.getByRole('textbox', { name: 'Alt açıklama', exact: true }).fill('');
  await dialog
    .getByRole('textbox', { name: 'İçerik', exact: true })
    .fill('Test rehberindeki toplantı odası MERCAN olarak güncellenmiştir.');
  await dialog.getByRole('button', { name: 'Kaydet', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.reload();
  await expect(page.getByText('Yardım etmeye hazır')).toBeVisible();
  if (await page.getByRole('button', { name: 'Bilgi ve hafıza panelini aç' }).isVisible())
    await page.getByRole('button', { name: 'Bilgi ve hafıza panelini aç' }).click();
  await page
    .locator('.document-list')
    .getByRole('button', { name: new RegExp(`${title} güncel`) })
    .click();
  await expect(dialog).toContainText('MERCAN');
  await expect(dialog).not.toContainText('KOBALT');
  await expect(dialog).not.toContainText('Kısa test açıklaması');
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await dialog.getByRole('button', { name: 'Dokümanı sil' }).click();
  await expect(dialog).toBeVisible();
  page.once('dialog', (confirmation) => confirmation.accept());
  await dialog.getByRole('button', { name: 'Dokümanı sil' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.locator('.document-list').getByRole('button', { name: new RegExp(title) }),
  ).toHaveCount(0);
  if (await page.getByRole('button', { name: 'Bilgi panelini kapat' }).isVisible())
    await page.getByRole('button', { name: 'Bilgi panelini kapat' }).click();
  await page.getByRole('button', { name: /Yeni konuşma/ }).click();
  await expect(page).toHaveURL(/\/chat\//);
  const threadUrl = page.url();
  const row = page.locator('.thread-row').filter({ has: page.locator('button.active') });
  page.once('dialog', (confirmation) => confirmation.dismiss());
  await row.getByRole('button', { name: 'Yeni konuşma konuşmasını sil' }).click();
  await expect(page).toHaveURL(threadUrl);
  page.once('dialog', (confirmation) => confirmation.accept());
  await row.getByRole('button', { name: 'Yeni konuşma konuşmasını sil' }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByText('Merhaba, iyi ki buradasın.')).toBeVisible();
  expect(
    (
      await page.request.get(
        new URL(threadUrl).pathname.replace('/chat/', '/api/threads/') + '/messages',
      )
    ).status(),
  ).toBe(404);
});
