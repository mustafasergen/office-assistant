# Render: tek Web Service

Bu dosyalar yayınlama hazırlığıdır; Render'da servis oluşturmaz. Local `compose.yaml`, `.env` ve mevcut veriler değişmez.

```text
Tarayıcı → Render HTTPS → Next.js 0.0.0.0:$PORT (10000)
                           → NestJS 127.0.0.1:3001
                               → Supabase session pooler :5432 (TLS)
```

## Blueprint kurulumu

1. Hazır olduğunuzda değişiklikleri `mustafasergen/office-assistant` reposunun `main` branch'ine commit/push edin. Blueprint dosyası GitHub'da yokken Render onu okuyamaz.
2. Render Dashboard → **New → Blueprint**. Gerekirse GitHub hesabını bağlayıp `mustafasergen/office-assistant` reposuna erişim verin. Repo olarak bunu, branch olarak `main`, Blueprint Path olarak `render.yaml` seçin.
3. Blueprint adına örneğin `office-assistant` yazın. Önizlemede yalnız **bir Web Service** görünmeli. Aşağıdaki ayarlar dosyadan gelir; ayrıca backend, Static Site veya Render Postgres oluşturmayın.

| Alan                  | Değer                                             |
| --------------------- | ------------------------------------------------- |
| Service name          | `office-assistant`                                |
| Runtime               | Docker                                            |
| Region                | Frankfurt (Supabase EU Central'a yakın)           |
| Instance/compute plan | `0.5c-512mb` — 512 MB / 0,5 CPU; eski adı Starter |
| Instances             | 1                                                 |
| Root Directory        | Boş / repo kökü                                   |
| Dockerfile Path       | `./Dockerfile.render`                             |
| Docker Build Context  | `.`                                               |
| Docker Command        | Boş; Dockerfile `CMD` kullanılır                  |
| Health Check Path     | `/api/health/ready`                               |
| Automatic deploys     | Off; sonraki kod yayınları için Manual Deploy     |

4. İstenen **DATABASE_URL** alanına Supabase Dashboard → Connect → **Session pooler** bağlantısını girin. Şablon:

   ```text
   postgresql://postgres.<PROJECT_REF>:<URL_ENCODED_DB_PASSWORD>@<SESSION_POOLER_HOST>:5432/postgres?sslmode=require
   ```

   Mevcut EU Central pooler host'unuzu kullanın; transaction pooler'ın `6543` portunu seçmeyin. Paroladaki `%`, `@`, `#`, `:` gibi URL karakterlerini percent-encode edin; zaten encode edilmiş bir parolayı tekrar encode etmeyin. Repo içine gerçek URL veya parola yazmayın. Bağlantı TypeORM üzerinden yapılır; Supabase anon/service-role key gerekmez. İmaj Supabase CA sertifikasını içerir ve sertifika/hostname doğrulamasını kapatmaz.

5. Secret ve diğer ayarların son durumunu kontrol edin:

| Env              | Nereden / ne girilmeli?                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------- |
| `DATABASE_URL`   | Yukarıdaki gerçek Supabase session-pooler URL; Blueprint `sync: false` ile panelde ister              |
| `COOKIE_SECRET`  | Render otomatik rastgele üretir; local `.env` değerini kopyalamayın, yeniden deploy'da değiştirmeyin  |
| `COOKIE_SECURE`  | `true` — Blueprint'te hazır                                                                           |
| `LLM_PROVIDER`   | `mock` — Blueprint'te hazır; ilk kurulumda API anahtarı gerekmez                                      |
| `PORT`           | `10000` — Blueprint'te hazır; yalnız dışa açık Next.js portu                                          |
| `NODE_ENV`       | `production` — Blueprint'te hazır                                                                     |
| `OPENAI_API_KEY` | Mock modunda eklemeyin. OpenAI'ye geçerken yalnız Render Environment ekranına gerçek anahtarı ekleyin |

`BACKEND_INTERNAL_URL`, backend `PORT` ve `BIND_HOST` alanlarını panelden ayarlamayın; başlangıç scripti bunları yalnız ilgili child-process'e verir. `NEXT_PUBLIC_*` secret değişkeni yoktur. DB URL, API anahtarı ve cookie secret Next.js sürecine de aktarılmaz.

6. Önizleme doğruysa **Deploy Blueprint / Apply** ile kurulumu başlatın. İlk kurulum migration, eksik seed dokümanları ve aktif embedding indeksini hazırlar. Backend hazır olduktan sonra Next.js başlar. Dosyalarda build/start/pre-deploy komutu girmeniz gerekmez; migration zaten uygulama başlangıcında çalışır.

7. Render'ın gösterdiği **gerçek HTTPS servis URL'sini** açın (isim uygunluğuna göre `https://office-assistant-….onrender.com` olabilir). `/api/health/ready` 200 ve `{"status":"ok","provider":"mock"}` dönmeli. Ardından kaynaklı soru, hafıza kaydı, aynı konuşmada panelden silme ve yeni konuşma akışını deneyin.

## OpenAI'ye geçiş ve mevcut veriler

Render servisinin **Environment** ekranında `OPENAI_API_KEY` ekleyin, `LLM_PROVIDER=openai` yapın ve kaydedip yeniden deploy edin. Model adları ve eşikler backend config kodundadır. Secret'ı GitHub'a veya `render.yaml` içine eklemeyin. Daha sonra Blueprint'i tekrar sync ederseniz dosyadaki `LLM_PROVIDER=mock` ayarı yeniden uygulanabilir; kalıcı OpenAI tercihi için YAML'deki yalnız provider değerini de `openai` yapın (anahtar panelde kalır).

Mock'a dönüş için `LLM_PROVIDER=mock`. Provider değişiminde aynı boyuttaki farklı embedding uzayları karıştırılmaz; indeks başlangıçta yeniden hazırlanır. Bu işlem doküman metnini/silme durumunu korur, türetilmiş chunk/embedding kayıtlarını günceller. OpenAI modunda indeks hazırlığı ve sohbet API maliyeti doğurur.

Mevcut Supabase veritabanına deploy edildiğinde kalıcı doküman düzenlemeleri korunur; fixture dosyaları eksik seed slug'larını oluşturur. Aynı Supabase'e bağlı local ve Render uygulamalarını **farklı provider'larla eşzamanlı kullanmayın**: aktif indeks ortaktır. Local mock denemelerini local PostgreSQL üzerinde tutun. Bu hazırlık sırasında mevcut Supabase'e bağlanılıp veri değiştirilmedi.

Tek instance tanımlıdır. Chat eşzamanlılık kontrolü uygulama sürecindedir; çok instance ölçekleme bu kurulumun kapsamı değildir. Render yeni deploy sırasında eski ve yeni container'ı kısa süre birlikte çalıştırabilir; özellikle provider değişimini aktif sohbet olmayan bir zamanda yapın. Bu yapı rolling deploy boyunca uygulama düzeyinde kesintisizlik garantisi vermez.

## Süreçler ve sağlık

- `Dockerfile.render` build sırasında iki uygulamayı derler; DB/API bağlantısı ve secret gerekmez. Runtime non-root çalışır. Next standalone ile backend production bağımlılıkları ayrı dizinlerde tutulur.
- `scripts/render-start.mjs` PID 1 olarak çalışır. Backend'in DB/migration/seed/index hazırlığını en fazla 5 dakika bekler. Hazır olmazsa süreçleri kapatır ve hata koduyla çıkar. Next.js dışarıya, NestJS yalnız loopback'e bağlanır.
- Bir uygulama beklenmedik şekilde sonlanırsa diğer uygulama da kapatılır ve container başarısız çıkar. Yeniden başlatma Render'a bırakılır; uygulama içinde sonsuz restart döngüsü yoktur.
- SIGTERM/SIGINT'te önce Next.js durdurulur; mevcut proxy istekleri tamamlanırken backend ayakta kalır. Sonra NestJS kapanır ve TypeORM bağlantılarını kapatır. Script 80 saniye sonunda kalan süreç gruplarını zorla sonlandırır; Render limiti 90 saniyedir. Zorunlu sonlandırma hata kodu üretir.
- `/api/health/ready` Next proxy üzerinden backend, DB ve indeks hazırlığını kontrol eder. Böylece yalnız bir Node sürecinin ayakta olması yeterli sayılmaz. Render HTTP healthcheck kullanır; Dockerfile'da aynı yolu kontrol eden container healthcheck'i de vardır.
- Kalıcı dosya diski ve Render DB yoktur; veriler Supabase'de tutulur.

## Plan ve maliyet

**4 Ekim 2026 kontrolü:** Web Service `1c-2g` (2 GB / 1 CPU, eski Standard) **$25/ay**; `0.5c-512mb` (512 MB / 0.5 CPU, eski Starter) **$7/ay**. Hobby workspace taban ücreti $0'dır; bu servis için ayrıca Pro workspace gerekli değildir. Bunlar compute bedelleridir; varsa bandwidth/build aşımı, vergi, Supabase planı ve OpenAI API kullanımı ayrı değerlendirilir. [Compute fiyatları](https://render.com/pricing), [plan isimleri](https://render.com/docs/compute-plans), [workspace ücretleri](https://render.com/blog/better-pricing-for-fast-growing-teams).

Blueprint **$7/ay olan 512 MB / 0,5 CPU** planını seçer. Birleşik imaj aynı sınırlarla ve swap kapalıyken izole yerel PostgreSQL üzerinde test edildi. Backend migration/seed/indeks hazırlığı ve iki uygulamanın başlangıcı başarılı; yük öncesi bellek tepesi yaklaşık **126 MiB** oldu.

| Eşzamanlı kullanıcı | Başarılı sohbet | p95 süre |
| ------------------- | --------------- | -------- |
| 8                   | 96/96           | 908 ms   |
| 16                  | 192/192         | 702 ms   |
| 32                  | 384/384         | 1485 ms  |

Her kullanıcı ayrı cookie/thread ile 12 ardışık kaynaklı izin sorusu gönderdi; 20 mesajlık geçmiş sınırı da devreye girdi. Toplam **672/672** cevapta HTTP durumu, doğru izin süresi ve kaynak kontrol edildi. Container'ın yük ve tarayıcı testleri boyunca bellek tepesi **163 MiB** (170909696 byte) oldu; OOM / OOM kill sayısı **0**. Aynı sınır altında **9 Playwright testi** geçti; bunlar doküman ekleme/düzenleme/silme, hafıza ve responsive akışları da kapsar.

Bu sonuçlarla küçük case/demo için hedef plan yeterli görünüyor. Ölçüm yerel ARM64 Docker, dört seed doküman ve mock provider içindir; Render donanımı, uzak Supabase gecikmesi, canlı OpenAI veya uzun süreli yoğun yük için kapasite garantisi değildir. Başlangıçta Render Metrics bellek/CPU ve yanıt sürelerini takip edin; doküman/yük arttığında yeniden ölçün. Runtime içinde build yapılmaz. İlk 2 GiB / 1 CPU deneyi karşılaştırma olarak korunmuştur: [doğrulama kaydı](render-validation.json).

## Yerelde Render imajını doğrulama

Normal local kullanım hâlâ `docker compose up`. Render test dosyası ayrı geçici PostgreSQL kullanır; mevcut `.env` yüklenmez ve gerçek DB'ye bağlanmaz:

```sh
pnpm test:render
docker compose --env-file /dev/null -p office-render-test -f compose.render-test.yaml up --build -d --wait
# http://localhost:3003
BASE_URL=http://localhost:3003 pnpm test:e2e
docker compose --env-file /dev/null -p office-render-test -f compose.render-test.yaml down -v
```

`down -v` burada yalnız test projesine uygulanır. Başka projenin adını kullanmayın. Başlangıç/kapanış testleri gerçek yerel child-process ve geçici portlarla çalışır. CI'ya süreç testleri, Render imaj build'i, bu imaj üzerinde Playwright, hata logları ve cleanup eklendi; uzakta GitHub Actions bu hazırlık sırasında tetiklenmedi.

Render Blueprint resmi JSON şemasıyla yerelde doğrulandı. Render kontrol panelinde gerçek servis oluşturma, Supabase bağlantısı ve platform healthcheck'i bu aşamada çalıştırılmadı. Referanslar: [Blueprint alanları](https://render.com/docs/blueprint-spec), [port bağlama](https://render.com/docs/web-services#port-binding), [healthcheck](https://render.com/docs/health-checks), [kapanış sinyalleri](https://render.com/docs/deploys#graceful-shutdown).
