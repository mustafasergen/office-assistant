# Manuel soruların düzeltilmesi — 4 Ekim 2026

Üç soru, repodaki dört özgün fixture ile yeni `manual_fix_test` PostgreSQL/pgvector veritabanında yeniden üretildi. Mevcut `render_test` (3003), ana yerel ortam (3000) ve Supabase test verisi olarak kullanılmadı.

| Soru | Doğru chunk skoru (önce/sonra aynı) | Önce | Sonra |
| --- | --- | --- | --- |
| Yıllık izin hakkım kaç iş günü? | 0,684285 | Kaynak aramada var; cevap seçimi reddediyor | 20 iş günü + İzin politikası |
| Toplantı odasını nasıl rezerve ederim? | 0,372446 | Kaynak aramada var; cevap seçimi reddediyor | Şirket takviminden rezervasyon + Ofis kuralları |
| Ofiste telefon görüşmelerini nerede yapabilirim? | 0,373695 | Kaynak aramada var; cevap seçimi reddediyor | Telefon kabinleri veya toplantı odaları + Ofis kuralları |

Neden: `groundedMockMatches` sorgunun her içerik kelimesini kaynakta arıyor; `hakkım/hakkı`, `odasını/odaları`, `görüşmelerini/görüşmesi` aynı köke gelmiyordu. `ederim` ve `nerede` gibi soru/yardımcı sözcükler de gerçek içerik ayrıntısı sayılıyordu. Yalnız kanıt eşleştirmesine sınırlı Türkçe ek normalizasyonu eklendi. Embedding tokenizer, embeddingKey, 1536 boyut, mock 0,16/OpenAI 0,40 eşikleri ve topK ayarları değişmedi. İçerik kelimelerinin tamamını karşılama ve chunk kaynak doğrulaması korunur.

Konum sorusunda sadece en çok kelime örtüşen “sessiz alanda yapılmaz” cümlesi yeterli değildir. İzin verilen yeri anlatan devam cümlesi de korunur. Konum cevabı için kaynakta açık olumlu yer/eylem ifadesi aranır; “Yıllık izin hakkım nerede?” gibi ayrıntısı dokümanda olmayan bir soruya sırf konular benziyor diye kaynaklı cevap verilmez. Ücret/banka/kayıt uygulaması gibi bilinmeyen ek ayrıntılar da negatif testlerdedir.

`isAcknowledgement` sadece kısa, tam onay ifadelerini ayırır. `Peki.` / `Peki!` / `Tamam.` onaydır. `Peki?` belirsizdir; `Peki kaç gün önceden?` mevcut konu kurallarını kullanır. Mock onay cevabı şirket konularını gereksiz yere tekrar etmez; konu durumu değişmez. OpenAI için aynı resolveFollowUp ayrımı gerçek API ile sınandı.

Mevcut 22 mesaj testi korundu: ilk izin başvurusu turundan sonra on teşekkür turu, sekiz yakın ham mesajda izin/başvuru/5 iş günü bulunmadığını doğrular. İzin konusu yalnız özette kalırken devam sorusu doğru kaynakla yanıtlanır. Canlı OpenAI'deki mevcut uzun geçmiş testi aynı assertion ile güçlendirildi; duplicate test yazılmadı. UI metni “Özetlenen bölümdeki son konu” oldu; yakın mesajların güncel konusuymuş gibi sunulmaz.

## Çalıştırılan kontroller

- 72/72 unit/sahte SDK.
- 33/33 gerçek PostgreSQL entegrasyonu; üç soru ve yakın negatifleri, onay, hafıza silme/güncelleme, eski kişisel bilgi, kaynaklar, kullanıcı ayrımı ve özet.
- 137/137 geniş mock değerlendirmesi.
- 13/13 gerçek OpenAI API senaryosu; ayrı yerel PostgreSQL üzerinde. Bu tur Supabase veya gerçek OpenAI tarayıcı testi yapılmadı.
- 19/19 mock tarayıcı testi; production Docker imajı, 3004 izole servis. Ücretli opt-in tarayıcı testleri bu tur atlandı; gerçek API kontrolleri üstteki runner ile çalıştırıldı.
- Lint, typecheck ve production Docker build başarılı.

Kanıt dosyaları: `docs/test-reports/manual-questions-{before,after}.json`, `manual-fixes-{unit,integration,browser,openai-live,preservation}.json` ve `docs/evaluation/manual-fixes-mock.{json,md}`. Düzeltme sonrası ölçüm kendi test DB'sini fixture'lardan yeniden hazırlar; başka testlerin bilinçli doküman silmesi ölçümü etkilemez.

3003 manuel servisi aynı DB ile son imaja geçirilir; altı tablonun önce/sonra hash karşılaştırması preservation raporunda yer alır. Bu görevde `.env`, fixture dosyaları ve Supabase değiştirilmez. Commit/push/deploy yapılmaz.
