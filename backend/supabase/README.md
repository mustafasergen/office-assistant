# Supabase / PostgreSQL

Uygulama Supabase Session Pooler'a **TypeORM + DATABASE_URL** üzerinden bağlanır. Supabase JS client veya frontend DB anahtarı kullanılmaz. Aynı migration'lar yerel PostgreSQL/pgvector üzerinde de çalışır.

- `migrations/`: Sıralı ve değişmez SQL migration'ları. `src/database/migrations/` içindeki ince TypeORM sınıfları bu SQL dosyalarını çalıştırır. Tek migration yürütücüsü TypeORM'dur; bunları ayrıca Supabase CLI ile uygulamayın.
- `schema.snapshot.json`: Gerçek bağlı DB'nin yalnız uygulama tablolarına ait kolonları, constraint/index tanımları, RLS durumu, istemci grant'ları ve uygulanmış migration listesi. Kullanıcı verisi veya secret içermez.
- `certs/prod-ca-2021.crt`: Kamuya açık Supabase Root 2021 CA. Sertifika ve hostname doğrulaması açıktır. Kaynak: https://supabase-downloads.s3-ap-southeast-1.amazonaws.com/prod/ssl/prod-ca-2021.crt

```sh
# Root dizininde; .env içindeki DB'ye migration uygular, snapshot yeniler.
pnpm --filter backend db:migrate

# DB'yi değiştirmeden snapshot yeniler.
pnpm --filter backend db:snapshot

# Gerçek, ücretli OpenAI çağrıları + seed/retrieval/adapter doğrulaması.
pnpm --filter backend verify:live
```

Normal backend başlangıcı bekleyen migration'ları ve doküman indekslemesini otomatik çalıştırır. Şema değişikliğinde mevcut SQL'i değiştirmeyin: yeni SQL migration, TypeORM sınıfı ve DataSource kaydı ekleyin. Uyguladıktan sonra `db:snapshot` çalıştırıp snapshot'ı aynı değişiklikte güncelleyin. Otomatik container başlangıcı kaynak repo dosyalarını yazmaz.

`vector` Supabase'de `extensions`, yerelde `public` şemasında olabilir. Bağlantı `search_path=public,extensions` kullanır. Pool en fazla 5 bağlantıdır. Altı uygulama tablosu ve migration tablosunda RLS açıktır; `anon` / `authenticated` için izin yoktur. Backend DB sahibi rolüyle erişir; kullanıcı sahipliği NestJS katmanında kontrol edilir.

TLS bilgisi: https://supabase.com/docs/guides/platform/ssl-enforcement

`1791040000000-library-editing` migration'ı doküman açıklaması, revision ve silinme işaretini ekler. Konuşma silme memory'yi silmez; source_message_id nullable/SET NULL olur. Doküman silme, seed tarafından yeniden oluşturulmasını önlemek için tombstone bırakır; chunk'lar silinir.

## Seed içeriğini iki ortamda güncelleme

Dört Markdown dosyasında H1 başlığını izleyen ilk `> ...` satırı isteğe bağlı alt açıklamadır. Parser bunu `documents.description` alanına alır; kaynak içeriği/chunk içinde metadata paragrafı oluşturmaz. Başlık, açıklama ve içerik iki provider için aynı kaynaktan gelir.

Normal başlangıç mevcut DB düzenlemelerini ezmez. Fixture değişikliklerini mevcut kayıtlara bilinçli olarak aktarmak için hedef DATABASE_URL ve LLM_PROVIDER ile `pnpm --filter backend db:sync-documents --apply` çalıştırın. Docker yerel ortamında: `docker compose exec backend node dist/database/sync-documents.js --apply`. Bu komut mevcut seed düzenlemelerini değiştirir, custom dokümanlara dokunmaz, silinmiş seed kayıtlarını diriltmez. Değişmemiş dokümanda yeniden embedding üretmez. Local ve Supabase ayrı veritabanlarıdır; her hedef için komut ayrı çalıştırılır, otomatik çift yazma yapılmaz.

Embedding iki provider için de ortak KnowledgeService üzerinden hazırlanır: normalize edilmiş başlık+bölüm vektörü %75, başlık+açıklama vektörü %25; birleşim yeniden L2 normalize edilir. Açıklama yoksa yalnız başlık+bölüm kullanılır. Girdi sürümü content hash'e dahil olduğundan algoritma değişikliği başlangıçta yeniden indekslenir. Provider kimlikleri ayrı kalır; mock ve OpenAI vektörleri karşılaştırılmaz.

## Konuşma özeti migration’ı

`1791120000000-conversation-context`: kullanıcı hafıza sürümü (`memory_revision`), mesaj bağlam sürümü (`context_revision`), sıralama sayacı (`context_order`) ve thread konu özeti (`context_summary`) ekler. Eski mesajlar `-1` sürümüyle işaretlenir; kişisel ham geçmiş taşınmadan konu özeti hazırlanır. Mesajlar/veriler silinmez. Bu değişiklikte snapshot izole **yerel PostgreSQL** üzerinden yenilendi; Supabase canlı şemasının güncellendiği anlamına gelmez. Normal uygulama başlangıcı aynı TypeORM migration’ını seçilen DB üzerinde uygular.
