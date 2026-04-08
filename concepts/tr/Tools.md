# Claude Code Araç Listesi

Claude Code, Anthropic API'nin tool_use mekanizması aracılığıyla modele bir dizi yerleşik araç sunar. Her MainAgent isteğinin `tools` dizisi bu araçların tam JSON Schema tanımlarını içerir ve model yanıtında `tool_use` content block aracılığıyla bunları çağırır.

Aşağıda tüm araçların kategorize edilmiş dizini bulunmaktadır.

## Agent Sistemi

| Araç | Kullanım Amacı |
|------|----------------|
| [Task](Tool-Task.md) | Karmaşık çok adımlı görevleri işlemek için alt agent (SubAgent) başlatma |
| [TaskOutput](Tool-TaskOutput.md) | Arka plan görevinin çıktısını alma |
| [TaskStop](Tool-TaskStop.md) | Çalışan arka plan görevini durdurma |
| [TaskCreate](Tool-TaskCreate.md) | Yapılandırılmış görev listesi girdisi oluşturma |
| [TaskGet](Tool-TaskGet.md) | Görev detaylarını alma |
| [TaskUpdate](Tool-TaskUpdate.md) | Görev durumunu, bağımlılıkları vb. güncelleme |
| [TaskList](Tool-TaskList.md) | Tüm görevleri listeleme |

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

## Terminal

| Araç | Kullanım Amacı |
|------|----------------|
| [Bash](Tool-Bash.md) | Shell komutu çalıştırma |

## Web

| Araç | Kullanım Amacı |
|------|----------------|
| [WebFetch](Tool-WebFetch.md) | Web sayfası içeriğini çekme ve AI ile işleme |
| [WebSearch](Tool-WebSearch.md) | Arama motoru sorgusu |

## Planlama ve Etkileşim

| Araç | Kullanım Amacı |
|------|----------------|
| [EnterPlanMode](Tool-EnterPlanMode.md) | Planlama moduna girme, uygulama planı tasarlama |
| [ExitPlanMode](Tool-ExitPlanMode.md) | Planlama modundan çıkma ve planı kullanıcı onayına sunma |
| [AskUserQuestion](Tool-AskUserQuestion.md) | Açıklama veya karar almak için kullanıcıya soru sorma |

## Eklentiler

| Araç | Kullanım Amacı |
|------|----------------|
| [Skill](Tool-Skill.md) | Beceri (slash command) çalıştırma |

## IDE Entegrasyonu

| Araç | Kullanım Amacı |
|------|----------------|
| [getDiagnostics](Tool-getDiagnostics.md) | VS Code dil tanılama bilgilerini alma |
| [executeCode](Tool-executeCode.md) | Jupyter kernel'da kod çalıştırma |
