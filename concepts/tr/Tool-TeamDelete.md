# TeamDelete

## Tanım

Çok agent'lı işbirliği çalışması tamamlandığında bir takımı ve ilişkili görev dizinlerini kaldırır. Bu, TeamCreate'in temizlik karşılığıdır.

## Davranış

- Takım dizinini kaldırır: `~/.claude/teams/{team-name}/`
- Görev dizinini kaldırır: `~/.claude/tasks/{team-name}/`
- Mevcut oturumdan takım bağlamını temizler

**Önemli**: Takımın hâlâ aktif üyeleri varsa TeamDelete başarısız olur. Takım üyeleri önce SendMessage kapatma istekleri aracılığıyla düzgün şekilde kapatılmalıdır.

## Tipik Kullanım

TeamDelete, bir takım iş akışının sonunda çağrılır:

1. Tüm görevler tamamlanır
2. Takım üyeleri `shutdown_request` ile `SendMessage` aracılığıyla kapatılır
3. **TeamDelete** takım ve görev dizinlerini kaldırır

## İlgili Araçlar

| Araç | Amaç |
|------|------|
| `TeamCreate` | Yeni bir takım ve görev listesi oluştur |
| `SendMessage` | Takım üyeleriyle iletişim kur / kapatma istekleri gönder |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | Paylaşılan görev listesini yönet |
| `Agent` | Takıma katılan takım üyelerini başlat |
