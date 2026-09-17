/**
 * _applyV3Delta 去重顺序契约测试。
 *
 * AppBase 是 React class（依赖 antd / CSS modules），无法在 node:test 直接 import；
 * 按 test/cold-ingest-gate.test.js 先例镜像其行为，但 buildEntry 用真实的
 * createV3Assembler 替身（可注入抛错）。
 *
 * 镜像锚点（改动 _applyV3Delta 语义时必须同步本文件）：
 *   - key = `${sessionId}\x00${seq}\x00${inProgress?1:0}`
 *   - 已见过 → 直接 return
 *   - **buildEntry 成功后才 add(k)**：build 抛错不污染 seen 集，
 *     服务端 correction 重发可重试（此前先 add 后 build，抛错则该 seq 永久丢失）
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/** 镜像 AppBase._applyV3Delta（buildEntry 可注入） */
function mkHost(buildEntry) {
  return {
    _v3SeenLive: null,
    ingested: [],
    rows: [],
    _ingestV2Rows(rows) { this.rows.push(...rows); },
    _ingestLiveEntry(entry) { this.ingested.push(entry); },
    _v3Assembler() { return { buildEntry }; },
    applyV3Delta(row) {
      this._ingestV2Rows([row]);
      const k = `${row.sessionId}\x00${row.seq}\x00${row.inProgress ? 1 : 0}`;
      if (this._v3SeenLive?.has(k)) return;
      let entry;
      try {
        entry = this._v3Assembler().buildEntry(row);
      } catch {
        return;
      }
      (this._v3SeenLive ??= new Set()).add(k);
      this._ingestLiveEntry(entry);
    },
  };
}

describe('_applyV3Delta seen-set ordering (镜像 AppBase)', () => {
  it('buildEntry 抛错不标记 seen：重发可重试并成功注入', () => {
    let calls = 0;
    const h = mkHost(() => {
      calls++;
      if (calls === 1) throw new Error('torn row');
      return { id: 'entry-1' };
    });
    const row = { sessionId: 's1', seq: 7, inProgress: false };

    h.applyV3Delta(row);
    assert.equal(h.ingested.length, 0, '首次构建失败不注入');
    assert.equal(h._v3SeenLive, null, '失败不污染 seen 集');

    h.applyV3Delta(row); // 服务端 correction 重发
    assert.equal(h.ingested.length, 1, '重试成功注入');
    assert.deepEqual(h.ingested[0], { id: 'entry-1' });
  });

  it('构建成功后标记 seen：同 key 重发被去重', () => {
    const h = mkHost(() => ({ id: 'e' }));
    const row = { sessionId: 's1', seq: 3, inProgress: true };
    h.applyV3Delta(row);
    h.applyV3Delta(row);
    assert.equal(h.ingested.length, 1, '同 (sessionId,seq,inProgress) 只注入一次');
  });

  it('行 upsert 在 seen 检查之前无条件执行（correction 重发即使不重建 entry 也须落库）', () => {
    const h = mkHost(() => ({ id: 'e' }));
    const row = { sessionId: 's1', seq: 5, inProgress: false };
    h.applyV3Delta(row);
    h.applyV3Delta(row); // 同 key 重发：不重建 entry，但 ROW 替换语义要求仍过 upsert
    assert.equal(h.rows.length, 2, '每次 delta 都先 _ingestV2Rows，无论 seen 命中与否');
  });

  it('inProgress 翻转（placeholder→completed）视为新 key，允许重建', () => {
    const h = mkHost(() => ({ id: 'e' }));
    h.applyV3Delta({ sessionId: 's1', seq: 3, inProgress: true });
    h.applyV3Delta({ sessionId: 's1', seq: 3, inProgress: false });
    assert.equal(h.ingested.length, 2, 'placeholder→completed 两次都注入');
  });
});
