# glmbar

> Claude Code 状态栏,专为 **GLM Coding Plan**(订阅制)优化。

## 关于 glmbar

glmbar 是一个独立的 [Claude Code](https://claude.com/claude-code) 状态栏,
专为 **GLM Coding Plan**(订阅制)打造。

GLM Coding Plan 按套餐额度计费(5h 窗口 / 月度),而非按量计费——
真正的约束是「额度还剩多少、什么时候刷新」,而不是「这次花了多少钱」。
glmbar 围绕这个核心关切组织状态栏:本次会话 token、套餐额度使用率、
上下文剩余、Git 状态,让「该不该收着用、何时 /clear」一目了然。

## 安装

```bash
npm install -g @luckvd/glmbar
```

然后在 `~/.claude/settings.json` 启用状态栏:

```json
{ "statusLine": { "type": "command", "command": "glmbar", "padding": 0 } }
```

两步即可用。可选的子 agent 计数、`--ascii` 降级等见[完整配置](#配置到-claude-code)。

## 状态栏示例

```
D: glmbar | G: main* +12 -3 ↑2 | 4.2K | agents: 2+1bg | M: GLM-5.2 | Q: 5h ▓▓░░░ 14%(3m) · 周 ▓░░░░ 6% | MCP ▓▓░░░ 233/1000 | 18.5K/200K ▓░░░░ (9.2%)
```

百分比字段都带一条 5 格迷你进度条(随阈值变色)。无内容的字段会自动隐藏:
非 git 仓库时省略 `G:`,无活跃 agent 时省略 `agents:`,无 transcript 时省略本次 token 与上下文。

## 字段

| 字段 | 说明 |
| --- | --- |
| `D:` 目录 | 当前 git 仓库根目录名(非仓库则取当前目录名) |
| `G:` Git | 分支(`*`=有改动) · 增删行数 · 与远程的 `↑`ahead / `↓`behind |
| 本次 token | 当前 transcript 内累计 token(input + output),非历史总额 |
| `agents:` | 活跃子 agent 数 + 后台 agent 数(`N+Mbg`),需配置 hook |
| `M:` 模型 | 当前模型显示名 |
| `Q:` 额度 | GLM 套餐使用率(5h 窗口 / 周等)+ 进度条 + 距下次刷新倒计时 |
| MCP | MCP 工具用量 `current/total` + 进度条 |
| 上下文 | 本次请求已用 token / 模型上下文窗口(%)+ 进度条 |

使用率/上下文占比按阈值变色:绿(<50%)→ 黄(<80%)→ 红(≥80%);进度条同步变色。

## 配色

[Catppuccin Mocha](https://catppuccin.com/),truecolor,深色终端下柔和可读。需终端支持 24-bit 颜色。

## 运行

```bash
cd /opt/projects/glmbar
npm test          # 跑一次示例输入
echo '{"model":{"display_name":"GLM-5.2"},"workspace":{"current_dir":"/opt/projects/glmbar"}}' | node src/glmbar.cjs
```

## 配置到 Claude Code

### 1. 安装

见上方[安装](#安装)。从源码用则 `cd` 到仓库后 `npm link`。

### 2. 启用状态栏

在 `~/.claude/settings.json` 配置:

```json
{ "statusLine": { "type": "command", "command": "glmbar", "padding": 0 } }
```

### 3.(可选)启用子 agent 计数

`agents:` 的「活跃子 agent」部分依赖一个 hook 维护标记文件。在 `~/.claude/settings.json`
的 `hooks` 中注册(`SubagentStart` 创建标记,`SubagentStop` 删除,`SessionStart` 清理):

```json
{
  "hooks": {
    "SessionStart":  [{ "hooks": [{ "type": "command", "command": "node /opt/projects/glmbar/src/hooks/subagent-track.cjs" }] }],
    "SubagentStart": [{ "hooks": [{ "type": "command", "command": "node /opt/projects/glmbar/src/hooks/subagent-track.cjs" }] }],
    "SubagentStop":  [{ "hooks": [{ "type": "command", "command": "node /opt/projects/glmbar/src/hooks/subagent-track.cjs" }] }]
  }
}
```

> 把路径换成实际的安装位置;或为 `subagent-track.cjs` 加一个 `bin` 入口后用短命令。

后台 agent 计数读取 `~/.claude/daemon/roster.json`,无需额外配置。

## 选项

- `glmbar --ascii`:进度条用 `#=---`(老终端降级)。
- 配置文件 `~/.claude/glmbar/config.json` 的 `barAscii: true` 可持久化 ASCII 模式。

## 额度数据来源

`Q:` / MCP 通过 GLM API(`/api/monitor/usage/quota/limit`)获取,读取环境变量或
`settings.json` 中的 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`。结果缓存 10 分钟
(`~/.claude/glmbar/quota-cache.json`),API 不可用时回退到缓存,不阻塞状态栏。

## 状态

✅ 已实现:目录 / Git / 本次 token / 活跃 agent / 模型 / 套餐额度 / MCP / 上下文 + 迷你进度条。

## License

MIT
