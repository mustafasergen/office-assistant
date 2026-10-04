import test from 'node:test';
import assert from 'node:assert/strict';
import { collectText, secretCandidates, redact } from '../../scripts/session-redaction.mjs';

test('old credentials in messages, tool arguments and outputs are redacted without rewriting records', () => {
  const key = 'sk-proj-' + 'a1B2c3D4'.repeat(8);
  const password = 'Old-Password%123';
  const cookie = 's:00000000-0000-4000-8000-000000000000.' + 'Ab1'.repeat(15);
  const url = `postgresql://owner:${encodeURIComponent(password)}@example.com/postgres`;
  const lines = [
    { type: 'message', text: `key ${key}; password ${password}` },
    { type: 'tool', arguments: JSON.stringify({ command: `DATABASE_URL=${url}` }) },
    { type: 'output', text: `cookie ${cookie}; plain: normal content` },
  ];
  const raw = lines.map((v) => JSON.stringify(v)).join('\n') + '\n';
  const result = redact(raw, secretCandidates(collectText(raw)));
  assert.equal(result.output.split('\n').length, raw.split('\n').length);
  for (const secret of [key, password, encodeURIComponent(password), cookie])
    assert.ok(!result.output.includes(secret));
  assert.ok(result.output.includes('example.com/postgres'));
  assert.ok(result.output.includes('plain: normal content'));
  assert.deepEqual(
    result.output
      .trim()
      .split('\n')
      .map((x) => JSON.parse(x).type),
    lines.map((x) => x.type),
  );
});

test('only exact secret spans change; nested escaping remains valid', () => {
  const secret = 'a"b\\c123-secret';
  const raw = '{"text":' + JSON.stringify(JSON.stringify({ secret, value: 7 })) + '}\n';
  const { output } = redact(raw, [secret]);
  const expected =
    '{"text":' + JSON.stringify(JSON.stringify({ secret: '[REDACTED]', value: 7 })) + '}\n';
  assert.equal(output, expected);
});

test('empty findings preserve every byte including images, whitespace and placeholders', () => {
  const raw =
    ' { "text": "OPENAI_API_KEY=<OPENAI_API_KEY>", "image":"data:image/png;base64,aGVsbG8=" }\n';
  assert.equal(redact(raw, secretCandidates(collectText(raw))).output, raw);
});
