import { readConfig } from './config';
describe('configuration', () => {
  it('boots in mock mode without secrets', () => {
    expect(readConfig({}).LLM_PROVIDER).toBe('mock');
    expect(readConfig({}).BIND_HOST).toBe('0.0.0.0');
    expect(readConfig({ BIND_HOST: '127.0.0.1' }).BIND_HOST).toBe('127.0.0.1');
  });
  it('requires OpenAI credentials only in OpenAI mode', () => {
    expect(() => readConfig({ LLM_PROVIDER: 'openai' })).toThrow('OPENAI_API_KEY');
  });
  it('keeps product defaults in code instead of environment variables', () => {
    const config = readConfig({ SEARCH_TOP_K: '99', OPENAI_CHAT_MODEL: 'ignored' });
    expect(config.SEARCH_TOP_K).toBe(3);
    expect(config.OPENAI_CHAT_MODEL).toBe('gpt-4.1-mini');
  });
  it('rejects unknown providers and invalid boolean values', () => {
    expect(() => readConfig({ LLM_PROVIDER: 'typo' })).toThrow();
    expect(() => readConfig({ COOKIE_SECURE: 'yes' })).toThrow();
  });
});
