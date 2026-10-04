# Doğrulama kaydı

3 Ekim 2026 tarihinde bu çalışma kapsamında:

| Kontrol                               | Sonuç                                                  |
| ------------------------------------- | ------------------------------------------------------ |
| `pnpm lint`                           | Geçti                                                  |
| `pnpm typecheck`                      | Backend ve frontend geçti                              |
| `pnpm test`                           | 7 suite, 31 test geçti                                 |
| `pnpm build`                          | Backend ve Next.js production build geçti              |
| PostgreSQL/pgvector entegrasyonu      | 9 test geçti; izole Docker test ortamı                 |
| `pnpm test:e2e`                       | 2 test geçti; Chromium, masaüstü ve mobil              |
| `pnpm exec prettier --check .`        | Geçti                                                  |
| `docker compose up --build -d --wait` | Üç servis healthy; `.env` gerektirmedi                 |
| Container restart                     | Cookie kimliği, mesajlar, hafıza ve dokümanlar korundu |
| Seed tekrar çalıştırma                | 4 doküman, 0 gereksiz güncelleme                       |

Docker Desktop 4.93.0, Docker Engine 29.8.1 ve Compose 5.5.1 ile Apple Silicon macOS üzerinde çalıştırıldı. Container'lar Node 22.22.0 ve PostgreSQL 16/pgvector 0.8.2 kullanır.

Retrieval smoke kontrolleri yıllık izin, yemek kartı, ofis kuralları ve uzaktan çalışma sorularında ilgili dokümanları döndürdü. Model kodunda bu politikaların sayısal cevapları sabitlenmedi.

Tarayıcı testi sırasında yakalanan yeni konuşmaya geçiş yarışı giderildi: yeni thread açılırken ve başka thread'e geçilirken composer, hedef konuşma hazır olana kadar devre dışıdır. Aynı kabul testi düzeltmeden sonra başarılı çalıştı.

## Doğrulama sınırları

- OpenAI adapter contract testlerine ek olarak gerçek API ile embedding, retrieval, Responses function calling ve kaynak doğrulaması yapıldı. Canlı model çıktıları deterministik değildir.
- Embedding provider geçişi aynı boyutta farklı embedding kimliği kullanan test provider'ı ile gerçek PostgreSQL üzerinde doğrulandı.
- GitHub Actions workflow'u hazırdır; bir GitHub remote'a push edilmediği için uzaktaki Actions koşusu yapılmadı.
- Yerel Git deposu oluşturuldu. GitHub reposu oluşturma/push işlemi yapılmadı.
- AI session export'u paylaşım değil, yerel snapshot'tır. Son etkileşimden sonra script yeniden çalıştırılabilir.

## Supabase ve OpenAI doğrulaması

- Supabase session pooler bağlantısı CA ve hostname doğrulamalı TLS ile kuruldu. Parola/anahtar çıktı veya repo dosyalarına alınmadı.
- vector 0.8.2 eklentisi extensions şemasında doğrulandı. TypeORM üzerinden iki migration uygulandı; şema snapshot'ı backend/supabase altında tutuluyor.
- Dört seed dokümanı sekiz chunk olarak gerçek text-embedding-3-small ile indekslendi; embedding boyutu 1536.
- Yıllık izin sorgusu doğru dokümanı yaklaşık 0.70 cosine skoru ile buldu; alakasız Mars sorusu 0.30 eşikte sıfır sonuç verdi.
- gpt-4.1-mini ile Responses function call → eşleşen tool sonucu → kaynaklı nihai cevap akışı geçti.
- Tekrar seed çalıştırması sıfır güncelleme yaptı; chunk kimlikleri korundu.
- HTTP üzerinden aynı mesajda memory + retrieval, kaynak doküman erişimi, yeni thread'de hafıza, silme ve silme sonrası yeni thread kontrol edildi.
- Ayrı Compose projesinde `--env-file /dev/null` ile sıfırdan mock + local PostgreSQL başladı; iki Playwright testi geçti. Bu test ortamı sonrasında temizlendi.
- TypeScript module/moduleResolution Node16 ve isolatedModules ayarlarıyla lint, typecheck, unit ve production Docker build geçti.

Tekrar çalıştırma: `pnpm --filter backend verify:live` ve çalışan uygulamaya karşı `node scripts/check-live.mjs`. Bunlar opt-in gerçek API çağrılarıdır; CI yalnız mock ve sahte SDK yanıtları kullanır.

Canlı modelde hatırlama sorusunun gereksiz memory yazmasına karşı yalnız mevcut mesajdaki desteklenen açık beyanlara izin veren ortak politika eklendi. OpenAI adapter tool filtresi ve backend yazma doğrulaması regresyon testleriyle kontrol edilir.

Son hafıza doğrulaması, yazma kontrolü eklendikten sonra iki bağımsız anonim kullanıcıyla art arda geçti. Hatırlama ve silme sonrası sorgularda save_memory çalışmadı; silinen kayıt DB listesinden kayboldu.

## Konuşma ve kütüphane yönetimi doğrulaması

- 31 unit, 12 gerçek PostgreSQL/pgvector entegrasyon, 9 Playwright testi geçti.
- Konuşma silme: sahiplik, aktif çalışma engeli, mesajların silinmesi ve hafızanın korunması doğrulandı.
- Doküman ekleme/düzenleme/silme, alt açıklamanın kaldırılması, revision çatışması, embedding hatasında rollback ve güncel içerikten retrieval doğrulandı.
- Seed doküman düzenlemesi/silmesi yeniden başlatmada korunuyor.
- Kullanıcının Chrome sekmesinde geçici doküman ekleme ve düzenleme kontrol edildi.
- Yeni migration ve schema snapshot backend/supabase altında. Güncel çalışma modu mock + local PostgreSQL.

## Açıklamalar ve genişletilmiş dokümanlar

Dört doküman 24 kaynak bölümüne genişletildi. 33 unit, 13 PostgreSQL entegrasyon ve 9 Playwright testi geçti; açıklama-only retrieval ve açıklamayı kaldırınca indeksin yenilenmesi kontrol edilir. Gerçek Supabase/OpenAI'de fixture içerik/açıklama eşitliği, dört yeni konu, yıllık izin kaynağı, alakasız Mars sorgusu ve tool devamı doğrulandı. Açıklamanın bölüm içeriğini bastırması %75 bölüm / %25 açıklama vektör birleşimiyle düzeltildi. Yerel mock aynı yolu kullanır.

Son Docker build ve üç servis healthcheck başarılı. Son mock arama kontrolleri sohbet kaydı oluşturmadan yapıldı: yerelde 0 thread, 0 message, 0 memory; 4 aktif doküman ve 24 chunk. TypeORM migration tablosu kullanıcının kararıyla korundu.
