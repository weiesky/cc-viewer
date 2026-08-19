# Body Diff JSON (İstek Gövdesi Artımlı Karşılaştırma)

## Arka Plan

Claude Code'un MainAgent'ı tam bağlam gönderme mekanizması kullanır — her istek, konuşma geçmişinin tamamını, system prompt'u, araç tanımlarını ve diğer içerikleri taşır. Bu, konuşma ilerledikçe istek gövdesinin giderek büyüyeceği anlamına gelir ve ham Body'yi doğrudan inceleyerek "bu turda tam olarak ne eklendi" sorusunu yanıtlamak zorlaşır.

Body Diff JSON tam olarak bu sorunu çözmek için tasarlanmıştır: ardışık iki MainAgent isteğinin gövdesini otomatik olarak karşılaştırır, artımlı kısmı çıkarır ve bu istekte gerçekten eklenen içeriği bir bakışta görmenizi sağlar.

## Çalışma Prensibi

1. **Ardışık MainAgent isteklerini tanımlama**: Mevcut istek MainAgent türünde olmalı ve bir önceki MainAgent isteği mevcut olmalıdır
2. **Alan bazında karşılaştırma**: İstek gövdesinin tüm üst düzey alanları taranır, `_` önekli dahili özellikler atlanır
3. **Akıllı fark çıkarma**:
   - Eklenen alanlar: Doğrudan gösterilir
   - Silinen alanlar: Gösterilmez (genellikle anlamayı etkilemez)
   - Değişen alanlar: Mevcut değer gösterilir
   - `messages` dizisi özel işlem görür: Yalnızca eklenen mesajlar gösterilir (normal konuşmada ekleme modunda çalışıldığından önek mesajlar değişmez)
4. **İstek gövdesi küçülme tespiti**: Mevcut istek gövdesi bir öncekinden küçükse, bağlam kesme veya oturum sıfırlama gerçekleşmiş demektir; bu durumda diff yerine bilgi mesajı gösterilir

## Tipik Senaryolar

Normal bir konuşma turunda Body Diff JSON genellikle yalnızca şunları içerir:
- `messages`: Eklenen 1~2 mesaj (kullanıcının girişi + bir önceki turun asistan yanıtı)

Diff'te `system`, `tools`, `model` gibi alanların değişikliklerini görüyorsanız, bu turda yapılandırma değişikliği olduğu anlamına gelir ve bu genellikle önbellek yeniden oluşturmanın da nedenidir.

## Kullanım Şekli

- Body Diff JSON, MainAgent isteğinin detay panelinde gösterilir
- Başlığa tıklayarak genişletip/daraltabilirsiniz
- JSON ve Text olmak üzere iki görüntüleme modu ile tek tıkla kopyalama desteklenir
- Sol üst köşedeki **CC-Viewer → Genel Ayarlar** bölümünden "Body Diff JSON'u varsayılan olarak genişlet" seçeneği ayarlanabilir
