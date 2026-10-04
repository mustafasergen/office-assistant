import json,gzip
from collections import Counter
from pathlib import Path
root=Path(__file__).resolve().parent.parent/'docs/evaluation'
lines=['# Embedding, retrieval ve agent değerlendirmesi','', '3–4 Ekim 2026. 25 ürün davranışı grubu. Girdi/beklenen/gerçek/sonuç satırları ilgili ayrıntılı raporlarda bulunur. Başlangıç başarısızlıkları ve son sonuçlar korunmuştur; yinelenen ara koşular repo dışında arşivlenmiştir.','', '## Sabitler ve karşılaştırma yöntemi','', '56 sorgu: 34 cevaplanabilir, 22 dokümanda cevabı olmayan sorgu; 38 kalibrasyon, 18 ayrı doğrulama sorgusu. Aşağıdaki tablo tüm 56 sorguda tek arama çağrısının sonucudur. Doğru retrieval, gereken tüm cevap parçalarının topK içinde olmasıdır. “Yanlış kabul”, cevapsız bir soruya arama adayının dönmesidir; nihai asistanın yanlış cevap vermesiyle aynı şey değildir. Agent çoklu arama/kanıt kontrolü ayrıca test edilmiştir.','', 'Eşikler aynı vektör/sorgu kümesinde karşılaştırıldı. Boyut 512/768/1536; topK 1/3/5; chunk 100/200/350; overlap 0/30/60; açıklama ağırlığı %0/%10/%25/%40. Parametre sıralaması kalibrasyonda yapıldı; doğrulama ayrıca raporlandı. Hata ayıklamada doğrulama örnekleri de görüldüğünden bunlar bağımsız, tarafsız bir başarı tahmini olarak sunulmaz. Küçük fixture kümesinin dışına genellenemez.','', '| Provider | Eşik | topK | Doğru /34 | Kaçan /34 | Cevapsız sorguya aday /22 | Doğru ret /22 |','|---|---:|---:|---:|---:|---:|---:|']
for name in ['mock','live']:
 p=root/f'sweep-{name}.json.gz'
 d=json.load(gzip.open(p))
 for k,th in [(1,.16),(3,.16),(3,.3),(3,.4),(5,.3),(5,.4),(5,.5)]:
  rows=[r for r in d['comparisons'] if r['dimensions']==1536 and r['size']==200 and r['overlap']==30 and r['weight']==.25 and r['k']==k and abs(r['threshold']-th)<1e-8]
  m={v:sum(r[v] for r in rows) for v in ['tp','fn','fp','tn']}
  lines.append(f'| {name} | {th:.2f} | {k} | {m["tp"]} | {m["fn"]} | {m["fp"]} | {m["tn"]} |')
 lines+=['',f'### {name}: somut yanlış eşleşmeler ve kaçırılan kaynaklar','', '| Sorgu | En yüksek skor | Gereken parça skoru / sırası | Beklenti |','|---|---:|---|---|']
 detail=next(x for x in d['detail'] if x['weight']==.25)
 for q in detail['scores']:
  if q['query'] not in ['İzin talebimi ne kadar önceden iletmeliyim?','VPN şifresi nedir?','Toplantı odaları kaç kişilik?','Mars kaç kilometre?','Öğle arası ne zaman, doğum günü izni kaç gün?','Yemek kartı bakiyesini nakde çevirebilir miyim?']:continue
  ranks=[]
  for e in q['evidence']:
   found=[(i+1,r['score']) for i,r in enumerate(q['ranked']) if e in r['content']]
   ranks.append(f'{found[0][1]:.4f} / #{found[0][0]}' if found else 'yok')
  lines.append(f'| {q["query"]} | {q["ranked"][0]["score"]:.4f} | {", ".join(ranks) or "Cevap yok"} | {"; ".join(q["evidence"]) or "Bilgi bulunamadı; kaynaksız cevap"} |')
 lines+=['']
 # Reopen table for the next provider, separated by its examples.
 if name=='mock':lines+=['| Provider | Eşik | topK | Doğru /34 | Kaçan /34 | Cevapsız sorguya aday /22 | Doğru ret /22 |','|---|---:|---:|---:|---:|---:|---:|']
lines+=['## Uygulanan kararlar','',
'- **Mock: eşik 0.16, topK=3 korundu.** Eşik 0.30 olunca cevaplanabilir sorularda kaçırma artıyor. 5 aday, bu kümede 3 adaya göre recall sağlamadı. Ortak kelimeli yanlış cevapları eşik yerine muhafazakâr soru terimi/başlık eşlemesi ve kaynak cümlesi seçimi engelliyor. Bu mock gerçek semantik model değildir.',
'- **OpenAI: eşik 0.30 → 0.40; topK 3 → 5.** 0.40 aynı topK içinde daha az cevapsız sorguya aday döndürdü; 0.50 doğru soruları kaybetti. top5, özellikle izin talebinin ön bildirim süresini içeren daha aşağıdaki parçayı korudu. İlk search_docs sorgusu kullanıcı metni olarak korunuyor; canlı modelin sorguyu yeniden yazması doğru kaynağı eşik altında bırakıyordu. Sonraki aramalar yeniden ifade edilebilir.',
'- **Açıklama ağırlığı %25 korundu.** %10 bazı sorgularda küçük skor kazanımı sağladı; fakat yalnız alt açıklamada bulunan ifadeyle arama entegrasyon testi başarısız oldu. Bu regresyon nedeniyle %10 değişikliği geri alındı.',
'- **1536 boyut korundu.** Küçük testte 512 boyutlu hashing bazı F1 değerlerinde öne çıktı; boyut düşürmek tutarlı bir ürün iyileşmesi göstermedi. Ortak SQL şeması ve OpenAI boyutu korundu; NaN/Infinity/sıfır/yanlış boyut/sıra/adet reddediliyor.',
'- **200 kelime / 30 overlap korundu; başlık hiyerarşisi düzeltildi.** Kısa seed parçaları tüm ayarlarda 24 chunk olduğu için onlardan boyut optimumu çıkarılmadı. Sentetik uzun dokümanda 100/0 sınırdaki cevabı böldü; 100/60 10 chunk ve 992 saklanan kelime üretti. 200/30 aynı bilgiyi 3 chunk/470 kelimeyle korudu. 350/30 da bilgiyi korudu; daha iyi retrieval sağladığına dair kanıt yok. Ebeveyn başlıklar her parçada taşınıyor, overlap=0 ve kelime kaybı test ediliyor.',
'- **6 model adımı / 60 saniye korundu.** İsim+departman+tercih kayıtları ve arama için yeterli; sonsuz tool döngüsü, yinelenen çağrı kimliği ve iptalden sonra gelen model sonucunun yeni tool yazımı başlatması engelleniyor. Timeout/bozuk SDK yanıtı kontrolleri gerçek API harcamak yerine fault injection ile yapılıyor.',
'', '## Davranış düzeltmeleri','',
'Boş/noktalama/Unicode boşluğu HTTP 400 ile provider çağrısından önce durur. Anlamsız metne açıklama istenir. Üç aynı tercih tek kayıt olarak kalır; gereksiz timestamp güncellemesi yapılmaz. Arkadaş/alıntı/koşul/çelişkili beyan kullanıcı hafızasına yazılmaz. “Eskiden … şimdi …” ve “artık …” güncel açık beyanı seçer. Bir tercihi inkâr etmek “kısıtlamam yok” diye yeni bir tercih oluşturmaz; yalnız eşleşen mevcut tercih geri çekilir. Yeni thread güncel DB hafızasını okur; silinen bilgi eski konuşmalardan yeniden türetilmez.',
'', 'Mock soruları parçalara ayırıp her konu için tool sonucu alır; farklı ayrıntılar için ilgili kaynak cümlesini seçer. Prosedür sorularında adımlar korunur. Çok konulu sorunun yalnız bir bölümünün cevabı varsa diğer bölümün bilinmediği açıkça belirtilir.',
'', 'OpenAI, ilk aramayı veya açık hafıza kaydından sonra sorunun aramasını atlayamaz. Yapısal yanıtta cevaplanabilirlik ve birebir kanıt alıntıları gerekir. Backend alıntıyı bu çalıştırmanın arama sonuçlarında bulup chunk kimliğini kendisi çözer; modelin yanlış UUID kopyalaması kullanıcıya kaynak diye sunulmaz. Uydurma alıntı/ham agent kaynak kimliği reddedilir. Ardından ayrı semantik denetim, sorulan ayrıntının alıntılarla gerçekten desteklenip desteklenmediğini kontrol eder; ret durumunda kaynaklı iddia sunulmaz. Bu model adımı aynı 6 adım/60 saniye bütçesine dahildir. Denetim ek maliyet/gecikme getirir ve modelin semantik yorumunun her olası girdide doğru olduğunu garanti etmez. Aynı kaynaktaki atlanmış aralıklı cümlelerin her biri ayrı doğrulanır; sayısal/sözcük değişimi kabul edilmez. OpenAI sıcaklığı 0 olarak seçildi: bu bir teknik tercih, ayrı A/B testiyle kanıtlanmış üstünlük değil; determinizm garantisi vermez.',
'', '## Sonuç kayıtları','', '| Rapor | Geçti | Kaldı |','|---|---:|---:|']
for p in sorted(root.glob('*.json')):
 if not any(p.name.startswith(prefix) for prefix in ['baseline-','checked-','manual-fixes-','conversation-summary-english-','memory-recall-']):continue
 d=json.load(open(p))
 if 'results' not in d:continue
 c=Counter(r['pass'] for r in d['results']);lines.append(f'| [{p.stem}]({p.stem}.md) | {c[True]} | {c[False]} |')
lines+=['', 'Baseline-reviewed raporları aynı ilk çıktıları son anlam eşdeğerliği kontrolüyle yeniden puanlar; yeni API cevabı üretilmez. Örneğin “12.00 ile 13.00” ve “12.00–13.00” aynı doğru bilgidir. Sayı/değer ve gerçek kaynak şartı korunur. Başlangıç ve son toplamları eklenen kontroller yüzünden farklıdır.', '', '## Tekrar çalıştırma','', '```sh', '# İzole Docker test DB; normal yerel ve Supabase verilerine yazmaz', 'docker compose -p uplico-eval -f compose.test.yaml run --build --rm evaluation', 'docker compose -p uplico-eval -f compose.test.yaml down -v', '```', '', 'Yerel test DB 55432 portunda ayrı *_test veritabanı olarak açıldıysa `pnpm test:evaluation` kullanılabilir. Başarısız kontrol process exit code 1 üretir. CI aynı mock değerlendirmesini çalıştırır. OpenAI SDK unit testleri `pnpm test` içindedir. Canlı testler otomatik CI işine eklenmez; `EVAL_LIVE=1` + backend DATABASE_URL/OPENAI_API_KEY ile `backend/test/evaluation/run.ts` açıkça çağrılır. Canlı koşu sabit 2 USD harcama koruması ve özel embedding cache kullanır; veritabanında geçici, RLS etkin değerlendirme şeması oluşturur ve finally içinde siler. Başlangıçta var olan aynı adlı şema otomatik silinmez.']
acceptance = root/'checked-live.json'
if acceptance.exists():
 mock=json.load(open(root/'manual-fixes-mock.json'))['results']
 live=json.load(open(acceptance))['results']
 names={}
 for line in (root/'PLAN.md').read_text().splitlines():
  columns=line.split('|')
  if len(columns)>3 and columns[1].strip().isdigit(): names[columns[1].strip()]=columns[2].strip()
 lines+=['', '## 25 grubun son durumu', '', '| Grup | Kapsam | Mock / ortak servis / fake SDK | Gerçek OpenAI + izole Supabase |', '|---|---|---|---|']
 for group,name in names.items():
  def state(rows):
   selected=[r for r in rows if r['group']==group]
   if not selected:return 'Bu ortamda çalıştırılmadı'
   return str(sum(r['pass'] for r in selected))+'/'+str(len(selected))+' '+('GEÇTİ' if all(r['pass'] for r in selected) else 'KALDI')
  lines.append(f'| {group} | {name} | {state(mock)} | {state(live)} |')
 lines+=['', 'Son mock raporunun 137 kontrolünün 128’i mock/ortak servis/yerel PostgreSQL, 9’u sahte SDK yanıtlarıdır. Grup 25 hiçbir canlı API başarısı iddia etmez. Güncel unit/sahte SDK regresyonunda 72 test vardır. Canlı kolon yalnız gerçekten çalıştırılan grupları gösterir; timeout/bozuk yanıt gibi durumlar fault injection ile sınanır.', '', 'Ayrıntılar: [137 son mock/sözleşme kontrolü](manual-fixes-mock.md), [İngilizce promptlarla canlı yerel PostgreSQL koşusu](conversation-summary-english-live.md), [canlı kabul koşusu](checked-live.md). Her satırın girdisi, bekleneni, gerçek sonucu ve geçti/kaldı durumu kayıtlıdır.']
usage=root/'api-usage.json'
if usage.exists():
 cost=json.load(open(usage))
 lines+=['', '## İlk değerlendirme turunun API kullanımı ve verinin korunması', '', f"İlk değerlendirme turunda toplam {cost['totalCalls']} gerçek API çağrısı: {cost['chatCalls']} chat, {cost['embeddingCalls']} embedding. Tekrar kullanılan embedding yanıtları özel yerel cache’den okunur ve yeni çağrı sayılmaz. Usage tokenlarıyla hesaplanan tahmini maliyet **{cost['estimatedCostUsd']:.6f} USD**, onaylı üst sınır 2 USD. Fatura tutarı ayrıca sağlayıcıdan doğrulanmadı. [Resmî fiyatlar](https://developers.openai.com/api/docs/pricing): gpt-4.1-mini girdi $0.40/M, çıktı $1.60/M; text-embedding-3-small $0.02/M.", '', 'Supabase public tabloları önce/sonra hash karşılaştırmasında değişmedi; geçici test şeması kaldırıldı. Yerel gerçek kullanıcı/thread/message/memory satırları ve doküman ID/metin/açıklama/revision/silinme durumu korundu. Yeni algoritma nedeniyle yalnız türetilmiş 24 chunk/embedding yeniden üretildi. .env ve kullanıcı cookie’si değiştirilmedi. Ayrı UI/test Compose projeleri temizlendi. TypeORM migrations tablosu korundu.']
(root/'REPORT.md').write_text('\n'.join(lines)+'\n')
