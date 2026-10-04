import { createHash } from 'node:crypto';
import { EMBEDDING_DIMENSIONS } from './llm.types';

export function normalize(text: string): string {
  return text
    .toLocaleLowerCase('tr-TR')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ı/g, 'i');
}
const stop = new Set(
  've veya bir bu su icin ile de da mi mu ne nasil nedir kac kadar benim ben bana bize var olan olarak hangi hakkinda misin bilgi verir misiniz lutfen sirket sirketin uplico yapmaliyim yapilir edilir etmek edersem verilmeli icinde istiyorum ogrenmek soyle soylesene bana kac gunluk calisanlar calisanlarin benim tercihim beslenme alabilir miyim olur olursa mi ne zaman ne kadar hakkimiz soruyorum bildirilmeli bildiriliyor bilmeli bildirilir bilmeliyim vermeliyim kalir is ise neler'.split(
    ' ',
  ),
);
const aliases: Record<string, string> = {
  calisma: 'calisma',
  odas: 'oda',
  kartim: 'kart',
  saat: 'saat',
  calismasi: 'calisma',
  kurali: 'kural',
  iptalini: 'iptal',
  gunum: 'gun',
  kullanim: 'kullan',
  kurallari: 'kural',
  izni: 'izin',
  iznimi: 'izin',
  izn: 'izin',
  izinleri: 'izin',
  izinde: 'izin',
  talebimi: 'talep',
  talebi: 'talep',
  talep: 'talep',
  basvurusu: 'talep',
  onceden: 'once',
  iletmeliyim: 'ilet',
  iletilir: 'ilet',
  kaybolan: 'kayip',
  kaybolursa: 'kayip',
  kayboldugunda: 'kayip',
  oglen: 'ogle',
  mola: 'ara',
  arasi: 'ara',
  saatimiz: 'saat',
  saatleri: 'saat',
  ziyaretci: 'misafir',
  misafr: 'misafir',
  misafirler: 'misafir',
  getirmek: 'kabul',
  getirme: 'kabul',
  kabulu: 'kabul',
  limti: 'limit',
  yemk: 'yemek',
  odasi: 'oda',
  odalari: 'oda',
  rezarvasyonu: 'rezervasyon',
  rezervasyonu: 'rezervasyon',
  rezerve: 'rezervasyon',
  calsima: 'calisma',
  evden: 'uzaktan',
  mesai: 'calisma',
  haftalik: 'hafta',
  haftada: 'hafta',
  gunlerim: 'gun',
  gunler: 'gun',
  gunleri: 'gun',
  geri: 'geri',
  gelir: 'eklenir',
  ofise: 'ofis',
  uygunluk: 'uygun',
  secenegi: 'secenek',
  calismak: 'calisma',
  calisirken: 'calisma',
  baglanirken: 'erisim',
  erisim: 'erisim',
  baglantiyi: 'baglanti',
  baglantisi: 'baglanti',
  acmaliyim: 'acilir',
  kullanilmayan: 'kullanilmayan',
  bosalir: 'serbest',
  odalar: 'oda',
  alerjisi: 'alerji',
  alerjen: 'alerji',
  izinler: 'izin',
  iznim: 'izin',
  izinli: 'izin',
  yemegi: 'yemek',
  yemekleri: 'yemek',
  yemekte: 'yemek',
  yemekler: 'yemek',
  karti: 'kart',
  kartinin: 'kart',
  kart: 'kart',
  limiti: 'limit',
  limitim: 'limit',
  gunluk: 'gun',
  gunu: 'gun',
  ofiste: 'ofis',
  ofisin: 'ofis',
  kurallar: 'kural',
  calisiyoruz: 'calisma',
  calisabilirim: 'calisma',
  uzaktan: 'uzaktan',
  secenekleri: 'secenek',
  secenekler: 'secenek',
  vejetaryenim: 'vejetaryen',
  veganim: 'vegan',
  calsma: 'calisma',
  menusu: 'menu',
  menude: 'menu',
};
export function tokens(text: string): string[] {
  return (normalize(text).match(/[a-z0-9]+/g) ?? [])
    .filter((word) => word.length > 1 && !stop.has(word))
    .flatMap((word) => {
      const base = word.length > 5 ? word.replace(/(?:dir|dur|tir|tur)$/, '') : word;
      const token = aliases[word] ?? aliases[base] ?? base;
      return token === 'menu' ? ['yemek', 'secenek'] : [token];
    });
}
export function hashEmbedding(text: string, dimensions = EMBEDDING_DIMENSIONS): number[] {
  const vector = Array<number>(dimensions).fill(0);
  for (const token of tokens(text)) {
    const hash = createHash('sha256').update(token).digest();
    vector[hash.readUInt32BE(0) % dimensions] += (hash[4] & 1) === 0 ? 1 : -1;
  }
  const norm = Math.hypot(...vector);
  return norm === 0 ? vector : vector.map((value) => value / norm);
}
