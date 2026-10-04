# AI oturumları teslimi

Case, AI oturumlarının ham biçimde teslim edilmesini istiyor. Yalnızca bu case'e ait oturumları dahil edin; başka projelerin oturumlarını paylaşmayın.

Codex oturumları `~/.codex/sessions/` altında bulunur. İlgili JSONL dosyasını, sırasını ve içeriğini koruyarak teslim paketine kopyalayın. Yalnızca API anahtarı, token, parola gibi secret değerlerini `[REDACTED]` ile maskeleyin. Oturumu özetlemeyin veya konuşmaları çıkarmayın.

`delivery/` dizini Git ve Docker build context dışında tutulur. Ham kayıtları inceleyip secret maskelemesini tamamladıktan sonra ayrı arşiv olarak paylaşın. Buradaki dosya teslim yönergesidir; henüz paylaşılmış bir oturum arşivi değildir. Çalışma sürerken aktif oturum dosyası değişmeye devam eder; son kopyayı çalışma tamamlandıktan sonra alın.

Yalnız seçilen case oturumunun snapshot'ını almak için:

```sh
node scripts/export-session.mjs /absolute/path/to/case-session.jsonl
```

Script satırları yeniden biçimlendirmez; `.env` içindeki uzun secret değerlerini ve tanınan OpenAI anahtarlarını maskeler. Diğer sağlayıcılara ait veya farklı yerde geçen secret'lar için teslim öncesi son kontrolü yapın. Orijinal oturum dosyasını değiştirmez.
