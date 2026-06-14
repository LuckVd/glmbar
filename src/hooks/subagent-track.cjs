#!/usr/bin/env node
/**
 * glmbar 子 agent 计数 hook（SubagentStart / SubagentStop / SessionStart）
 *
 * 用标记文件维护「当前活跃子 agent」：每个活跃子 agent 在
 *   ~/.claude/glmbar/active/<session_id>/<agent_id>
 * 留一个文件；statusLine 数该目录的文件数即得活跃计数。
 *
 * - SubagentStart：创建标记
 * - SubagentStop：删除标记
 * - SessionStart：清空本 session 的标记（防崩溃/强退导致计数漂移）
 *
 * 非阻塞：始终 exit 0。
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const ACTIVE_DIR = path.join(os.homedir(), '.claude', 'glmbar', 'active');

function readInput() {
  try {
    const s = fs.readFileSync(0, 'utf-8');
    return s.trim() ? JSON.parse(s) : {};
  }
  catch {
    return {};
  }
}

const input = readInput();
const event = input.hook_event_name;
const sessionId = input.session_id;

if (!sessionId || !event) {
  process.exit(0);
}

const sessionDir = path.join(ACTIVE_DIR, sessionId);

try {
  if (event === 'SubagentStart') {
    const agentId = input.agent_id || `agent-${Date.now()}`;
    fs.mkdirSync(sessionDir, { recursive: true });
    fs.writeFileSync(path.join(sessionDir, agentId), String(Date.now()));
  }
  else if (event === 'SubagentStop') {
    const agentId = input.agent_id;
    if (agentId) {
      try { fs.unlinkSync(path.join(sessionDir, agentId)); }
      catch { /* 已不存在 */ }
    }
  }
  else if (event === 'SessionStart') {
    // 新会话开始：清空本 session 的历史标记
    try { fs.rmSync(sessionDir, { recursive: true, force: true }); }
    catch { /* ignore */ }
  }
}
catch {
  // hook 失败不应影响 Claude Code
}

process.exit(0);
