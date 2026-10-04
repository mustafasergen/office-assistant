# Ham AI oturumu teslim kaydı

[Case1 JSONL](ai-sessions/case1.jsonl), yalnız `01a101ac-fd06-77a2-aaa7-4fda7aed47e1` kimlikli bu Codex konuşmasının ham kayıt kopyasıdır. Başka oturumlar aktarılmadı. Mesajlar, araç çağrıları, sonuçlar, gömülü görseller ve sıralama korunur. Kayıtlar yeniden JSON olarak serileştirilmez; yalnız secret değerleri `[REDACTED]` ile değiştirilir. Kaynak oturum dosyası değiştirilmez.

## Kopyanın sınırı

**4 Ekim 2026 18:53:55 (Türkiye, UTC+03:00)** anına kadar **4.985 kayıt** içerir (`2026-10-04T15:53:55.784Z`). Toplam 372 credential eşleşmesi maskelendi.

Kesin başlangıç/bitiş zamanı, kayıt sayısı, byte sayısı ve SHA-256 değerleri [snapshot metadata'sında](ai-sessions/case1.metadata.json) yer alır. `lastRecordAt`, kopyaya dahil son kaydın UTC zamanıdır. Kopya; README/repo düzeni, testler ve iki veritabanının temizliği tamamlandıktan sonra alınmıştır. Aktarım sonucunu bildiren araç yanıtı, son kopyanın tarama çıktısı ve kapanış mesajı bu sınırdan sonradır. Kaynak dosya yeni kayıtlarla büyümeye devam edebilir.

## Secret denetimi

- Tüm JSONL taranır: geçmiş kullanıcı mesajları, araç argümanları/çıktıları ve iç içe JSON metinleri dahildir. Yalnız mevcut `.env` değerleriyle sınırlı değildir.
- API anahtarları, token/JWT biçimleri, imzalı cookie değerleri ve bağlantı URL'lerindeki kimlik bilgileri aranır. Bulunan parolaların URL-encoded/ham ve JSON-escaped biçimleri de maskelenir.
- Oturumdaki 28 farklı görsel yerel OCR ile incelendi; credential içeren görsel saptanmadı. Görsel verisi yeniden üretilmedi veya değiştirilmedi.
- Son kopya ve Git'e alınabilir dosyalar ayrıca bağımsız **Gitleaks 8.30.1** taramasından geçirildi. Sonuçlar ve incelenen teknik metin yanlış pozitifleri [tarama kaydında](ai-sessions/secret-scan.json) belirtilir. Genel bir tarayıcı her olası secret biçimini garanti etmez; tanınan değerlerin kalmadığı ek taramayla kontrol edilir.
- Snapshot alınırken kaynak dosyanın okunan byte önekinin aynı kaldığı doğrulanır. Dönüşüm yalnız literal eşleşmelerden oluşur; satır/kayıt sırası korunur.

Tek seçilmiş oturum için tekrar üretim:

```sh
node scripts/export-session.mjs /absolute/path/to/session.jsonl SESSION_ID docs/ai-sessions/case1.jsonl
```

Gerekirse dördüncü argümanla repo dışındaki özel bir JSON secret listesi verilebilir. Exporter tek başına nihai güvenlik denetiminin yerine geçmez; yeniden üretimden sonra bağımsız tarama da tekrarlanmalıdır. Kaynak dosyayla aynı hedefe yazılması ve yanlış session ID engellenir.

Ham oturum Git'e eklenebilir; Docker build context ve otomatik formatter dışında tutulur. Yedek veritabanları, özel arşiv ve maskesiz tarama ara dosyaları repo dışındadır.
