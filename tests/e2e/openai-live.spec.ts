import { test, expect } from '@playwright/test';

test.describe('Live OpenAI through browser, Next proxy, Nest agent and pgvector', () => {
  test.skip(process.env.RUN_LIVE_E2E !== '1', 'Explicit live API opt-in required');
  test.setTimeout(240000);
  test.beforeEach(async ({ request }) => {
    expect((await (await request.get('/api/health/ready')).json()).provider).toBe('openai');
  });

  test('P1 Turkish answers, sources, memory update/delete, summary continuity and user isolation', async ({
    page,
    browser,
  }) => {
    await page.goto('/');
    await expect(page.getByText('Yardım etmeye hazır')).toBeVisible();
    const input = page.getByRole('textbox', { name: 'Mesajın' });
    const send = async (content: string) => {
      const response = page.waitForResponse(
        (r) =>
          /\/api\/threads\/[^/]+\/messages$/.test(new URL(r.url()).pathname) &&
          r.request().method() === 'POST',
        { timeout: 65000 },
      );
      await input.fill(content);
      await input.press('Enter');
      expect((await response).status()).toBe(201);
      await expect(page.locator('.new-chat')).toBeEnabled();
      return page.locator('.message.assistant').last();
    };
    let answer = await send('İzin başvurusu nasıl yapılır?');
    await expect(answer).toContainText(/izin/i);
    // Multiple cited chunks can legitimately point to the same document.
    await answer
      .locator('.sources')
      .getByRole('button', { name: 'İzin politikası' })
      .first()
      .click();
    await expect(page.getByRole('dialog')).toContainText('5 iş günü');
    await page.getByRole('button', { name: 'Dokümanı kapat' }).click();
    const threadId = new URL(page.url()).pathname.split('/').pop();
    await send('Veganım');
    await expect(page.getByTestId('memory-item')).toContainText('Vegan');
    await send('Eskiden vegandım, artık vejetaryenim.');
    await expect(page.getByTestId('memory-item')).toHaveCount(1);
    await expect(page.getByTestId('memory-item')).toContainText('Vejetaryen');
    await send('Arkadaşım vegan.');
    await expect(page.getByTestId('memory-item')).toContainText('Vejetaryen');
    await page.getByRole('button', { name: 'Beslenme tercihi kaydını sil' }).click();
    await expect(page.getByTestId('memory-item')).toHaveCount(0);
    await page.getByRole('button', { name: 'Özeti göster' }).click();
    await expect(page.getByRole('region', { name: 'Konuşma özeti' })).toContainText(
      'İzin başvuru süreci',
    );
    await expect(page.getByRole('region', { name: 'Konuşma özeti' })).not.toContainText(
      /vegan|vejetaryen/i,
    );
    await page.getByRole('button', { name: 'Özeti kapat' }).click();
    answer = await send('Peki kaç gün önceden?');
    await expect(answer).toContainText(/5 iş gün/);
    await expect(answer.locator('.sources')).toContainText('İzin politikası');
    answer = await send('Beslenme tercihim ne?');
    await expect(answer).toContainText('bulunmuyor');
    answer = await send('Yemek seçenekleri neler?');
    await expect(answer.locator('.sources')).toContainText('Yemek kartı');
    await expect(answer).not.toContainText(
      /(vegan|vejetaryen) (tercih|oldu|beslen)|tercihin[^.]*(vegan|vejetaryen)/i,
    );
    await expect(page.getByTestId('memory-item')).toHaveCount(0);
    await expect(page.locator('.message.user')).toContainText([
      'İzin başvurusu',
      'Veganım',
      'Eskiden vegandım',
    ]);
    await expect(input).toBeFocused();
    await page.reload();
    await expect(page.locator('.message')).toHaveCount(14);
    await expect(page.getByRole('button', { name: 'Özeti göster' })).toBeVisible();

    const stranger = await browser.newContext();
    try {
      await stranger.request.post(new URL('/api/session', page.url()).href);
      await expect(
        (
          await stranger.request.get(new URL(`/api/threads/${threadId}/context`, page.url()).href)
        ).status(),
      ).toBe(404);
      await expect(
        (await stranger.request.get(new URL('/api/memories', page.url()).href)).json(),
      ).resolves.toEqual([]);
    } finally {
      await stranger.close();
    }
    await page.locator('.new-chat').click();
    answer = await send('Peki kaç gün önceden?');
    await expect(answer).toContainText('Hangi konuyu');
    await expect(answer.locator('.sources')).toHaveCount(0);
    answer = await send('Mars kaç kilometre?');
    await expect(answer).toContainText(/bulamadım|bulunmuyor|bilgi/i);
    await expect(answer.locator('.sources')).toHaveCount(0);
    await test.info().attach('live-chat-transcript', {
      body: JSON.stringify(await page.locator('.message').allTextContents()),
      contentType: 'application/json',
    });
  });

  test('P1 live embedding after document create/edit/delete returns only current evidence', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByText('Yardım etmeye hazır')).toBeVisible();
    const created = await page.request.post('/api/documents', {
      data: {
        title: 'Deneme arşiv dolabı',
        description: 'Arşiv dolabının açılma saati hakkında test rehberi.',
        content: 'Deneme arşiv dolabı saat 09:17 itibarıyla açılır.',
      },
    });
    expect(created.status()).toBe(201);
    const document = await created.json();
    const send = async () => {
      const t = await (await page.request.post('/api/threads')).json();
      await page.goto(`/chat/${t.id}`);
      const r = page.waitForResponse(
        (r) => r.request().method() === 'POST' && r.url().endsWith(`/threads/${t.id}/messages`),
        { timeout: 65000 },
      );
      await page
        .getByRole('textbox', { name: 'Mesajın' })
        .fill('Deneme arşiv dolabı saat kaçta açılır?');
      await page.getByRole('button', { name: 'Mesaj gönder' }).click();
      expect((await r).status()).toBe(201);
      return page.locator('.message.assistant').last();
    };
    try {
      await expect(await send()).toContainText('09:17');
      const updated = await page.request.patch(`/api/documents/${document.id}`, {
        data: {
          title: document.title,
          description: document.description,
          content: 'Deneme arşiv dolabı saat 10:43 itibarıyla açılır.',
          revision: document.revision,
        },
      });
      expect(updated.status()).toBe(200);
      const answer = await send();
      await expect(answer).toContainText('10:43');
      await expect(answer).not.toContainText('09:17');
      await expect(answer.locator('.sources')).toContainText('Deneme arşiv dolabı');
      expect((await page.request.delete(`/api/documents/${document.id}`)).status()).toBe(204);
      const missing = await send();
      await expect(missing).not.toContainText(/09:17|10:43/);
      await expect(missing.locator('.sources')).toHaveCount(0);
    } finally {
      await page.request.delete(`/api/documents/${document.id}`);
    }
  });
});
