# Uplico · Ofis Asistanı

Şirket dokümanlarından kaynak göstererek cevap veren, sohbet geçmişini saklayan ve kullanıcı tercihlerini yeni konuşmalarda hatırlayan bir ofis asistanı. Hafıza kayıtları görüntülenip silinebilir; konuşmalar silinebilir ve ortak bilgi kütüphanesine doküman eklenip mevcut dokümanlar düzenlenebilir.

## Stack

Next.js, React, TypeScript, Tailwind · NestJS, TypeORM · PostgreSQL + pgvector · pnpm workspace · Docker Compose.

## Kurulum ve çalıştırma

Gereksinim: çalışan **Docker Desktop / Docker Engine** ve **Docker Compose v2+**. İlk kurulumda image ve paketleri indirmek için internet gerekir.

Repo kökünde:

```sh
docker compose up
```

Uygulama: **http://localhost:3000**

İlk build birkaç dakika sürebilir. Migration ve dört örnek dokümanın indekslenmesi otomatik yapılır. Yerel Node kurulumu veya `.env` dosyası gerekmez. Varsayılan mod **mock + yerel PostgreSQL**; API anahtarı istemez.

```sh
# Arka planda başlat / değişikliklerden sonra yeniden derle
docker compose up --build -d --wait

# Servisleri durdur; veriler korunur
docker compose down
```

`docker compose down -v` yerel veritabanı verilerini siler.

## Ortam ayarları ve OpenAI

İsteğe bağlı ayarları `.env.example` dosyasını `.env` olarak kopyalayarak yapabilirsiniz. `.env` Git dışında tutulur.

OpenAI için `.env` içinde:

```dotenv
LLM_PROVIDER=openai
OPENAI_API_KEY=<OPENAI_API_KEY>
```

Ardından `docker compose up -d --wait` çalıştırın. Bu mod gerçek, ücretli API çağrıları yapar; anahtar yalnız backend tarafından kullanılır. Mock'a dönmek için `LLM_PROVIDER=mock` ayarlayın.

| Ayar             | Kullanımı                                                            |
| ---------------- | -------------------------------------------------------------------- |
| `LLM_PROVIDER`   | `mock` (varsayılan) veya `openai`                                    |
| `OPENAI_API_KEY` | Yalnız OpenAI modunda gerekli                                        |
| `DATABASE_URL`   | Boşsa yerel PostgreSQL; Supabase gibi harici DB için bağlantı URL'si |
| `COOKIE_SECRET`  | Oturum imzası; özel ortam için uzun rastgele bir değer               |
| `COOKIE_SECURE`  | Yerel HTTP'de `false`, HTTPS'te `true`                               |
| `FRONTEND_PORT`  | Varsayılan `3000`                                                    |

Supabase session pooler URL şablonu ve diğer ortam ayarları `.env.example` içindedir. Model adları ve uygulamanın sabit davranışları `backend/src/config/defaults.ts` içinde tutulur: chat `gpt-4.1-mini`, embedding `text-embedding-3-small`.

## Kısa mimari

```text
Tarayıcı → Next.js frontend → NestJS backend → PostgreSQL + pgvector
                                  ↕
                         Mock / OpenAI + araçlar
```

`frontend/` sohbet, kaynak ve hafıza arayüzünü; `backend/` API, agent döngüsü, doküman araması ve kalıcılığı içerir. `fixtures/documents/` dört örnek dokümanı barındırır. Frontend API isteklerini backend'e iletir. Kullanıcılar anonim cookie ile ayrılır; yeni konuşmalar aynı kullanıcının hafızasını paylaşır.

## Demo

1. **“Yıllık izin kaç gün?”** → kaynaklı cevap ve açılabilir doküman.
2. **“Vejetaryenim”** → hafıza panelinde yeni tercih.
3. Yeni konuşmada **“Yemek seçenekleri neler?”** → hatırlanan tercihe göre cevap.
4. Tercihi hafızadan silip yeni konuşmada tekrar sorun → silinen hafıza kullanılmaz.
5. Kütüphanedeki **+** ile doküman ekleyin; dokümanı açıp **Düzenle** ile başlık, açıklama ve içeriğini değiştirin. Kaydedilen içerik aramada kullanılır.
6. Konuşmanın yanındaki çöp kutusuyla konuşmayı silebilirsiniz; hafıza ayrı olarak korunur.
7. **“Vejetaryenim, yemek seçenekleri neler?”** → hafıza kaydı ve doküman araması birlikte çalışır.

Mock sınırlı Türkçe kurallarla çalışır. Hafıza her iki modda isim, departman ve beslenme tercihinin desteklenen açık beyanlarını kaydeder (ör. “Adım Deniz”, “Yazılım departmanında çalışıyorum”, “Vejetaryenim”). Örnek şirket politikaları kurgusaldır. Kütüphane ortak çalışma alanıdır; doküman değişiklikleri tüm konuşmalara yansır.

Örnek dokümanlarda izin iptali, gıda alerjisi, misafir kabulü ve VPN desteği gibi ek konular da bulunur. Mevcut veritabanını değiştirilmiş Markdown dosyalarıyla güncellemek için [doküman senkronizasyonu](backend/supabase/README.md#seed-içeriğini-iki-ortamda-güncelleme) adımlarını kullanın.

## Geliştirme ve kontroller

Render'da tek ücretli Web Service için kökte `render.yaml` ve `Dockerfile.render` bulunur. Bu imaj Next.js ve NestJS'i birlikte çalıştırır; veritabanı mevcut Supabase'dir. Local `docker compose up` düzeni üç ayrı container olarak kalır. Blueprint kurulumu, secret alanları, plan/maliyet ve test komutları: [Render yayınlama rehberi](docs/render.md).

Docker dışında geliştirme/test için Node 22+ ve pnpm 10.34.6 gerekir.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm test:render
pnpm build

# İzole PostgreSQL/pgvector entegrasyon testleri
docker compose -p uplico-test -f compose.test.yaml up --build --abort-on-container-exit --exit-code-from integration
docker compose -p uplico-test -f compose.test.yaml down -v

# Çalışan mock uygulamaya karşı tarayıcı testleri
pnpm exec playwright install chromium
pnpm test:e2e
```

GitHub Actions lint, typecheck, unit, build, entegrasyon, 25 gruplu ürün davranışı değerlendirmesi, tarayıcı ve restart kontrollerini mock modunda çalıştırır; OpenAI anahtarı gerekmez.

```sh
# Ayrı, geçici PostgreSQL üzerinde kapsamlı mock değerlendirmesi
docker compose -p uplico-eval -f compose.test.yaml run --build --rm evaluation
docker compose -p uplico-eval -f compose.test.yaml down -v
```

Ölçümler ve ayarların gerekçeleri: [değerlendirme raporu](docs/evaluation/REPORT.md).

AI oturumu teslim bilgisi: [docs/ai-sessions.md](docs/ai-sessions.md).
