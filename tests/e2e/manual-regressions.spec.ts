import { test, expect } from '@playwright/test';

for (const [question, answer, title] of [
  ['Yıllık izin hakkım kaç iş günü?', '20 iş günü', 'İzin politikası'],
  ['Toplantı odasını nasıl rezerve ederim?', 'şirket takviminden rezerve edilir', 'Ofis kuralları'],
  [
    'Ofiste telefon görüşmelerini nerede yapabilirim?',
    'telefon kabinlerinde veya toplantı odalarında',
    'Ofis kuralları',
  ],
]) {
  test(`manual mock question: ${question}`, async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('Yardım etmeye hazır')).toBeVisible();
    await page.getByRole('textbox', { name: 'Mesajın' }).fill(question);
    await page.getByRole('button', { name: 'Mesaj gönder' }).click();
    const response = page.locator('.message.assistant').last();
    await expect(response).toContainText(answer);
    await expect(response.locator('.sources')).toContainText(title);
  });
}

test('bare acknowledgement does not interrupt leave follow-up context', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Yardım etmeye hazır')).toBeVisible();
  const send = async (content: string) => {
    await page.getByRole('textbox', { name: 'Mesajın' }).fill(content);
    await page.getByRole('button', { name: 'Mesaj gönder' }).click();
    await expect(page.locator('.new-chat')).toBeEnabled();
    return page.locator('.message.assistant').last();
  };
  await send('İzin başvurusu nasıl yapılır?');
  await expect(await send('Peki.')).not.toContainText(/kastediyor|bulamadım|anlayamadım/);
  const response = await send('Peki kaç gün önceden?');
  await expect(response).toContainText('5 iş günü');
  await expect(response.locator('.sources')).toContainText('İzin politikası');
});
