import { containsEvidence } from './evidence';
describe('source evidence', () => {
  it('accepts a verbatim clause with sentence punctuation and whitespace changes', () => {
    expect(
      containsEvidence('Tercihler dikkate alınır; limit sabittir.', 'Tercihler dikkate alınır.'),
    ).toBe(true);
    expect(containsEvidence('20 iş\ngünü.', '20 iş günü')).toBe(true);
    expect(
      containsEvidence(
        'Ayrıntı korunur. Ara cümle. Kayıt saklanır.',
        'Ayrıntı korunur. Kayıt saklanır.',
      ),
    ).toBe(true);
  });
  it('rejects altered numbers, partial numbers and fabricated words', () => {
    expect(containsEvidence('120 iş günü.', '20 iş günü.')).toBe(false);
    expect(containsEvidence('20 iş günü.', '200 iş günü.')).toBe(false);
    expect(containsEvidence('20 iş günü.', '20 takvim günü.')).toBe(false);
    expect(containsEvidence('20 iş günü.', '...')).toBe(false);
    expect(containsEvidence('20 iş günü. Kayıt saklanır.', '20 iş günü. Kayıt silinir.')).toBe(
      false,
    );
  });
});
