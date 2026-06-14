# glmbar

> Claude Code 状态栏,专为 **GLM Coding Plan**(订阅制)优化。

## 为什么另起炉灶

通用状态栏(如 ccbar)多按「按量计费」假设设计 —— `token × 单价 = 花费`。
但 GLM Coding Plan 是**订阅制**:套餐额度(5h 窗口 / 月度)才是真正的约束,
按量估算的「花费」对订阅用户意义有限,甚至误导。

glmbar 围绕订阅制用户的真实关切重新设计显示内容。

## 状态栏示例

```
D: glmbar | G: main* +12 -3 ↑2 | 4.2K | agents: 2+1bg | M: GLM-5.2 | Q: 5h ▓▓░░░ 14%(3m) · 周 ▓░░░░ 6% | MCP ▓▓░░░ 233/1000 | 18.5K/200K ▓░░░░ (9.2%)
```

百分比字段都带一条 5 格迷你进度条(随阈值变色)。偶尔,状态栏文字还会变成
小角色的舞台——吃豆人吃掉一排字符再吐回来、毛毛虫爬过去、人在间隙里扔飞盘
让狗去追(见[动画](#动画))。

无内容的字段会自动隐藏:非 git 仓库时省略 `G:`,无活跃 agent 时省略 `agents:`,
无 transcript 时省略本次 token 与上下文。

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

## 动画

状态栏偶尔(平均每 ~36 秒一次)会触发一段几秒的微型动画,把文字当舞台:

- **吃豆人** `ᗧ`:从左吃到右,字符被吃成空格,再从右吐回来恢复
- **毛毛虫** `●●●●`:一串体节从右端爬到左端,覆盖所经字符
- **飞盘狗**:人在 `|` 间隙扔飞盘,狗跑出去追回来
- **幽灵** `ᗣ` / **火箭** `➤`:单个符号划过整行

动画用基于时间槽的**确定性调度**——同一时间槽内每次刷新看到的帧一致(不闪烁),
只有帧随真实时间推进;跨槽才换动画或换"播不播"。需要约 1fps 的定时刷新驱动,
所以**必须配置 `refreshInterval: 1`**(见下),否则只在对话发生时才动。

> 动画期间部分文字会被短暂遮蔽,几秒后自动恢复。动画符号优先用等宽方块字符;
> 飞盘狗用了 emoji,在某些终端可能有轻微对齐漂移。不喜欢可随时[关掉](#开关)。

## 配色

[Catppuccin Mocha](https://catppuccin.com/),truecolor,深色终端下柔和可读。需终端支持 24-bit 颜色。

## 运行

```bash
cd /opt/projects/glmbar
npm test          # 跑一次示例输入
echo '{"model":{"display_name":"GLM-5.2"},"workspace":{"current_dir":"/opt/projects/glmbar"}}' | node src/glmbar.cjs
```

调试动画(绕过时间槽,循环播放某动画):

```bash
echo '{"model":{"display_name":"GLM-5.2"},"workspace":{"current_dir":"/opt/projects/glmbar"}}' | node src/glmbar.cjs --anim-test pacman
# 可选: pacman / caterpillar / frisbee / ghost / rocket
```

## 配置到 Claude Code

### 1. 安装

```bash
cd /opt/projects/glmbar
npm link          # 让 glmbar 全局可用
```

### 2. 启用状态栏

在 `~/.claude/settings.json` 配置(`refreshInterval: 1` 让动画能动起来):

```json
{ "statusLine": { "type": "command", "command": "glmbar", "padding": 0, "refreshInterval": 1 } }
```

> 关掉动画后,`refreshInterval` 非必需但留着也无害(每秒 spawn 一次开销 < 50ms)。

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

## 开关

**动画默认开启**。关掉有两种方式:

1. 配置文件 `~/.claude/glmbar/config.json`:
   ```json
   { "animations": false }
   ```
   (字段缺失或文件不存在 → 默认 `true`)
2. 命令行 flag 临时覆盖(改 `settings.json` 的 command,或测试时用):
   - `glmbar --no-anim` 本次关闭
   - `glmbar --anim` 本次强制开

优先级:flag > 配置文件 > 默认(true)。

其他 flag:`glmbar --ascii` 让进度条用 `#=---`(老终端降级)。

## 额度数据来源

`Q:` / MCP 通过 GLM API(`/api/monitor/usage/quota/limit`)获取,读取环境变量或
`settings.json` 中的 `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`。结果缓存 10 分钟
(`~/.claude/glmbar/quota-cache.json`),API 不可用时回退到缓存,不阻塞状态栏。

## 状态

✅ 已实现:目录 / Git / 本次 token / 活跃 agent / 模型 / 套餐额度 / MCP / 上下文 +
迷你进度条 + 状态栏微型动画(可开关)。

## License

MIT
