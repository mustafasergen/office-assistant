# Teslim düzeni — 4 Ekim 2026

- README teslim alacak kişinin kurulum ve kullanım akışına göre sadeleştirildi. Başlık **Ofis Asistanı**; README'deki marka adı kaldırıldı. Demo, env, iki deployment biçimi, agent/arama/hafıza/özet ve test komutları tek yerde toplandı.
- `docs/evaluation/` altındaki **52 ara rapor** repo dışına arşivlendi: iteration/focused/acceptance/complete/final/release/verified/coverage/grounding/ci ve eski exploratory sweep çıktıları. Son mock sonuçları, İngilizce prompt canlı sonuçları, Supabase kabul koşusu, baseline karşılaştırmaları, memory recall önce/sonra ve asıl parametre sweep'leri korundu.
- Geçici `delivery/`, `playwright-report/`, `test-results/`, `evaluation-results/` çıktıları da repo dışında arşivlendi. Son testlerin okunabilir çıktıları `docs/test-reports/delivery-*` altında kaldı. Test kodları, scriptler, migration'lar, lockfile ve dört fixture silinmedi.
- Rapor üreticisi kalan raporlara göre güncellendi; Markdown bağlantıları kontrol edildi. Ham AI kaydı Docker build context ve otomatik formatter dışında tutulur; Git'e eklenebilir.
- Local PostgreSQL ve proje Supabase'i geri yükleme provası yapılmış yedeklerden sonra temizlendi. Dört fixture aynı içeriklerle mock olarak indekslendi. `.env`, bağlantılar ve migration geçmişi korunur. Ayrıntılar [doğrulama kaydında](verification.md).

Arşiv/yedek dizini yalnız yerel makinededir: repo ile aynı üst dizindeki `office-assistant-delivery-2026-10-04/`. Dosya hash manifesti ve geri yükleme aracı bu özel dizindedir; GitHub'a eklenmez. Ham AI kopyasının sınırı ve maskeleme denetimi [AI teslim kaydında](ai-sessions.md) bulunur.

Commit, push ve deploy yapılmadı.
