/** Product behavior belongs in code. Environment config contains deployment choices/secrets. */
export const APP_DEFAULTS = {
  OPENAI_CHAT_MODEL: 'gpt-4.1-mini',
  OPENAI_EMBEDDING_MODEL: 'text-embedding-3-small',
  OPENAI_TEMPERATURE: 0,
  AGENT_MAX_STEPS: 6,
  AGENT_TIMEOUT_MS: 60_000,
  SEARCH_TOP_K: 3,
};

export const SEARCH_MIN_SCORES = { mock: 0.16, openai: 0.4 };

export const SEARCH_TOP_K_BY_PROVIDER = { mock: 3, openai: 5 };
export const CHUNK_DEFAULTS = { maxWords: 200, overlap: 30, descriptionWeight: 0.25 };
