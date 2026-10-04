# Embedding, retrieval ve agent değerlendirmesi

3–4 Ekim 2026. 25 ürün davranışı grubu. Girdi/beklenen/gerçek/sonuç satırları ilgili ayrıntılı raporlarda bulunur. Başlangıç başarısızlıkları ve son sonuçlar korunmuştur; yinelenen ara koşular repo dışında arşivlenmiştir.

## Sabitler ve karşılaştırma yöntemi

56 sorgu: 34 cevaplanabilir, 22 dokümanda cevabı olmayan sorgu; 38 kalibrasyon, 18 ayrı doğrulama sorgusu. Aşağıdaki tablo tüm 56 sorguda tek arama çağrısının sonucudur. Doğru retrieval, gereken tüm cevap parçalarının topK içinde olmasıdır. “Yanlış kabul”, cevapsız bir soruya arama adayının dönmesidir; nihai asistanın yanlış cevap vermesiyle aynı şey değildir. Agent çoklu arama/kanıt kontrolü ayrıca test edilmiştir.

Eşikler aynı vektör/sorgu kümesinde karşılaştırıldı. Boyut 512/768/1536; topK 1/3/5; chunk 100/200/350; overlap 0/30/60; açıklama ağırlığı %0/%10/%25/%40. Parametre sıralaması kalibrasyonda yapıldı; doğrulama ayrıca raporlandı. Hata ayıklamada doğrulama örnekleri de görüldüğünden bunlar bağımsız, tarafsız bir başarı tahmini olarak sunulmaz. Küçük fixture kümesinin dışına genellenemez.

| Provider | Eşik | topK | Doğru /34 | Kaçan /34 | Cevapsız sorguya aday /22 | Doğru ret /22 |
|---|---:|---:|---:|---:|---:|---:|
| mock | 0.16 | 1 | 30 | 4 | 16 | 6 |
| mock | 0.16 | 3 | 33 | 1 | 16 | 6 |
| mock | 0.30 | 3 | 32 | 2 | 12 | 10 |
| mock | 0.40 | 3 | 28 | 6 | 9 | 13 |
| mock | 0.30 | 5 | 32 | 2 | 12 | 10 |
| mock | 0.40 | 5 | 28 | 6 | 9 | 13 |
| mock | 0.50 | 5 | 27 | 7 | 6 | 16 |

### mock: somut yanlış eşleşmeler ve kaçırılan kaynaklar

| Sorgu | En yüksek skor | Gereken parça skoru / sırası | Beklenti |
|---|---:|---|---|
| İzin talebimi ne kadar önceden iletmeliyim? | 0.5361 | 0.5361 / #1 | en az 5 iş günü |
| VPN şifresi nedir? | 0.2617 | Cevap yok | Bilgi bulunamadı; kaynaksız cevap |
| Toplantı odaları kaç kişilik? | 0.5020 | Cevap yok | Bilgi bulunamadı; kaynaksız cevap |
| Yemek kartı bakiyesini nakde çevirebilir miyim? | 0.5578 | Cevap yok | Bilgi bulunamadı; kaynaksız cevap |
| Öğle arası ne zaman, doğum günü izni kaç gün? | 0.6512 | 0.1480 / #8, 0.6512 / #1 | 12.00–13.00; 1 iş günüdür |

| Provider | Eşik | topK | Doğru /34 | Kaçan /34 | Cevapsız sorguya aday /22 | Doğru ret /22 |
|---|---:|---:|---:|---:|---:|---:|
| live | 0.16 | 1 | 28 | 6 | 22 | 0 |
| live | 0.16 | 3 | 32 | 2 | 22 | 0 |
| live | 0.30 | 3 | 32 | 2 | 19 | 3 |
| live | 0.40 | 3 | 32 | 2 | 15 | 7 |
| live | 0.30 | 5 | 34 | 0 | 19 | 3 |
| live | 0.40 | 5 | 34 | 0 | 15 | 7 |
| live | 0.50 | 5 | 24 | 10 | 11 | 11 |

### live: somut yanlış eşleşmeler ve kaçırılan kaynaklar

| Sorgu | En yüksek skor | Gereken parça skoru / sırası | Beklenti |
|---|---:|---|---|
| İzin talebimi ne kadar önceden iletmeliyim? | 0.5963 | 0.5378 / #4 | en az 5 iş günü |
| VPN şifresi nedir? | 0.4704 | Cevap yok | Bilgi bulunamadı; kaynaksız cevap |
| Toplantı odaları kaç kişilik? | 0.5054 | Cevap yok | Bilgi bulunamadı; kaynaksız cevap |
| Yemek kartı bakiyesini nakde çevirebilir miyim? | 0.6845 | Cevap yok | Bilgi bulunamadı; kaynaksız cevap |
| Öğle arası ne zaman, doğum günü izni kaç gün? | 0.5520 | 0.4176 / #5, 0.5520 / #1 | 12.00–13.00; 1 iş günüdür |

## Uygulanan kararlar

- **Mock: eşik 0.16, topK=3 korundu.** Eşik 0.30 olunca cevaplanabilir sorularda kaçırma artıyor. 5 aday, bu kümede 3 adaya göre recall sağlamadı. Ortak kelimeli yanlış cevapları eşik yerine muhafazakâr soru terimi/başlık eşlemesi ve kaynak cümlesi seçimi engelliyor. Bu mock gerçek semantik model değildir.
- **OpenAI: eşik 0.30 → 0.40; topK 3 → 5.** 0.40 aynı topK içinde daha az cevapsız sorguya aday döndürdü; 0.50 doğru soruları kaybetti. top5, özellikle izin talebinin ön bildirim süresini içeren daha aşağıdaki parçayı korudu. İlk search_docs sorgusu kullanıcı metni olarak korunuyor; canlı modelin sorguyu yeniden yazması doğru kaynağı eşik altında bırakıyordu. Sonraki aramalar yeniden ifade edilebilir.
- **Açıklama ağırlığı %25 korundu.** %10 bazı sorgularda küçük skor kazanımı sağladı; fakat yalnız alt açıklamada bulunan ifadeyle arama entegrasyon testi başarısız oldu. Bu regresyon nedeniyle %10 değişikliği geri alındı.
- **1536 boyut korundu.** Küçük testte 512 boyutlu hashing bazı F1 değerlerinde öne çıktı; boyut düşürmek tutarlı bir ürün iyileşmesi göstermedi. Ortak SQL şeması ve OpenAI boyutu korundu; NaN/Infinity/sıfır/yanlış boyut/sıra/adet reddediliyor.
- **200 kelime / 30 overlap korundu; başlık hiyerarşisi düzeltildi.** Kısa seed parçaları tüm ayarlarda 24 chunk olduğu için onlardan boyut optimumu çıkarılmadı. Sentetik uzun dokümanda 100/0 sınırdaki cevabı böldü; 100/60 10 chunk ve 992 saklanan kelime üretti. 200/30 aynı bilgiyi 3 chunk/470 kelimeyle korudu. 350/30 da bilgiyi korudu; daha iyi retrieval sağladığına dair kanıt yok. Ebeveyn başlıklar her parçada taşınıyor, overlap=0 ve kelime kaybı test ediliyor.
- **6 model adımı / 60 saniye korundu.** İsim+departman+tercih kayıtları ve arama için yeterli; sonsuz tool döngüsü, yinelenen çağrı kimliği ve iptalden sonra gelen model sonucunun yeni tool yazımı başlatması engelleniyor. Timeout/bozuk SDK yanıtı kontrolleri gerçek API harcamak yerine fault injection ile yapılıyor.

## Davranış düzeltmeleri

Boş/noktalama/Unicode boşluğu HTTP 400 ile provider çağrısından önce durur. Anlamsız metne açıklama istenir. Üç aynı tercih tek kayıt olarak kalır; gereksiz timestamp güncellemesi yapılmaz. Arkadaş/alıntı/koşul/çelişkili beyan kullanıcı hafızasına yazılmaz. “Eskiden … şimdi …” ve “artık …” güncel açık beyanı seçer. Bir tercihi inkâr etmek “kısıtlamam yok” diye yeni bir tercih oluşturmaz; yalnız eşleşen mevcut tercih geri çekilir. Yeni thread güncel DB hafızasını okur; silinen bilgi eski konuşmalardan yeniden türetilmez.

Mock soruları parçalara ayırıp her konu için tool sonucu alır; farklı ayrıntılar için ilgili kaynak cümlesini seçer. Prosedür sorularında adımlar korunur. Çok konulu sorunun yalnız bir bölümünün cevabı varsa diğer bölümün bilinmediği açıkça belirtilir.

OpenAI, ilk aramayı veya açık hafıza kaydından sonra sorunun aramasını atlayamaz. Yapısal yanıtta cevaplanabilirlik ve birebir kanıt alıntıları gerekir. Backend alıntıyı bu çalıştırmanın arama sonuçlarında bulup chunk kimliğini kendisi çözer; modelin yanlış UUID kopyalaması kullanıcıya kaynak diye sunulmaz. Uydurma alıntı/ham agent kaynak kimliği reddedilir. Ardından ayrı semantik denetim, sorulan ayrıntının alıntılarla gerçekten desteklenip desteklenmediğini kontrol eder; ret durumunda kaynaklı iddia sunulmaz. Bu model adımı aynı 6 adım/60 saniye bütçesine dahildir. Denetim ek maliyet/gecikme getirir ve modelin semantik yorumunun her olası girdide doğru olduğunu garanti etmez. Aynı kaynaktaki atlanmış aralıklı cümlelerin her biri ayrı doğrulanır; sayısal/sözcük değişimi kabul edilmez. OpenAI sıcaklığı 0 olarak seçildi: bu bir teknik tercih, ayrı A/B testiyle kanıtlanmış üstünlük değil; determinizm garantisi vermez.

## Sonuç kayıtları

| Rapor | Geçti | Kaldı |
|---|---:|---:|
| [baseline-live](baseline-live.md) | 47 | 31 |
| [baseline-mock](baseline-mock.md) | 60 | 42 |
| [baseline-reviewed-live](baseline-reviewed-live.md) | 53 | 25 |
| [baseline-reviewed-mock](baseline-reviewed-mock.md) | 60 | 42 |
| [checked-live](checked-live.md) | 99 | 0 |
| [conversation-summary-english-live](conversation-summary-english-live.md) | 106 | 0 |
| [manual-fixes-mock](manual-fixes-mock.md) | 137 | 0 |
| [memory-recall-initial-live](memory-recall-initial-live.md) | 103 | 1 |
| [memory-recall-live](memory-recall-live.md) | 106 | 0 |
| [memory-recall-mock](memory-recall-mock.md) | 137 | 0 |

Baseline-reviewed raporları aynı ilk çıktıları son anlam eşdeğerliği kontrolüyle yeniden puanlar; yeni API cevabı üretilmez. Örneğin “12.00 ile 13.00” ve “12.00–13.00” aynı doğru bilgidir. Sayı/değer ve gerçek kaynak şartı korunur. Başlangıç ve son toplamları eklenen kontroller yüzünden farklıdır.

## Tekrar çalıştırma

```sh
# İzole Docker test DB; normal yerel ve Supabase verilerine yazmaz
docker compose -p uplico-eval -f compose.test.yaml run --build --rm evaluation
docker compose -p uplico-eval -f compose.test.yaml down -v
```

Yerel test DB 55432 portunda ayrı *_test veritabanı olarak açıldıysa `pnpm test:evaluation` kullanılabilir. Başarısız kontrol process exit code 1 üretir. CI aynı mock değerlendirmesini çalıştırır. OpenAI SDK unit testleri `pnpm test` içindedir. Canlı testler otomatik CI işine eklenmez; `EVAL_LIVE=1` + backend DATABASE_URL/OPENAI_API_KEY ile `backend/test/evaluation/run.ts` açıkça çağrılır. Canlı koşu sabit 2 USD harcama koruması ve özel embedding cache kullanır; veritabanında geçici, RLS etkin değerlendirme şeması oluşturur ve finally içinde siler. Başlangıçta var olan aynı adlı şema otomatik silinmez.

## 25 grubun son durumu

| Grup | Kapsam | Mock / ortak servis / fake SDK | Gerçek OpenAI + izole Supabase |
|---|---|---|---|
| 01 | Doğrudan politika soruları | 8/8 GEÇTİ | 8/8 GEÇTİ |
| 02 | Farklı ifadeler | 8/8 GEÇTİ | 8/8 GEÇTİ |
| 03 | Türkçe/ASCII/büyük harf | 6/6 GEÇTİ | 6/6 GEÇTİ |
| 04 | Sınırlı yazım hataları | 6/6 GEÇTİ | 6/6 GEÇTİ |
| 05 | Alakasız konular | 7/7 GEÇTİ | 7/7 GEÇTİ |
| 06 | Ortak kelimeli cevapsız sorular | 16/16 GEÇTİ | 16/16 GEÇTİ |
| 07 | Birden fazla konu | 5/5 GEÇTİ | 5/5 GEÇTİ |
| 08 | Kişiselleştirilmiş soru | 3/3 GEÇTİ | 3/3 GEÇTİ |
| 09 | Boş/noktalama/Unicode boşluğu | 4/4 GEÇTİ | Bu ortamda çalıştırılmadı |
| 10 | Uzun metin/doküman | 2/2 GEÇTİ | 1/1 GEÇTİ |
| 11 | Chunk sınırındaki bilgi | 1/1 GEÇTİ | Bu ortamda çalıştırılmadı |
| 12 | Üst/alt başlıklar | 1/1 GEÇTİ | Bu ortamda çalıştırılmadı |
| 13 | topK/eşit skor | 1/1 GEÇTİ | Bu ortamda çalıştırılmadı |
| 14 | Boyut/determinizm | 1/1 GEÇTİ | Bu ortamda çalıştırılmadı |
| 15 | Hatalı embedding | 5/5 GEÇTİ | Bu ortamda çalıştırılmadı |
| 16 | Hafıza oluştur/güncelle | 8/8 GEÇTİ | 7/7 GEÇTİ |
| 17 | Silme/yeni thread | 6/6 GEÇTİ | 2/2 GEÇTİ |
| 18 | Olumsuz/çelişkili bilgi | 12/12 GEÇTİ | 12/12 GEÇTİ |
| 19 | Başkasının sözü/alıntı/koşul | 16/16 GEÇTİ | 16/16 GEÇTİ |
| 20 | Doküman CRUD | 3/3 GEÇTİ | 1/1 GEÇTİ |
| 21 | Provider değişimi | 1/1 GEÇTİ | 1/1 GEÇTİ |
| 22 | Tool döngüsü/kaynak | 2/2 GEÇTİ | Bu ortamda çalıştırılmadı |
| 23 | Timeout/iptal | 2/2 GEÇTİ | Bu ortamda çalıştırılmadı |
| 24 | Adım/tool/argüman sınırları | 4/4 GEÇTİ | Bu ortamda çalıştırılmadı |
| 25 | OpenAI sözleşmesi | 9/9 GEÇTİ | Bu ortamda çalıştırılmadı |

Son mock raporunun 137 kontrolünün 128’i mock/ortak servis/yerel PostgreSQL, 9’u sahte SDK yanıtlarıdır. Grup 25 hiçbir canlı API başarısı iddia etmez. Güncel unit/sahte SDK regresyonunda 72 test vardır. Canlı kolon yalnız gerçekten çalıştırılan grupları gösterir; timeout/bozuk yanıt gibi durumlar fault injection ile sınanır.

Ayrıntılar: [137 son mock/sözleşme kontrolü](manual-fixes-mock.md), [İngilizce promptlarla canlı yerel PostgreSQL koşusu](conversation-summary-english-live.md), [canlı kabul koşusu](checked-live.md). Her satırın girdisi, bekleneni, gerçek sonucu ve geçti/kaldı durumu kayıtlıdır.

## İlk değerlendirme turunun API kullanımı ve verinin korunması

İlk değerlendirme turunda toplam 1886 gerçek API çağrısı: 1661 chat, 225 embedding. Tekrar kullanılan embedding yanıtları özel yerel cache’den okunur ve yeni çağrı sayılmaz. Usage tokenlarıyla hesaplanan tahmini maliyet **0.819185 USD**, onaylı üst sınır 2 USD. Fatura tutarı ayrıca sağlayıcıdan doğrulanmadı. [Resmî fiyatlar](https://developers.openai.com/api/docs/pricing): gpt-4.1-mini girdi $0.40/M, çıktı $1.60/M; text-embedding-3-small $0.02/M.

Supabase public tabloları önce/sonra hash karşılaştırmasında değişmedi; geçici test şeması kaldırıldı. Yerel gerçek kullanıcı/thread/message/memory satırları ve doküman ID/metin/açıklama/revision/silinme durumu korundu. Yeni algoritma nedeniyle yalnız türetilmiş 24 chunk/embedding yeniden üretildi. .env ve kullanıcı cookie’si değiştirilmedi. Ayrı UI/test Compose projeleri temizlendi. TypeORM migrations tablosu korundu.
