# TeamCreate

## Tanım

Bir proje üzerinde çalışan birden fazla agent'ı koordine etmek için yeni bir takım oluşturur. Takımlar, paylaşılan bir görev listesi ve agent'lar arası mesajlaşma aracılığıyla paralel görev yürütmeyi mümkün kılar.

## Parametreler

| Parametre | Tür | Zorunlu | Açıklama |
|-----------|-----|---------|----------|
| `team_name` | string | Evet | Yeni takımın adı |
| `description` | string | Hayır | Takım açıklaması / amacı |
| `agent_type` | string | Hayır | Takım liderinin türü / rolü |

## Oluşturulanlar

- **Takım yapılandırma dosyası**: `~/.claude/teams/{team-name}/config.json` — üye listesini ve meta verileri saklar
- **Görev listesi dizini**: `~/.claude/tasks/{team-name}/` — tüm takım üyeleri için paylaşılan görev listesi

Takımlar ile görev listeleri arasında 1:1 ilişki vardır.

## Takım İş Akışı

1. **TeamCreate** — takımı ve görev listesini oluştur
2. **TaskCreate** — takım için görevleri tanımla
3. **Agent** (`team_name` + `name` ile) — takıma katılan takım üyelerini başlat
4. **TaskUpdate** — `owner` aracılığıyla görevleri takım üyelerine ata
5. Takım üyeleri görevler üzerinde çalışır ve **SendMessage** ile iletişim kurar
6. İşlem bitince takım üyelerini kapat, ardından **TeamDelete** ile temizlik yap

## İlgili Araçlar

| Araç | Amaç |
|------|------|
| `TeamDelete` | Takımı ve görev dizinlerini kaldır |
| `SendMessage` | Takım içi agent'lar arası iletişim |
| `TaskCreate` / `TaskUpdate` / `TaskList` / `TaskGet` | Paylaşılan görev listesini yönet |
| `Agent` | Takıma katılan takım üyelerini başlat |
