// Replace credentials only. Do not parse/stringify the exported JSONL records.
export function secretCandidates(texts) {
  const secrets = new Set();
  const add = (value) => {
    if (!value || value.includes('[REDACTED]')) return;
    secrets.add(value);
  };
  for (const text of texts) {
    for (const pattern of [
      /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/g,
      /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})\b/g,
      /\b(?:sb_secret_|rnd_)[A-Za-z0-9_-]{20,}\b/g,
      /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
      /s(?:%3A|:)[0-9a-f-]{36}(?:%2E|\.)[A-Za-z0-9_%+/-]{30,}/gi,
    ])
      for (const match of text.matchAll(pattern)) add(match[0]);
    for (const match of text.matchAll(/\b(?:postgres(?:ql)?|https?|redis):\/\/([^\s"'<>\\]+)@/gi)) {
      const credentials = match[1];
      if (!credentials.includes(':')) continue;
      add(credentials);
      const password = credentials.slice(credentials.indexOf(':') + 1);
      if (password.length >= 8 && /\d/.test(password) && /[a-z]/i.test(password)) {
        add(password);
        try {
          add(decodeURIComponent(password));
        } catch {
          /* Invalid percent escape is retained. */
        }
      }
    }
    for (const match of text.matchAll(
      /(?:API_KEY|COOKIE_SECRET|ACCESS_TOKEN|AUTH_TOKEN|PASSWORD|SECRET_KEY)\s*["']?\s*[:=]\s*["']?([^\s"'`,;}{)]+)|Bearer\s+([A-Za-z0-9._~+/-]{16,})/gi,
    )) {
      const value = match[1] || match[2];
      // Ignore placeholders, variable names, and literal source-code expressions.
      if (
        value.length >= 16 &&
        /\d/.test(value) &&
        /[a-z]/i.test(value) &&
        !/[<>$[\](]/.test(value)
      )
        add(value);
    }
  }
  return [...secrets];
}

export function collectText(raw) {
  const texts = [raw];
  const visit = (value, depth = 0) => {
    if (typeof value === 'string') {
      texts.push(value);
      if (depth < 4 && /^\s*[[{]/.test(value)) {
        try {
          visit(JSON.parse(value), depth + 1);
        } catch {
          /* Normal prose. */
        }
      }
    } else if (Array.isArray(value)) value.forEach((v) => visit(v, depth));
    else if (value && typeof value === 'object')
      Object.values(value).forEach((v) => visit(v, depth));
  };
  for (const line of raw.split('\n')) if (line.trim()) visit(JSON.parse(line));
  return texts;
}

export function redact(raw, secrets) {
  const variants = new Set();
  for (const value of secrets) {
    for (const initial of [value, encodeURIComponent(value)]) {
      let escaped = initial;
      for (let depth = 0; depth < 5; depth++) {
        variants.add(escaped);
        escaped = JSON.stringify(escaped).slice(1, -1);
      }
    }
  }
  const escaped = [...variants]
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  let replacements = 0;
  const output = escaped.length
    ? raw.replace(new RegExp(escaped.join('|'), 'g'), () => {
        replacements++;
        return '[REDACTED]';
      })
    : raw;
  for (const line of output.split('\n')) if (line.trim()) JSON.parse(line);
  return { output, replacements };
}
