# Konuşma özeti ve güncel hafıza

Özet, iki provider için aynı deterministik konu listesidir. Serbest metin veya LLM ile yazılmış kişisel bilgi özeti değildir. Kullanıcı değerleri, alıntılar ve politika sayıları özette tutulmaz. OpenAI sistem yönergeleri, tool açıklamaları ve çıktı şeması açıklamaları İngilizcedir; kullanıcı mesajları/dokümanlar kaynak dilinde veri olarak iletilir ve cevaplar Türkçedir.

## Akış

- Tamamlanmış geçmiş 20 mesajı veya 12.000 karakteri aşınca eski bölüm özetlenir; son en fazla 8 mesaj/8.000 karakter, tam konuşma çiftleri halinde tutulur. Eşik kullanıcı+asistan toplamıdır.
- `threads.context_summary`: sürüm, güvenli konu anahtarları, son açık konu ve işlenen son `context_order`. Konu listesi en fazla sekiz şirket konusudur.
- `users.memory_revision` her gerçek kayıt/güncelleme/silmede artar. Aynı değeri tekrar söylemek artırmaz. `messages.context_revision` geçmişin hangi hafıza sürümüne ait olduğunu belirtir.
- Hafıza değiştiğinde eski sürüm ham mesajlar model bağlamından çıkarılır; eşik beklenmeden kişisel olmayan konuları özetlenir. Sohbet kayıtları ve UI'daki mesajlar silinmez.
- Bir çalıştırma kendi `save_memory` çağrısıyla hafızayı değiştirirse eski provider devam durumu atılır; güncel hafıza ve eşleşen tool çağrısı/sonuç çiftleriyle devam edilir. Dışarıdan eşzamanlı değişiklikte eski cevap yayımlanmaz: kontrollü 409 ve tekrar gönderme mesajı döner. Final kayıt sırasında da sürüm, kısa DB kilidi altında doğrulanır; API çağrısı boyunca transaction tutulmaz.
- Geçmiş sürümlerde kaydedilen mesajlar migration ile `-1` alır. Eski silinen bilginin yeniden modele verilmesini önlemek için ilk okumada yalnız güvenli konu işaretleri tutulur.
- Özetin ilerleme noktası karşılaştırmalı güncellenir; iki okuyucu eski özeti yenisinin üzerine yazamaz. Uzun geçmiş 500 mesajlık sınırlı gruplarla işlenir. Özetin yanıt kaydından sonraki geçici hatası başarılı sohbeti başarısız yapmaz; sonraki okumada tekrar hazırlanır.

## Devam soruları ve kaynaklar

`Peki kaç gün önceden?`, yalnız son açık konu izin başvurusuysa `Yıllık izin talebi kaç gün önceden iletilir?` olarak güncel bilgi tabanından aranır. Birden fazla konu, başka yeni konu veya yetersiz bağlam varsa kısa açıklama sorusu gelir. Eski özet yeni açık konudan öncelikli değildir. Özet kaynak sayılmaz; cevapların kanıt ve chunk doğrulaması aynen uygulanır. Doküman düzenlenince eski özet içindeki sayı kullanılmaz çünkü özet sayı saklamaz.

Bu, sekiz tanımlı şirket konusunu koruyan dar ve güvenilir bir case çözümüdür. Her serbest konuşma konusunu, zamiri veya takip cümlesini semantik olarak çözme iddiası yoktur. Yeni konu aileleri ve devam soruları açık kurallar/testlerle eklenebilir. Özet başına ek LLM çağrısı, embedding veya maliyet yoktur.

## UI / API

`GET /api/threads/:id/context` aynı kullanıcı sahipliği kontrolüyle `{summary: string | null}` döndürür. Mesaj POST cevabına `context` eklenir; mesaj geçmişi endpoint'i değişmez. Özet varsa ayrılmış küçük alanda “Önceki mesajlar özetlenerek kullanılıyor” ve “Özeti göster” görünür. Açılır alan eski mesajları yeniden yüklemez; Escape ile kapanır. Eşik geçişi, masaüstü/mobil yerleşim, odak ve scroll otomatik tarayıcı testlerindedir.

## Test kapsamı

| Öncelik | Ürün beklentisi | Kontrol |
| --- | --- | --- |
| P1 | Silinen/güncellenen kişisel değer geri gelmez | Eşik öncesi silme, değişim, üç tekrar, eski transcript, hafızaya tekrar yazılmaması |
| P1 | Kullanıcı/konuşma verileri karışmaz | Farklı cookie için 404; yeni thread eski konuya sahip olmaz; aynı kullanıcının güncel hafızası paylaşılır |
| P1 | Yanlış/eski kaynak verilmez | Özette politika değeri yok; retrieval yeniden yapılır; doküman güncelleme/silme sonrası güncel cevap |
| P2 | Açık konu korunur, belirsizlikte tahmin yapılmaz | İzin → hafıza değişimi → devam; yeni yemek konusu; birden fazla makul konu; bağlamsız soru |
| P2 | Özet sınırları ve yarışlar güvenlidir | 20/22 mesaj, uzun metin, sınırlı geçmiş, idempotent okuma, eşzamanlı silme/güncelleme, özetleme hatası |
| P3 | Sohbet kesilmez | Eski mesajlar, textarea DOM düğümü/odak/konum, scroll, 390px/1440px, aç/kapat ve yenileme |

Ham sonuçlar `docs/test-reports/conversation-summary-*.json`, `docs/evaluation/manual-fixes-mock.{json,md}` ve `docs/evaluation/conversation-summary-english-live.{json,md}` dosyalarındadır. Unit/OpenAI sözleşme testleri sahte SDK kullanır; canlı test olarak sayılmaz. `context-live.ts`, `EVAL_LIVE_LOCAL=1` değerlendirmesi ve `RUN_LIVE_E2E=1` tarayıcı testleri gerçek OpenAI API çağırır. Canlı testler yalnız izole yerel PostgreSQL/pgvector üzerindedir; Supabase/Render doğrulaması değildir.

```sh
pnpm lint
pnpm typecheck
pnpm --filter backend test
# Yalnız boşaltılabilen, *_test adlı veritabanı:
TEST_DATABASE_URL=postgresql://.../render_test pnpm test:integration
BASE_URL=http://localhost:3003 pnpm test:e2e
# Ücretli, açık opt-in. Yerel *_test DB; .env anahtarı sadece backend'de okunur:
RUN_LIVE_CONTEXT=1 TEST_DATABASE_URL=postgresql://.../render_test pnpm --filter backend exec tsx test/context-live.ts
# Çalışan test servisi gerçekten LLM_PROVIDER=openai olmalıdır:
RUN_LIVE_E2E=1 BASE_URL=http://localhost:3003 pnpm exec playwright test openai-live.spec.ts
```

Normal `.env`, yerel Compose düzeni ve mevcut kullanıcı verileri değiştirilmez. Testlerin sonunda yalnız izole test DB temizlenir ve dört fixture özgün başlık/açıklama/içerikleriyle mock modunda yeniden indekslenir. Otomatik testler ve sonuç dosyaları korunur. Supabase'e bekleyen migration bu görev sırasında uygulanmaz; kullanıcı kendi güncellemesini başlatınca normal TypeORM başlangıcı uygular.

## Çalıştırılan sonuçlar — 4 Ekim 2026

| Kontrol | Sonuç | Ortam |
| --- | --- | --- |
| Unit + OpenAI sözleşmesi | 67/67 geçti | Sahte SDK; canlı API değildir |
| Entegrasyon | 25/25 geçti | Mock + gerçek izole PostgreSQL/pgvector |
| Geniş mock değerlendirmesi | 137/137 geçti | İzole PostgreSQL |
| İngilizce prompt geniş değerlendirmesi | 106/106 geçti | Gerçek OpenAI + izole PostgreSQL |
| Özet/hafıza canlı API senaryoları | 9/9 geçti | Gerçek OpenAI + izole PostgreSQL |
| Mock tarayıcı regresyonu | 15/15 geçti | Production Docker imajı; 2 ücretli test opt-in kapalı olduğu için atlandı |
| OpenAI tarayıcı uçtan uca | 6/6 geçti | Gerçek OpenAI, Next proxy, Nest agent, pgvector; mobil/masaüstü, kaynak, memory, özet, doküman CRUD |
| Render process supervisor | 8/8 geçti | Gerçek yerel child süreçleri |
| Lint / typecheck / production Docker build | Başarılı | Son ürün kodu |

İngilizce yönergelerle ölçülen iki API runner toplam 342 çağrı yaptı; token bazlı tahmini maliyet yaklaşık $0.13. Tarayıcı testlerinin ayrıca yaptığı canlı çağrılar bu sayaca dahil değildir; bu tutar toplam fatura olarak okunmamalıdır. Kullanılan fiyat varsayımları ve token sayıları `conversation-summary-openai-usage.json` içindedir. Live evaluation embedding cache dizini bu çalışma için yeniydi; sonuçlar önceki mock veya fake SDK yanıtlarından üretilmedi.

Son manuel ortam **http://localhost:3003**, izole `uplico-summary` / `render_test`, varsayılan mock'tur. Orijinal `localhost:3000` üç-container ortamına ve Supabase'e dokunulmadı; oradaki çalışan eski imaj otomatik güncellenmedi. Temizlik sonucu `docs/test-reports/conversation-summary-manual-start.json` dosyasındadır. Bu geçici DB tmpfs kullanır; test PostgreSQL container'ı kaldırılırsa deneme kayıtları kaybolur.

## Teslim kaydı

Yukarıdaki ortam ve temizlik açıklamaları ilgili geliştirme aşamasına aittir. Son testler ve iki asıl veritabanının temiz başlangıç durumu [güncel doğrulama kaydındadır](verification.md).
