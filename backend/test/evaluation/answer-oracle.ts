import { normalize } from '../../src/modules/llm/text';
/** Equivalent wording is allowed; numbers, action and actual cited evidence must still agree. */
export function supportsAnswer(answer: string, evidence: string): boolean {
  const text = normalize(answer);
  if (text.includes(normalize(evidence))) return true;
  const predicates: Record<string, RegExp> = {
    '20 iş günü': /(?:20|yirmi)\s+is gun/,
    '350 TL': /350\s*(?:tl|turk lirasi)/,
    'Haftada 2 gün': /hafta(?:da)?\s+(?:2|iki)\s+gun/,
    '09.00–18.00': /09[.:]00[\s\S]*18[.:]00/,
    '12.00–13.00': /12[.:]00[\s\S]*13[.:]00/,
    '1 iş günüdür': /(?:1|bir)\s+(?:is\s+)?gun/,
    'en az 5 iş günü': /en az\s+(?:5|bes)\s+is gun/,
    'kullanıma kapatılması': /kapat/,
    'bakiyesine geri eklenir': /(?:bakiye[\s\S]*(?:geri|iade)|geri[\s\S]*eklen)/,
    'şirket takviminden': /takvim[\s\S]*(?:rezer|ayir)/,
    'ziyaret saatini': /(?:saat[\s\S]*resepsiyon|resepsiyon[\s\S]*saat)/,
    'vejetaryen yemek seçeneği': /vejetaryen[\s\S]*yemek/,
    'bir önceki iş günü': /(?:bir|1) onceki is gun/,
    '10 dakika': /(?:10|on) dakika/,
    'VPN bağlantısı': /vpn/,
    'hata mesajı': /hata/,
    'alerjen bilgisini': /alerjen/,
  };
  return !!predicates[evidence]?.test(text);
}
