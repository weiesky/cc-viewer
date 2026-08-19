import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { ULTRAPLAN_VARIANTS } from '../apps/web/src/utils/ultraplanTemplates.js';

// 钉死：concepts/<lang>/UltraPlan.md 内嵌的「代码专家 / 调研专家」模板块必须与源模板
// ULTRAPLAN_VARIANTS.codeExpert / .researchExpert 逐字节一致(因此 18 语言文档彼此也一致)。
// 防止某语言文档被单独改写 / 漏同步而静默漂移(如新增 tools-are-loaded 一句时)。
const CONCEPTS_DIR = fileURLToPath(new URL('../packages/content/concepts', import.meta.url));

// 每个 UltraPlan.md 内有两个 <textarea readonly><system-reminder> 块:codeExpert 在前、
// researchExpert 在后。用各自独有的前置句锚定,避免依赖出现顺序:
// codeExpert 的前置句是 "clarify user intent",researchExpert 是 "clarify the research scope"。
function extractBlock(md, anchor) {
  const blocks = [...md.matchAll(/<system-reminder>[\s\S]*?<\/system-reminder>/g)].map((m) => m[0]);
  return blocks.find((b) => b.includes(anchor)) || null;
}

function langDirsWithUltraPlan() {
  return readdirSync(CONCEPTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(CONCEPTS_DIR, d.name, 'UltraPlan.md')))
    .map((d) => d.name)
    .sort();
}

const VARIANTS = [
  { key: 'codeExpert', anchor: 'clarify user intent whenever the request is ambiguous' },
  { key: 'researchExpert', anchor: 'clarify the research scope' },
];

describe('UltraPlan.md template parity (all languages)', () => {
  const dirs = langDirsWithUltraPlan();

  it('covers the full set of language docs (>=18, matching shipped ultraAgents/*.json)', () => {
    assert.ok(dirs.length >= 18, `expected >=18 UltraPlan.md docs, found ${dirs.length}: ${dirs.join(',')}`);
  });

  for (const { key, anchor } of VARIANTS) {
    for (const lang of dirs) {
      it(`${lang}: ${key} block === ULTRAPLAN_VARIANTS.${key}`, () => {
        const md = readFileSync(join(CONCEPTS_DIR, lang, 'UltraPlan.md'), 'utf8');
        const block = extractBlock(md, anchor);
        assert.ok(block, `${lang}/UltraPlan.md: ${key} <system-reminder> block not found`);
        assert.equal(
          block,
          ULTRAPLAN_VARIANTS[key],
          `${lang}/UltraPlan.md ${key} block drifted from src/utils/ultraplanTemplates.js`
        );
      });
    }
  }
});
