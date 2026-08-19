import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { ALL_TOOL_NAMES } from '../apps/web/src/utils/toolCatalog.js';

// 守卫:31 个有激活门槛的工具概念文档(18 语言)必须含本语言 Activation 章节,
// 恰好一次、位于 When to Use 与 Parameters 之间;其余常开工具任何语言不得出现该章节。
// 防止:门槛工具漏写/错位激活说明、常开工具误加章节、语言间章节漂移。

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONCEPTS_DIR = join(ROOT, 'packages', 'app', 'concepts');

// 18 语言 Activation 章节标题(设计冻结清单)。
const ACTIVATION_HEADINGS = {
  en: '## Activation', zh: '## 启用方式', 'zh-TW': '## 啟用方式', ja: '## 有効化',
  ko: '## 활성화', de: '## Aktivierung', es: '## Activación', fr: '## Activation',
  it: '## Attivazione', da: '## Aktivering', no: '## Aktivering', pl: '## Aktywacja',
  ru: '## Активация', ar: '## التفعيل', th: '## การเปิดใช้งาน', tr: '## Etkinleştirme',
  uk: '## Активація', 'pt-BR': '## Ativação',
};

// 各语言 When to Use / Parameters 标题(取自各 locale 既有译文;数组 = 仓库中存在的既有变体,
// 例如 es 的 LSP 文档用 "Cuándo usarlo"、da/de/no/pl/tr 个别文档有带/不带变音符的历史拼写)。
const WHEN_HEADINGS = {
  ar: ['## متى يُستخدم'],
  da: ['## Hvornår skal den bruges', '## Hvornår skal det bruges'],
  de: ['## Wann verwenden', '## Wann zu verwenden'],
  en: ['## When to Use'],
  es: ['## Cuándo usar', '## Cuándo usarlo'],
  fr: ["## Quand l'utiliser"],
  it: ['## Quando usare'],
  ja: ['## 使用タイミング'],
  ko: ['## 사용 시점'],
  no: ['## Når skal den brukes', '## Når skal det brukes', '## Nar skal den brukes'],
  pl: ['## Kiedy używać', '## Kiedy uzywac'],
  'pt-BR': ['## Quando usar'],
  ru: ['## Когда использовать'],
  th: ['## เมื่อใดควรใช้'],
  tr: ['## Ne Zaman Kullanılır', '## Ne Zaman Kullanilir'],
  uk: ['## Коли використовувати'],
  zh: ['## 何时使用'],
  'zh-TW': ['## 使用時機', '## 何時使用'],
};
const PARAMS_HEADINGS = {
  ar: ['## المعاملات'], da: ['## Parametre'], de: ['## Parameter'], en: ['## Parameters'],
  es: ['## Parámetros'], fr: ['## Paramètres'], it: ['## Parametri'], ja: ['## パラメータ'],
  ko: ['## 매개변수'], no: ['## Parametere'], pl: ['## Parametry'], 'pt-BR': ['## Parâmetros'],
  ru: ['## Параметры'], th: ['## พารามิเตอร์'], tr: ['## Parametreler'], uk: ['## Параметри'],
  zh: ['## 参数'], 'zh-TW': ['## 參數'],
};

// 返回 variants 中在 text 里最早出现的下标(找不到返回 -1)。
function firstIndexOf(text, variants) {
  let best = -1;
  for (const v of variants) {
    const i = text.indexOf(v);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

// 31 个有门槛的工具(设计冻结清单);其余目录工具不得出现 Activation 章节。
const ACTIVATION_TARGETS = [
  'REPL',
  'TaskCreate', 'TaskGet', 'TaskUpdate', 'TaskList', 'TodoWrite',
  'ListAgents', 'SendMessage', 'SendFile', 'SendUserFile', 'SendUserMessage', 'EndConversation',
  'Monitor', 'PushNotification', 'RemoteTrigger', 'ProposeGoal',
  'Artifact', 'WebSearch', 'ToolSearch', 'LSP',
  'SearchMcpRegistry', 'SuggestConnectors', 'ListConnectors',
  'SuggestPluginInstall', 'SuggestSkills', 'ListPlugins', 'ListSkills',
  'ReadMcpResource', 'ReadMcpResourceDir', 'ListMcpResources',
  'ScheduleWakeup',
];

function langDirs() {
  return readdirSync(CONCEPTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

describe('activation sections in gated tool docs', () => {
  for (const lang of langDirs()) {
    const act = ACTIVATION_HEADINGS[lang];
    const when = WHEN_HEADINGS[lang];
    const params = PARAMS_HEADINGS[lang];
    assert.ok(act && when && params, `missing heading map entry for locale ${lang}`);

    for (const tool of ACTIVATION_TARGETS) {
      it(`${lang}: ${tool} has the Activation section between When to Use and Parameters`, () => {
        const file = join(CONCEPTS_DIR, lang, `Tool-${tool}.md`);
        assert.ok(existsSync(file), `missing ${file}`);
        const text = readFileSync(file, 'utf-8');
        const count = text.split(act).length - 1;
        assert.equal(count, 1, `${tool} ${lang}: expected exactly 1 "${act}", found ${count}`);
        const iAct = text.indexOf(act);
        const iWhen = firstIndexOf(text, when);
        const iParams = firstIndexOf(text, params);
        assert.ok(iWhen >= 0, `${tool} ${lang}: missing When-to-Use heading (variants: ${when.join(' / ')})`);
        assert.ok(iParams >= 0, `${tool} ${lang}: missing Parameters heading (variants: ${params.join(' / ')})`);
        assert.ok(iWhen < iAct && iAct < iParams,
          `${tool} ${lang}: Activation must sit between When-to-Use and Parameters (got iWhen=${iWhen} iAct=${iAct} iParams=${iParams})`);
      });
    }
  }

  it('always-on tools have no Activation section in any locale', () => {
    const targets = new Set(ACTIVATION_TARGETS);
    const alwaysOn = ALL_TOOL_NAMES.filter((n) => !targets.has(n));
    const offenders = [];
    for (const lang of langDirs()) {
      const act = ACTIVATION_HEADINGS[lang];
      for (const tool of alwaysOn) {
        const file = join(CONCEPTS_DIR, lang, `Tool-${tool}.md`);
        if (!existsSync(file)) continue;
        const text = readFileSync(file, 'utf-8');
        if (text.includes(act)) offenders.push(`${lang}/${tool}`);
      }
    }
    assert.equal(offenders.length, 0, `unexpected Activation sections in always-on tools: ${offenders.join(', ')}`);
  });
});
