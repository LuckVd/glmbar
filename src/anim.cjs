#!/usr/bin/env node
/**
 * glmbar 动画模块 —— 把状态栏文字当舞台,小角色偶尔在上面演戏。
 *
 * 约束(statusLine 机制):
 * - request-response 短命进程,无法持久化状态。
 * - 刷新约 1–3fps(refreshInterval:1),动画须低帧大动作。
 *
 * 设计:
 * - 时间槽确定性调度:同一槽内 hash(slotId) 决策固定(不闪烁),
 *   只有 frame 随真实时间推进;跨槽才换动画。
 * - 严禁 Math.random()(跨刷新不一致会闪烁),用 splitmix32。
 * - 操作可见字符前先 stripAnsi,颜色码原样保留。
 */

'use strict';

// ---------- 确定性 hash(splitmix32):32位整数 → [0,1) ----------
function hash(n) {
  n |= 0;
  n = (n + 0x9e3779b9) | 0;
  let t = Math.imul(n ^ (n >>> 16), 0x21f0aaad);
  t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
  return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
}

// ---------- ANSI 剥离 + 可见索引映射 ----------
// baseLine 含 \x1b[...m 颜色码。返回 { plain, map }:
//   plain = 去色码的可见字符串;map[visibleIdx] = 源字符串索引。
// 渲染时按 visibleIdx 操作,用 map 回写源数组,颜色码不被破坏。
function stripAnsi(s) {
  const plain = [];
  const map = [];
  let i = 0;
  while (i < s.length) {
    if (s.charCodeAt(i) === 0x1b && s[i + 1] === '[') {
      let j = i + 2;
      while (j < s.length && s[j] !== 'm') j++;
      i = j + 1;
    }
    else {
      plain.push(s[i]);
      map.push(i);
      i++;
    }
  }
  return { plain: plain.join(''), map };
}

// ---------- 时间槽调度 ----------
const SLOT_MS = 18_000;        // 每 18s 一槽
const PLAY_WINDOW_MS = 4_000;  // 槽内前 4s 为播放窗口

function currentAnim(now, opts) {
  opts = opts || {};
  // force: 调试用(--anim-test),循环播放指定动画,绕过时间槽
  if (opts.force) {
    const a = ANIMS.find((x) => x.name === opts.force);
    if (!a) return null;
    const total = Math.floor(a.duration / a.frameMs);
    const frame = Math.floor((now % a.duration) / a.frameMs) % total;
    return { anim: a, frame };
  }

  const slotId = Math.floor(now / SLOT_MS);
  const intoSlot = now - slotId * SLOT_MS;
  if (intoSlot >= PLAY_WINDOW_MS) return null;
  if (hash(slotId) >= 0.5) return null;  // ~50% 槽播放 → 平均每 36s 一次

  const anim = ANIMS[Math.floor(hash(slotId ^ 0x5bf036d5) * ANIMS.length)];
  const total = Math.floor(anim.duration / anim.frameMs);
  const frame = Math.floor(intoSlot / anim.frameMs);
  if (frame >= total) return null;
  return { anim, frame };
}

// ---------- 帧渲染器 ----------

// 吃豆人:遮罩法。eatenLen 先增(吃 2 帧)后减(吐 2 帧),每帧从原文重生成。
function renderPacmanFrame(frame, baseLine) {
  const { plain, map } = stripAnsi(baseLine);
  const N = plain.length;
  if (N < 6) return baseLine;
  const out = baseLine.split('');
  const half = 2;
  let eatenLen;
  let mouth;
  if (frame < half) {                       // 吃阶段
    eatenLen = Math.round((N * (frame + 1)) / (half + 1));
    mouth = frame % 2 === 0 ? 'ᗧ' : '●';
  }
  else {                                    // 吐阶段
    const f = frame - half;
    eatenLen = Math.round((N * (half - f)) / (half + 1));
    mouth = f % 2 === 0 ? 'ᗤ' : '●';
  }
  for (let k = 0; k < N; k++) {
    const si = map[k];
    if (si == null) continue;
    if (k < eatenLen) out[si] = ' ';
    else if (k === eatenLen) out[si] = mouth;
  }
  return out.join('');
}

// 毛毛虫:体节 ●●●● 从右端滑入,头部按比例从 N-1 平移到 -segs。
function renderCaterpillarFrame(frame, baseLine) {
  const { plain, map } = stripAnsi(baseLine);
  const N = plain.length;
  if (N < 6) return baseLine;
  const out = baseLine.split('');
  const segs = 4;
  const totalFrames = 6;
  const head = Math.round((N - 1) + (-segs - (N - 1)) * (frame / (totalFrames - 1)));
  for (let s = 0; s < segs; s++) {
    const pos = head - s;
    if (pos >= 0 && pos < N) {
      const si = map[pos];
      if (si != null) out[si] = '●';
    }
  }
  return out.join('');
}

// 飞盘狗:在最后一个 ' | ' 间隙后搭微舞台,6 个关键姿势(emoji,接受宽度漂移)。
function renderFrisbeeFrame(frame, baseLine) {
  const { plain, map } = stripAnsi(baseLine);
  const gapIdx = plain.lastIndexOf(' | ');
  if (gapIdx < 0) return baseLine;
  const stageStart = gapIdx + 3;
  if (plain.length - stageStart < 8) return baseLine;  // 舞台太窄不演
  const poses = [
    '🧍🥏      🐕',
    '🧍  🥏    🐕',
    '🧍    🥏  🐕',
    '🧍      🥏🐕',
    '🧍   🐕🥏  ',
    '🐕🥏🧍     ',
  ];
  const pose = poses[Math.min(frame, poses.length - 1)];
  const cutAt = map[stageStart];
  if (cutAt == null) return baseLine;
  return baseLine.slice(0, cutAt) + pose;
}

// 通用:单字符巡游(幽灵 / 火箭)。sym 覆盖所经位置,dir 决定方向。
function makeCruise(sym, dir) {
  return function (frame, baseLine) {
    const { plain, map } = stripAnsi(baseLine);
    const N = plain.length;
    if (N < 6) return baseLine;
    const out = baseLine.split('');
    const totalFrames = 6;
    const t = frame / (totalFrames - 1);
    const pos = dir === 'lr' ? Math.round((N - 1) * t) : Math.round((N - 1) * (1 - t));
    const si = map[pos];
    if (si != null) out[si] = sym;
    return out.join('');
  };
}

// ---------- 动画注册表 ----------
const ANIMS = [
  { name: 'pacman',      frameMs: 800, duration: 3200, renderFrame: renderPacmanFrame },
  { name: 'caterpillar', frameMs: 600, duration: 3600, renderFrame: renderCaterpillarFrame },
  { name: 'frisbee',     frameMs: 700, duration: 4200, renderFrame: renderFrisbeeFrame },
  { name: 'ghost',       frameMs: 700, duration: 4200, renderFrame: makeCruise('ᗣ', 'rl') },
  { name: 'rocket',      frameMs: 700, duration: 4200, renderFrame: makeCruise('➤', 'lr') },
];

// ---------- 分发器 ----------
function renderAnimFrame(anim, frame, baseLine) {
  if (!baseLine) return baseLine;
  try {
    return anim.renderFrame(frame, baseLine);
  }
  catch {
    return baseLine;  // 动画失败不得影响状态栏
  }
}

module.exports = { currentAnim, renderAnimFrame };
