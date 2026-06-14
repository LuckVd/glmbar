#!/usr/bin/env node
/**
 * glmbar — StatusLine for Claude Code, optimized for GLM Coding Plan (订阅制).
 * 配色：Catppuccin Mocha（柔和浅色系，truecolor）。
 *
 * 字段：目录 | Git | 本次token | 活跃agent | 模型 | Token额度(5h/周+刷新倒计时) | MCP用量 | 上下文
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const https = require('node:https');
const { execSync } = require('node:child_process');

// ---------- 颜色（Catppuccin Mocha, truecolor）----------
const C = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  bold: '\x1b[1m',
  blue:     '\x1b[38;2;137;180;250m', // 目录  #89b4fa
  mauve:    '\x1b[38;2;203;166;247m', // git   #cba6f7
  lavender: '\x1b[38;2;180;190;254m', // token #b4befe
  sky:      '\x1b[38;2;137;220;235m', // 模型  #89dceb
  peach:    '\x1b[38;2;250;179;135m', // MCP/agents #fab387
  sapphire: '\x1b[38;2;116;199;236m', // 远程  #74c7ec
  green:    '\x1b[38;2;166;227;161m', // #a6e3a1
  yellow:   '\x1b[38;2;249;226;175m', // #f9e2af
  red:      '\x1b[38;2;243;139;168m', // #f38ba8
};

// ---------- 路径与常量 ----------
const HOME = os.homedir();
const SETTINGS_PATH = path.join(HOME, '.claude', 'settings.json');
const CACHE_DIR = path.join(HOME, '.claude', 'glmbar');
const QUOTA_CACHE = path.join(CACHE_DIR, 'quota-cache.json');
const ACTIVE_AGENT_DIR = path.join(CACHE_DIR, 'active');
const ROSTER_PATH = path.join(HOME, '.claude', 'daemon', 'roster.json');
const CONFIG_PATH = path.join(CACHE_DIR, 'config.json');
const QUOTA_TTL_MS = 10 * 60 * 1000;

const _settingsCache = { v: undefined };
const _transcriptCache = new Map();
const _gitCache = new Map();

// ---------- 基础工具 ----------
function readInput() {
  try {
    const s = fs.readFileSync(0, 'utf-8');
    return s.trim() ? JSON.parse(s) : {};
  }
  catch {
    return {};
  }
}

function loadSettings() {
  if (_settingsCache.v !== undefined) return _settingsCache.v;
  try {
    _settingsCache.v = JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf-8'));
  }
  catch {
    _settingsCache.v = {};
  }
  return _settingsCache.v;
}

function ensureDir(file) {
  try { fs.mkdirSync(path.dirname(file), { recursive: true }); }
  catch { /* ignore */ }
}

function baseModelId(id) {
  return String(id || '').replace(/\s*\[[^\]]*\]\s*$/, '').trim();
}

function fmtTok(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${n}`;
}

function fmtUsed(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}K`;
  return `${n}`;
}

function fmtMax(n) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(0)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return `${n}`;
}

function fmtRemaining(ms) {
  if (ms <= 0) return '0m';
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  if (h >= 24) {
    const d = Math.floor(h / 24);
    return `${d}d${h % 24}h`;
  }
  if (h > 0) return `${h}h${m}m`;
  return `${m}m`;
}

// ---------- 配置 / 命令行参数 ----------
function parseArgs(argv) {
  for (const a of argv) if (a === '--ascii') return true;
  return false;
}

function loadConfig() {
  try {
    return { barAscii: !!JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')).barAscii };
  }
  catch {
    return { barAscii: false };
  }
}

const ASCII = parseArgs(process.argv.slice(2)) || loadConfig().barAscii;

// ---------- 进度条 ----------
function fmtBar(pct) {
  const segments = 5;
  const filled = ASCII ? '#' : '▓';
  const empty = ASCII ? '-' : '░';
  const on = Math.max(0, Math.min(segments, Math.round(pct / 20)));
  const bar = filled.repeat(on) + empty.repeat(segments - on);
  const color = pct < 50 ? C.green : pct < 80 ? C.yellow : C.red;
  return `${color}${bar}${C.reset}`;
}

// ---------- Git ----------
function git(args, cwd) {
  try {
    return execSync(`git ${args}`, {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'ignore'],
      cwd,
    }).trim();
  }
  catch {
    return null;
  }
}

function isGitRepo(dir) {
  if (_gitCache.has(`repo:${dir}`)) return _gitCache.get(`repo:${dir}`);
  const r = git('rev-parse --is-inside-work-tree', dir) !== null;
  _gitCache.set(`repo:${dir}`, r);
  return r;
}

function gitRoot(dir) {
  if (_gitCache.has(`root:${dir}`)) return _gitCache.get(`root:${dir}`);
  const r = git('rev-parse --show-toplevel', dir) || dir;
  _gitCache.set(`root:${dir}`, r);
  return r;
}

function getGitInfo(dir) {
  if (!isGitRepo(dir)) return null;
  const branch = git('rev-parse --abbrev-ref HEAD', dir) || '?';
  const dirty = git('diff --quiet && git diff --cached --quiet', dir) === null;
  let added = 0, removed = 0;
  for (const a of ['diff --numstat', 'diff --cached --numstat']) {
    const out = git(a, dir);
    if (out) {
      for (const line of out.split('\n')) {
        const p = line.split('\t');
        if (p.length >= 2) { added += parseInt(p[0]) || 0; removed += parseInt(p[1]) || 0; }
      }
    }
  }
  const untracked = git('ls-files --others --exclude-standard', dir);
  if (untracked) added += untracked.split('\n').filter(Boolean).length;
  let ahead = 0, behind = 0;
  const remote = git('rev-list --left-right --count HEAD...@{u}', dir);
  if (remote) {
    const p = remote.split('\t');
    behind = parseInt(p[0]) || 0;
    ahead = parseInt(p[1]) || 0;
  }
  return { branch, dirty, added, removed, ahead, behind };
}

// ---------- Transcript 解析 ----------
function parseTranscript(tp) {
  if (!tp) return null;
  if (_transcriptCache.has(tp)) return _transcriptCache.get(tp);
  let result = null;
  try {
    if (fs.existsSync(tp)) {
      const lines = fs.readFileSync(tp, 'utf-8').split('\n').filter(l => l.trim());
      let lastInput = 0;
      let sessionTokens = 0;
      for (const line of lines) {
        try {
          const e = JSON.parse(line);
          const usage = e.message?.usage || e.usage;
          if (usage) {
            const input = (usage.input_tokens || 0)
              + (usage.cache_read_input_tokens || 0)
              + (usage.cache_creation_input_tokens || 0);
            const output = usage.output_tokens || 0;
            sessionTokens += input + output;
          }
          if (e.type === 'assistant' && e.message?.usage) {
            const u = e.message.usage;
            lastInput = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0);
          }
        }
        catch { /* skip */ }
      }
      result = { lastInput, sessionTokens };
    }
  }
  catch { /* ignore */ }
  _transcriptCache.set(tp, result);
  return result;
}

// ---------- GLM Quota ----------
function getGlmConfig() {
  const settings = loadSettings();
  const baseUrl = process.env.ANTHROPIC_BASE_URL || settings.env?.ANTHROPIC_BASE_URL;
  const token = process.env.ANTHROPIC_AUTH_TOKEN || settings.env?.ANTHROPIC_AUTH_TOKEN;
  if (!baseUrl || !token) return null;
  try {
    const u = new URL(baseUrl);
    return { domain: `${u.protocol}//${u.host}`, token };
  }
  catch {
    return null;
  }
}

function limitLabel(limit) {
  if (limit.type === 'TIME_LIMIT') return 'MCP';
  if (limit.type === 'TOKENS_LIMIT') {
    if (limit.unit === 3) return `${limit.number}h`;
    if (limit.unit === 6) return '周';
    if (limit.unit === 4 && limit.number === 7) return '周';
    if (limit.unit === 4) return `${limit.number}d`;
    if (limit.unit === 5) return `${limit.number}月`;
    return `${limit.number}?`;
  }
  return limit.type;
}

function readQuotaCache() {
  try {
    return JSON.parse(fs.readFileSync(QUOTA_CACHE, 'utf-8'));
  }
  catch {
    return null;
  }
}

function writeQuotaCache(data) {
  ensureDir(QUOTA_CACHE);
  try {
    fs.writeFileSync(QUOTA_CACHE, JSON.stringify({ ...data, fetchedAt: Date.now() }), 'utf-8');
  }
  catch { /* ignore */ }
}

function fetchQuota() {
  return new Promise((resolve) => {
    const cfg = getGlmConfig();
    if (!cfg) return resolve(null);
    const url = new URL(`${cfg.domain}/api/monitor/usage/quota/limit`);
    const req = https.request({
      hostname: url.hostname,
      port: 443,
      path: url.pathname,
      method: 'GET',
      headers: {
        Authorization: cfg.token,
        'Accept-Language': 'en-US,en',
        'Content-Type': 'application/json',
      },
      timeout: 4000,
    }, (res) => {
      let data = '';
      res.on('data', (c) => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function getQuota() {
  const cache = readQuotaCache();
  const now = Date.now();
  if (cache?.limits && (now - (cache.fetchedAt || 0)) < QUOTA_TTL_MS) {
    return cache.limits;
  }
  const resp = await fetchQuota();
  if (resp?.data?.limits) {
    writeQuotaCache({ limits: resp.data.limits, level: resp.data.level });
    return resp.data.limits;
  }
  return cache?.limits || null;
}

// ---------- 字段渲染器 ----------
function renderDir(input) {
  const cwd = input?.workspace?.current_dir || process.cwd();
  const name = path.basename(gitRoot(cwd));
  return `${C.blue}D: ${name}${C.reset}`;
}

function renderGit(input) {
  const cwd = input?.workspace?.current_dir || process.cwd();
  const g = getGitInfo(cwd);
  if (!g) return null;
  const branchColor = g.dirty ? C.red : C.mauve;
  let s = `${branchColor}G: ${g.branch}${g.dirty ? '*' : ''}${C.reset}`;
  if (g.added || g.removed) {
    s += ` ${C.green}+${g.added}${C.reset} ${C.red}-${g.removed}${C.reset}`;
  }
  if (g.ahead || g.behind) {
    const r = [];
    if (g.ahead) r.push(`↑${g.ahead}`);
    if (g.behind) r.push(`↓${g.behind}`);
    s += ` ${C.sapphire}${r.join(' ')}${C.reset}`;
  }
  return s;
}

function renderContext(input) {
  const parsed = parseTranscript(input?.transcript_path);
  if (!parsed) return null;
  const settings = loadSettings();
  const windows = settings.modelContextWindow || {};
  const id = baseModelId(input?.model?.id || '');
  const max = windows[id]
    || windows[Object.keys(windows).find((k) => k.toLowerCase() === id.toLowerCase())]
    || 200000;
  const used = parsed.lastInput;
  const pct = max ? (used / max) * 100 : 0;
  const color = pct < 50 ? C.green : pct < 80 ? C.yellow : C.red;
  return `${color}${fmtUsed(used)}/${fmtMax(max)} ${fmtBar(pct)} (${pct.toFixed(1)}%)${C.reset}`;
}

function renderSessionTokens(input) {
  const parsed = parseTranscript(input?.transcript_path);
  if (!parsed) return null;
  return `${C.lavender}${fmtTok(parsed.sessionTokens)}${C.reset}`;
}

// 活跃子 agent（hook 标记文件）+ 后台 agent（roster.json）
function renderAgents(input) {
  const sessionId = input?.session_id;
  let count = 0;
  if (sessionId) {
    try {
      count = fs.readdirSync(path.join(ACTIVE_AGENT_DIR, sessionId)).length;
    }
    catch { /* 无活跃子 agent */ }
  }
  let bg = 0;
  try {
    const roster = JSON.parse(fs.readFileSync(ROSTER_PATH, 'utf-8'));
    bg = Array.isArray(roster) ? roster.length : (roster && typeof roster === 'object' ? Object.keys(roster).length : 0);
  }
  catch { /* 无后台 agent */ }
  const total = count + bg;
  if (total === 0) return null;
  const label = bg > 0 ? `${count}+${bg}bg` : `${total}`;
  return `${C.bold}agents:${C.reset} ${C.peach}${label}${C.reset}`;
}

function renderModel(input) {
  const name = input?.model?.display_name || input?.model?.id || '';
  return name ? `${C.sky}M: ${name}${C.reset}` : null;
}

function renderTokenQuota(limits) {
  const tokens = (limits || []).filter((l) => l.type === 'TOKENS_LIMIT');
  if (!tokens.length) return null;
  const parts = tokens.map((l) => {
    const pct = l.percentage ?? 0;
    const color = pct < 50 ? C.green : pct < 80 ? C.yellow : C.red;
    let s = `${color}${limitLabel(l)} ${fmtBar(pct)} ${pct}%${C.reset}`;
    if (l.nextResetTime) {
      const rem = l.nextResetTime - Date.now();
      if (rem > 0) s += `${C.dim}(${fmtRemaining(rem)})${C.reset}`;
    }
    return s;
  });
  return `${C.bold}Q:${C.reset} ${parts.join(' · ')}`;
}

function renderMcp(limits) {
  const mcp = (limits || []).find((l) => l.type === 'TIME_LIMIT');
  if (!mcp) return null;
  const cur = mcp.currentValue ?? 0;
  const total = mcp.usage ?? 0;
  const pct = total > 0 ? (cur / total) * 100 : 0;
  return `${C.peach}MCP ${pct.toFixed(1)}%${C.reset}`;
}

// ---------- 主流程 ----------
async function main() {
  const input = readInput();
  const limits = await getQuota();
  const renderers = [
    () => renderDir(input),
    () => renderGit(input),
    () => renderSessionTokens(input),
    () => renderAgents(input),
    () => renderModel(input),
    () => renderTokenQuota(limits),
    () => renderMcp(limits),
    () => renderContext(input),
  ];
  const results = renderers.map((f) => { try { return f(); } catch { return null; } });
  const parts = results.filter((p) => p !== null && p !== undefined);
  process.stdout.write(parts.join(' | ') + '\n');
}

main();
