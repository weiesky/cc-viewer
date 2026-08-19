# AskUserQuestion

Sohbet arayüzü içinde kullanıcıya bir veya daha fazla yapılandırılmış çoktan seçmeli soru sunar, seçimlerini toplar ve asistana geri döndürür — serbest biçimli gidip gelmeye başvurmadan niyeti netleştirmek için kullanışlıdır.

## Ne Zaman Kullanılır

- Bir isteğin birden fazla makul yorumu vardır ve asistan devam etmeden önce kullanıcının birini seçmesini gerekir.
- Kullanıcının, serbest metin yanıtlarının hataya açık olacağı somut seçenekler (çerçeve, kitaplık, dosya yolu, strateji) arasından seçim yapması gerekir.
- Önizleme panelini kullanarak alternatifleri yan yana karşılaştırmak istersiniz.
- Birkaç ilgili karar, gidip gelmeyi azaltmak için tek bir istemde toplu hale getirilebilir.
- Bir plan veya araç çağrısı, kullanıcının henüz belirtmediği yapılandırmaya bağlıdır.

## Parametreler

- `questions` (dizi, zorunlu): Tek bir istemde birlikte gösterilen bir ila dört soru. Her soru nesnesi şunları içerir:
  - `question` (string, zorunlu): Soru işareti ile biten tam soru metni.
  - `header` (string, zorunlu): Sorunun üstünde bir etiket olarak görüntülenen kısa bir etiket (en fazla 12 karakter).
  - `options` (dizi, zorunlu): İki ila dört seçenek nesnesi. Her seçeneğin bir `label`'ı (1-5 kelime), `description`'ı ve opsiyonel bir `markdown` önizlemesi vardır.
  - `multiSelect` (boolean, zorunlu): `true` olduğunda kullanıcı birden fazla seçenek seçebilir.

## Örnekler

### Örnek 1: Tek bir çerçeve seçin

```
AskUserQuestion(questions=[{
  "header": "Test runner",
  "question": "Which test runner should I configure?",
  "multiSelect": false,
  "options": [
    {"label": "Vitest (Recommended)", "description": "Fast, Vite-native, Jest-compatible API"},
    {"label": "Jest",                  "description": "Mature, broadest plugin ecosystem"},
    {"label": "Node --test",           "description": "Zero dependencies, built in"}
  ]
}])
```

### Örnek 2: İki düzenin yan yana önizlemesi

```
AskUserQuestion(questions=[{
  "header": "Layout",
  "question": "Which dashboard layout do you prefer?",
  "multiSelect": false,
  "options": [
    {"label": "Sidebar",  "description": "Nav on the left", "markdown": "```\n+------+---------+\n| NAV  | CONTENT |\n+------+---------+\n```"},
    {"label": "Top bar",  "description": "Nav across top",  "markdown": "```\n+-----------------+\n|       NAV       |\n+-----------------+\n|     CONTENT     |\n+-----------------+\n```"}
  ]
}])
```

## Notlar

- Arayüz her soruya otomatik olarak bir "Diğer" serbest metin seçeneği ekler. Kendi "Diğer", "Hiçbiri" veya "Özel" girişinizi eklemeyin — dahili kaçış yolunu tekrarlar.
- Her çağrıyı bir ile dört soru, her soruyu da iki ile dört seçenek ile sınırlayın. Bu sınırları aşmak harness tarafından reddedilir.
- Belirli bir seçeneği öneriyorsanız, onu başa koyun ve etiketine "(Recommended)" ekleyin, böylece arayüz tercih edilen yolu vurgular.
- `markdown` alanı aracılığıyla önizlemeler yalnızca tekli seçim sorularında desteklenir. Bunları ASCII düzenler, kod parçacıkları veya yapılandırma diff'leri gibi görsel yapımlar için kullanın — etiket artı açıklamanın yettiği basit tercih sorularında değil.
- Bir sorudaki herhangi bir seçeneğin `markdown` değeri olduğunda, arayüz solda seçenek listesi ve sağda önizleme olacak şekilde yan yana düzene geçer.
- Plan onayı için "bu plan iyi görünüyor mu?" diye sormak amacıyla `AskUserQuestion` kullanmayın — bunun yerine tam olarak plan onayı için var olan `ExitPlanMode`'u çağırın. Plan modunda, soru metninde "plan"dan bahsetmekten de kaçının, çünkü plan `ExitPlanMode` çalışana kadar kullanıcıya görünmez.
- API anahtarları veya parolalar gibi hassas veya serbest biçimli girdi istemek için bu aracı kullanmayın. Bunun yerine sohbette sorun.
