# Claude Code Araç Listesi

Claude Code, Anthropic API'nin tool_use mekanizması aracılığıyla modele bir dizi yerleşik araç sunar. Her MainAgent isteğinin `tools` dizisi bu araçların tam JSON Schema tanımlarını içerir ve model yanıtında `tool_use` content block aracılığıyla bunları çağırır.

Aşağıda tüm araçların kategorize edilmiş dizini bulunmaktadır.

## Agent Sistemi

| Araç | Kullanım Amacı |
|------|----------------|
| [Agent](Tool-Agent.md) | Karmaşık çok adımlı görevleri işlemek için alt agent (SubAgent) başlatma |
| [TaskOutput](Tool-TaskOutput.md) | Arka plan görevinin çıktısını alma |
| [TaskStop](Tool-TaskStop.md) | Çalışan arka plan görevini durdurma |
| [TaskCreate](Tool-TaskCreate.md) | Yapılandırılmış görev listesi girdisi oluşturma |
| [TaskGet](Tool-TaskGet.md) | Görev detaylarını alma |
| [TaskUpdate](Tool-TaskUpdate.md) | Görev durumunu, bağımlılıkları vb. güncelleme |
| [TaskList](Tool-TaskList.md) | Tüm görevleri listeleme |
| [ListAgents](Tool-ListAgents.md) | Oturumda mevcut olan agent'ları listeleme |

## Takım ve Orkestrasyonu

| Araç | Kullanım Amacı |
|------|----------------|
| [SendMessage](Tool-SendMessage.md) | Başka bir agenta mesaj gönderme |
| [Workflow](Tool-Workflow.md) | Deterministik çok ajanlı orkestrasyonu betiği çalıştırma |
| [Monitor](Tool-Monitor.md) | Uzun süreli betikten gelen olayları bildirim olarak akışla iletme |
| [SendFile](Tool-SendFile.md) | Başka bir Claude Code oturumuna dosya gönderme |
| [SendUserFile](Tool-SendUserFile.md) | Kullanıcıya dosya gönderme |
| [SendUserMessage](Tool-SendUserMessage.md) | Kullanıcıya mesaj gönderme (eski Brief aracı) |
| [EndConversation](Tool-EndConversation.md) | Mevcut konuşmayı sonlandırma |

## Dosya İşlemleri

| Araç | Kullanım Amacı |
|------|----------------|
| [Read](Tool-Read.md) | Dosya içeriğini okuma (metin, resim, PDF, Jupyter notebook desteği) |
| [Edit](Tool-Edit.md) | Kesin dize değiştirme ile dosya düzenleme |
| [Write](Tool-Write.md) | Dosya yazma veya üzerine yazma |
| [NotebookEdit](Tool-NotebookEdit.md) | Jupyter notebook hücresini düzenleme |

## Arama

| Araç | Kullanım Amacı |
|------|----------------|
| [Glob](Tool-Glob.md) | Dosya adı kalıp eşleştirmesiyle dosya arama |
| [Grep](Tool-Grep.md) | ripgrep tabanlı dosya içeriği arama |
| [ToolSearch](Tool-ToolSearch.md) | Ertelenmiş/MCP araçlarını talep üzerine arama ve yükleme |

## Terminal

| Araç | Kullanım Amacı |
|------|----------------|
| [Bash](Tool-Bash.md) | Shell komutu çalıştırma |
| [REPL](Tool-REPL.md) | Kalıcı bir Node.js REPL'inde JavaScript çalıştırma |

## Web

| Araç | Kullanım Amacı |
|------|----------------|
| [WebFetch](Tool-WebFetch.md) | Web sayfası içeriğini çekme ve AI ile işleme |
| [WebSearch](Tool-WebSearch.md) | Arama motoru sorgusu |
| [Artifact](Tool-Artifact.md) | HTML/Markdown dosyasını barındırılan claude.ai web sayfası olarak yayımlama |
| [DesignSync](Tool-DesignSync.md) | Yerel bileşen kütüphanesini claude.ai tasarım sistemi projesiyle senkronize etme |

## Planlama ve Etkileşim

| Araç | Kullanım Amacı |
|------|----------------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | Planlama moduna girme, uygulama planı tasarlama |
| [ExitPlanMode](Tool-ExitPlanMode.md) | Planlama modundan çıkma ve planı kullanıcı onayına sunma |
| [AskUserQuestion](Tool-AskUserQuestion.md) | Açıklama veya karar almak için kullanıcıya soru sorma |
| [ReportFindings](Tool-ReportFindings.md) | Kod incelemesi bulgularını ana makine UI'si için yazılan bir liste olarak raporlama |
| [TodoWrite](Tool-TodoWrite.md) | Oturum için yapılandırılmış todo listesi yazma |
| [SendFeedback](Tool-SendFeedback.md) | Claude Code hakkında Anthropic'e yapılandırılmış geri bildirim gönderme |
| [Projects](Tool-Projects.md) | Proje bilgi tabanı dokümanlarını yönetme |
| [ProposeGoal](Tool-ProposeGoal.md) | Oturum için doğrulanabilir bir tamamlama hedefi önerme |

## Çalışma Ağaçları

| Araç | Kullanım Amacı |
|------|----------------|
| [EnterWorktree](Tool-EnterWorktree.md) | Oturum için yalıtılmış git worktree oluşturma veya girme |
| [ExitWorktree](Tool-ExitWorktree.md) | Worktree oturumundan ayrılma, onu tutma veya silme |

## Planlama ve Bildirimler

| Araç | Kullanım Amacı |
|------|----------------|
| [CronCreate](Tool-CronCreate.md) | Cron ifadesinde istemi planlama (tekrarlayan veya tek seferlik) |
| [CronDelete](Tool-CronDelete.md) | Zamanlanmış cron işini iptal etme |
| [CronList](Tool-CronList.md) | Zamanlanmış cron işlerini listeleme |
| [ScheduleWakeup](Tool-ScheduleWakeup.md) | Sonraki uyandırmayı planlayarak /loop yinelemelerini kendi kendine taktiyle yapma |
| [PushNotification](Tool-PushNotification.md) | Kullanıcıya masaüstü/mobil bildirim gönderme |
| [RemoteTrigger](Tool-RemoteTrigger.md) | claude.ai uzak tetikleyici rutinlerini yönetme |
| [ReadNotifications](Tool-ReadNotifications.md) | Bekleyen oturum bildirimlerini okuma |

## Eklentiler

| Araç | Kullanım Amacı |
|------|----------------|
| [Skill](Tool-Skill.md) | Beceri (slash command) çalıştırma |

## MCP ve Uzantılar

| Araç | Kullanım Amacı |
|------|----------------|
| [ListMcpResources](Tool-ListMcpResources.md) | Bağlı MCP sunucularının sunduğu kaynakları listeleme |
| [ReadMcpResource](Tool-ReadMcpResource.md) | Tek bir MCP sunucusu kaynağını URI ile okuma |
| [ReadMcpResourceDir](Tool-ReadMcpResourceDir.md) | Dizin tarzı bir MCP kaynağını URI ile listeleme |
| [SearchMcpRegistry](Tool-SearchMcpRegistry.md) | MCP connector kayıt defterini anahtar kelimeyle arama |
| [SuggestConnectors](Tool-SuggestConnectors.md) | Kayıt defteri arama sonuçlarından connector ayrıntılarını çözme |
| [ListConnectors](Tool-ListConnectors.md) | Yüklü MCP connector'larını listeleme |
| [SuggestPluginInstall](Tool-SuggestPluginInstall.md) | Satır içi eklenti yükleme kartı oluşturma |
| [SuggestSkills](Tool-SuggestSkills.md) | Eklenebilir skill'lerden oluşan bir kart oluşturma |
| [ListPlugins](Tool-ListPlugins.md) | Etkin claude.ai eklentilerini listeleme |
| [ListSkills](Tool-ListSkills.md) | Etkin claude.ai skill'lerini listeleme |

## IDE Entegrasyonu

| Araç | Kullanım Amacı |
|------|----------------|
| [LSP](Tool-LSP.md) | Dil sunucusu sorguları (tanımlar, referanslar, semboller) |
