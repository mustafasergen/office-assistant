# Ofis Asistanı

Şirket dokümanlarından kaynak göstererek cevap veren, konuşma geçmişini saklayan ve kullanıcı tercihlerini yeni konuşmalarda hatırlayan bir ofis asistanı.

**[Canlı demo](https://office-assistant-2s8e.onrender.com/)** · Render ortamı **Supabase + deterministik mock LLM** kullanır. Opsiyonel OpenAI adapter'ı aynı agent döngüsü üzerinden çalışır ve env ile etkinleştirilebilir.

## Stack ve kurulum

Next.js App Router, React, TypeScript, Tailwind · NestJS, TypeORM · PostgreSQL + pgvector · pnpm · Docker Compose.

Gereksinim: çalışan Docker Desktop / Docker Engine ve Docker Compose v2+. Repo kökünde:

```sh
docker compose up
```

Uygulama **http://localhost:3000** adresinde açılır. İlk build için internet gerekir. Migration, dört başlangıç dokümanının yüklenmesi ve indeksleme otomatik yapılır. `.env` veya API anahtarı olmadan varsayılan **mock + local PostgreSQL** çalışır.

```sh
# Kod değişikliğinden sonra yeniden derle ve arka planda başlat
docker compose up --build -d --wait

# Verileri koruyarak durdur
docker compose down
```

PostgreSQL verileri named volume'da kalır. `docker compose down -v` bu verileri siler.

## Env ve OpenAI modu

İsteğe bağlı ayarlar için [.env.example](.env.example) dosyasını `.env` olarak kopyalayın. `.env` Git dışında tutulur.

| Değişken         | Kullanımı                                                                 |
| ---------------- | ------------------------------------------------------------------------- |
| `LLM_PROVIDER`   | `mock` (varsayılan) veya `openai`                                         |
| `OPENAI_API_KEY` | Yalnız OpenAI modunda gerekli; sadece backend kullanır                    |
| `DATABASE_URL`   | Boşsa Compose içindeki PostgreSQL; harici DB için TypeORM bağlantı URL'si |
| `COOKIE_SECRET`  | Anonim oturum imzası; yayın ortamında uzun rastgele değer                 |
| `COOKIE_SECURE`  | Local HTTP'de `false`, HTTPS'te `true`                                    |
| `FRONTEND_PORT`  | Local erişim portu; varsayılan `3000`                                     |

OpenAI'yi etkinleştirmek için:

```dotenv
LLM_PROVIDER=openai
OPENAI_API_KEY=<OPENAI_API_KEY>
```

Ardından `docker compose up -d --wait` çalıştırın. Gerçek API çağrıları ücretlidir. Model adları, retrieval eşikleri ve agent sınırları [config/defaults.ts](backend/src/config/defaults.ts) içindedir; varsayılan modeller `gpt-4.1-mini` ve `text-embedding-3-small`.

Supabase Session Pooler URL şablonu `.env.example` içindedir. Aynı veritabanına bağlı aktif uygulamalar aynı embedding provider'ını kullanmalıdır; mock ve OpenAI geçişinde indeks yeniden hazırlanır. Local denemeler için canlı Supabase yerine ayrı local DB kullanın.

## Kısa mimari ve kararlar

```text
Local:  Tarayıcı → frontend container → backend container → PostgreSQL container
Render: Tarayıcı → tek Docker Web Service [Next.js → NestJS] → Supabase
```

- **Repo:** `frontend/` arayüz ve API proxy'si; `backend/` NestJS modülleri, agent ve kalıcılık; `fixtures/documents/` dört Markdown dokümanı. Tek pnpm workspace/lockfile; küçük case için ortak contracts paketi, generic repository veya CQRS yok.
- **Agent:** Model cevap ya da `search_docs` / `save_memory` çağrısı üretir. Backend tool argümanlarını doğrular, aracı çalıştırır ve eşleşen sonucu modele geri verir. En fazla 6 model adımı ve 60 saniye; tool çıktısı doğrudan nihai cevap sayılmaz. Cevabın kaynakları o çalıştırmanın retrieval sonuçlarına karşı doğrulanır.
- **Arama:** Başlık/paragraf sınırlarını koruyan chunking; büyük bölümlerde yaklaşık 200 kelime ve 30 kelime overlap. Başlık, alt açıklama ve içerikten 1536 boyutlu embedding üretilir. pgvector cosine exact search kullanılır; küçük veri kümesi için ANN indeksi eklenmedi. Provider kimliği farklı vektörlerin karışmasını önler.
- **Hafıza:** İmzalı HttpOnly cookie anonim kullanıcıyı tanımlar. İsim, departman ve beslenme tercihi kullanıcıya ait key/value kayıtlarıdır; yeni thread'lerde paylaşılır, panelden silinebilir. Kaynak mesajlar kullanıcı sahipliği kontrolüyle korunur.
- **Konuşma özeti:** Henüz özetlenmemiş, tamamlanmış kullanıcı ve asistan mesajlarının toplam sayısı **20’yi veya toplam metin uzunluğu 12.000 karakteri aşınca** eski bölüm özetlenir; yakın mesajlar bağlamda tutulur. Bunlar mesaj gönderme sınırı değildir; eski mesajlar ekranda aynen kalır. Özet, izin başvurusu ve yemek kartı gibi **desteklenen sekiz şirket konusunu** kapsar; sekiz farklı şirket anlamına gelmez. Hafıza değiştiğinde konu bağlamını korumak için bu eşikler beklenmeden de özet oluşabilir; eski kişisel bilgiler model bağlamından çıkarılır. Kişisel bilgi içermeyen deterministik özet ek API çağrısı yapmaz, kaynak yerine geçmez. **Özeti göster** ile açılır; belirsiz devam sorularında açıklama istenir.
- **Provider sınırı:** Ortak `chat()` / `embed()` sözleşmesi. Mock sınırlı Türkçe kurallarla deterministik çalışır. OpenAI Responses function calling ve Embeddings API kullanır; model hatasında sessizce mock'a geçmez. İngilizce yönergelerle Türkçe cevap üretir.
- **Kalıcılık:** TypeORM migration'ları, `synchronize: false`. Sohbet, hafıza ve doküman işlemleri ayrıdır. Kütüphane ortak çalışma alanıdır; doküman değişiklikleri tüm kullanıcıları etkiler.

Login/register, streaming ve dosya upload kapsam dışında bırakıldı. Kütüphanede metin dokümanı ekleme/düzenleme/silme arayüzü bulunur. Örnek şirket politikaları kurgusaldır; mock genel amaçlı bir dil modeli değildir.

## Render

[render.yaml](render.yaml) tek ücretli Web Service'i tanımlar. [Dockerfile.render](Dockerfile.render) Next.js ve NestJS'i aynı container'da çalıştırır; dışarıya frontend açılır, backend'e container içinden erişilir. Başlangıç sırası ve düzgün kapanış supervisor tarafından yönetilir; veritabanı harici Supabase'dir.

`/api/health/live` süreç canlılığını, `/api/health/ready` DB ve indeks hazırlığını kontrol eder. Compose healthcheck'leri ve Render healthcheck'i readiness endpoint'ini kullanır. `autoDeployTrigger: commit`, `main`'e push sonrası otomatik build/deploy içindir; Blueprint değişiklikleri Render'da sync edilmiş olmalıdır. Secret'lar Render Environment panelinden girilir. [Yayınlama rehberi](docs/render.md).

## Demo senaryoları

1. **“Yıllık izin hakkım kaç iş günü?”** → 20 iş günü ve açılabilir kaynak.
2. **“Toplantı odasını nasıl rezerve ederim?”** → Şirket takviminden rezervasyon.
3. **“Vejetaryenim”** → Hafızaya kaydedilir; yeni konuşmadaki yemek sorusunda kullanılır.
4. Tercihi panelden silip **“Beslenme tercihim ne?”** diye sorun → Eski mesajlarda geçse de kayıtlı sayılmaz.
5. **“İzin başvurusu nasıl yapılır?” → “Peki.” → “Peki kaç gün önceden?”** → Konu korunur, güncel kaynaktan 5 iş günü cevabı gelir.
6. Uzun konuşmada **Özeti göster** alanını açın; mesajların korunmasını kontrol edin. Kütüphanede doküman düzenleyerek sonraki cevapların güncel kaynağı kullanmasını deneyin.

## Testler ve geliştirme

Docker dışında Node 22+ ve pnpm 10.34.6 gerekir.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:render
node --test tests/session-export/*.test.mjs
pnpm build

# Ayrı PostgreSQL/pgvector: entegrasyon ve ürün davranışı testleri
docker compose -p office-test -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from integration
docker compose -p office-test -f compose.test.yaml run --build --rm evaluation
docker compose -p office-test -f compose.test.yaml down -v

# Çalışan, test için ayrılmış mock uygulamada tarayıcı kontrolleri
pnpm exec playwright install chromium
pnpm test:e2e
```

Testler agent/tool döngüsü, kaynak doğrulama, hafıza save/update/delete, kullanıcı ayrımı, özet, hata sınırları ve arayüz akışlarını kapsar. Gerçek PostgreSQL entegrasyonu, sahte SDK sözleşmeleri ve canlı OpenAI kontrolleri ayrı raporlanır. Canlı API testleri opt-in'dir; normal CI anahtar gerektirmez. GitHub Actions lint, typecheck, test, build, Docker, tarayıcı ve restart kontrollerini çalıştırır.

Son sonuçlar: [doğrulama raporu](docs/verification.md). Eşik/topK/chunk karşılaştırmaları ve ölçümlere dayalı kararlar: [değerlendirme raporu](docs/evaluation/REPORT.md).

## AI oturumu

Yalnız bu case'e ait ham Codex konuşması: **[Case1 JSONL](docs/ai-sessions/case1.jsonl)**. Mesajlar, araç çağrıları, sonuçlar ve sıra korunur; yalnız secret değerleri `[REDACTED]` ile maskelenir. Kopyanın zaman sınırı ve tarama bilgisi: [oturum teslim kaydı](docs/ai-sessions.md).

## Daha fazla vaktim olsaydı

Mevcut edge case ve yük kontrollerini daha geniş senaryolar ve uzun süreli yük testleriyle genişletirdim. Yeni ölçümlere göre performansı, API maliyetini ve yanıt süresini optimize ederdim.
