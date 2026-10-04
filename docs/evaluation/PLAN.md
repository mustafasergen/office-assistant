# Ürün davranışı değerlendirmesi

Onaylı API bütçesi: toplam 2 USD; gpt-4.1-mini (girdi $0.40/M, çıktı $1.60/M), text-embedding-3-small ($0.02/M). Beklentiler ilk çalıştırmadan önce tanımlanır. Baseline başarısızlıkları korunur. Kalibrasyon ve ayrı doğrulama örnekleri ayrılır; en iyi ayar yalnız kalibrasyonda seçilir.

| Grup | Girdi/kapsam | Ürün beklentisi |
|---|---|---|
| 01 | Doğrudan politika soruları | Doğru cevap bölümü ve kaynak |
| 02 | Farklı ifadeler | Aynı anlam, aynı desteklenen bilgi |
| 03 | Türkçe/ASCII/büyük harf | Anlam korunur |
| 04 | Sınırlı yazım hataları | Yaygın küçük hatalarda doğru kaynak |
| 05 | Alakasız konular | Bilgi uydurmadan sonuçsuz/ret |
| 06 | Ortak kelimeli cevapsız sorular | Konu benzerliği cevap kanıtı sayılmaz |
| 07 | Birden fazla konu | Sorulan her konuya destekli kaynak; eksikse açıkça belirt |
| 08 | Kişiselleştirilmiş soru | Hafıza gerçek kaynağı ve politikayı değiştirmez |
| 09 | Boş/noktalama/Unicode boşluğu | Gereksiz provider çağrısı olmadan sonuçsuz/400 |
| 10 | Uzun metin/doküman | Kayıpsız parçalama; sınır aşımı kontrollü |
| 11 | Chunk sınırındaki bilgi | Soru ile cevap bağlamı birlikte erişilebilir |
| 12 | Üst/alt başlıklar | Alt parça üst bağlamı kaybetmez |
| 13 | topK/eşit skor | Üst sınır ve tekrar edilebilir sıralama |
| 14 | Boyut/determinizm | 1536 sonlu, normalize; mock tekrar eşit |
| 15 | Hatalı embedding | Yanlış boyut/NaN/boş/sıfır kontrollü; kayıt bozulmaz |
| 16 | Hafıza oluştur/güncelle | Doğru kullanıcı, tek anahtar ve son açık beyan |
| 17 | Silme/yeni thread | Silinen hafıza geçmişten dirilmez |
| 18 | Olumsuz/çelişkili bilgi | Negasyon başka bir olumlu tercihe dönüşmez; belirsizlikte yazma |
| 19 | Başkasının sözü/alıntı/koşul | Kullanıcıya ait açık beyan olmadan yazma |
| 20 | Doküman CRUD | Güncel içerik aranır; eski/silinmiş bilgi çıkmaz |
| 21 | Provider değişimi | Karışık vektör uzayı yok; tekrar indeksleme atomik |
| 22 | Tool döngüsü/kaynak | Araç sonucu ikinci model çağrısına gider; sahte kaynak reddedilir |
| 23 | Timeout/iptal | Süre sınırı; iptal sonrası hafıza yazımı yok |
| 24 | Adım/tool/argüman sınırları | Sonsuz döngü yok; bilinmeyen ve kimlik enjekte eden araç yürütülmez |
| 25 | OpenAI sözleşmesi | Çağrı ID/devam bilgisi, sıralama, eksik JSON/API hatası kontrollü |

Her çalışmada grup/girdi/beklenen/gerçek/geçti-kaldı JSON ve Markdown olarak tutulur. Fake SDK sonuçları canlı API başarısı sayılmaz. Kullanıcı verilerine karşı test yazımı yerine izole yerel DB ve Supabase'de geçici değerlendirme şeması tercih edilir. Başlangıç/son kullanıcı tabloları hash'leri karşılaştırılır; üretilen test kaynakları temizlenir.

Ölçümler: doğru cevap parçası recall@K, yanlış kabul, yanlış ret, precision, ayrı kalibrasyon/doğrulama skor dağılımları. Eşik tek başına cevabın dokümanda bulunmasını garanti etmez. topK=1/3/5, chunk=100/200/350, overlap=0/30/60, açıklama ağırlığı=0/0.10/0.25/0.40; boyut=512/768/1536 yalnız izole deneyde. Timeout ve bozuk cevaplar gerçek API’ye kasıtlı masraf çıkarmadan fault injection ile sınanır.
