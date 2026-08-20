/**
 * Unit tests for src/utils/resizeCalc.js
 * Pure-function tests for drag-resize geometry — no DOM/React deps.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { calcResizedSize } from '../src/utils/resizeCalc.js';

describe('calcResizedSize', () => {
  const base = {
    startX: 100, startY: 100,
    startW: 400, startH: 200,
    dirX: -1, dirY: -1,  // 左上 handle:鼠标向左上(dx<0,dy<0)拉 → w/h 增大
    clamp: { minW: 320, maxW: 800, minH: 120, maxH: 600 },
  };

  it('左上 handle 向左上拖 → w/h 同时增大', () => {
    const r = calcResizedSize({ ...base, curX: 60, curY: 70 });
    // dx = (60-100)*-1 = 40 → w = 440;dy = (70-100)*-1 = 30 → h = 230
    assert.equal(r.w, 440);
    assert.equal(r.h, 230);
  });

  it('左上 handle 向右下拖 → w/h 同时减小', () => {
    const r = calcResizedSize({ ...base, curX: 150, curY: 140 });
    // dx = (150-100)*-1 = -50 → w = 350;dy = (140-100)*-1 = -40 → h = 160
    assert.equal(r.w, 350);
    assert.equal(r.h, 160);
  });

  it('w 触发 minW clamp', () => {
    const r = calcResizedSize({ ...base, curX: 500, curY: 100 });
    // dx = -400 → w = 0 → clamp 到 minW=320
    assert.equal(r.w, 320);
    assert.equal(r.h, 200);
  });

  it('w 触发 maxW clamp', () => {
    const r = calcResizedSize({ ...base, curX: -500, curY: 100 });
    // dx = 600 → w = 1000 → clamp 到 maxW=800
    assert.equal(r.w, 800);
    assert.equal(r.h, 200);
  });

  it('h 触发 minH clamp', () => {
    const r = calcResizedSize({ ...base, curX: 100, curY: 500 });
    // dy = -400 → h = -200 → clamp 到 minH=120
    assert.equal(r.h, 120);
    assert.equal(r.w, 400);
  });

  it('h 触发 maxH clamp', () => {
    const r = calcResizedSize({ ...base, curX: 100, curY: -500 });
    // dy = 600 → h = 800 → clamp 到 maxH=600
    assert.equal(r.h, 600);
    assert.equal(r.w, 400);
  });

  it('右下 handle (dirX=+1, dirY=+1) 向右下拖 → w/h 增大', () => {
    const r = calcResizedSize({
      ...base, dirX: 1, dirY: 1,
      curX: 150, curY: 130,
    });
    // dx = (150-100)*1 = 50 → w = 450;dy = (130-100)*1 = 30 → h = 230
    assert.equal(r.w, 450);
    assert.equal(r.h, 230);
  });

  it('clamp 缺失字段时不夹', () => {
    const r = calcResizedSize({
      ...base, clamp: {}, curX: -1000, curY: -1000,
    });
    // 没 clamp → w/h 可任意大
    assert.equal(r.w, 1500);
    assert.equal(r.h, 1300);
  });

  it('结果整数化(Math.round)', () => {
    const r = calcResizedSize({
      ...base, startW: 400.4, startH: 200.7, curX: 99.5, curY: 99.5,
    });
    // dx = -(99.5-100) = 0.5 → w = 400.9 → 401
    // dy = -(99.5-100) = 0.5 → h = 201.2 → 201
    assert.equal(r.w, 401);
    assert.equal(r.h, 201);
  });
});
