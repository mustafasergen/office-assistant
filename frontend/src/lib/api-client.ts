export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { 'Content-Type': 'application/json', ...options.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(
      typeof body?.message === 'string'
        ? body.message
        : 'İşlem tamamlanamadı. Lütfen tekrar deneyin.',
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
