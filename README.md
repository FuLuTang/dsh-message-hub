# dsh-message-hub

`dsh-message-hub` 是 DSH 的通信渠道注册与路由插件。当前设计把**渠道（channel）**作为统一目录：传输实现向 Hub 注册入站或出站实现，Agent 和 Web UI 只使用稳定的渠道 ID。Hub 不实现 QQ、Telegram、邮件或串口协议；这些由宿主插件或用户代码实现。

## 安装

在 DSH profile 中应使用官方插件安装器：

```sh
dsh plugin --profile web add github:FuLuTang/dsh-message-hub
```

它会在 profile 中安装包，并根据 `dsh.bundle.patch` 自动加入 bundle 层。安装后重启 DSH Web；新增或更新 client bundle 后还应强制刷新浏览器页面。

本地 checkout 调试可使用：

```sh
dsh plugin --profile web add link:/absolute/path/to/dsh-message-hub
```

不建议只执行 `npm install`/`pnpm add`：那只安装依赖，不保证插件进入 profile 的 bundle 列表。Node.js 要求 `>=22`。

## Channel registry

配置中的 `channels` 只是声明渠道元数据和初始开关；真正的运行时实现由受信任的 DSH 插件注册：

```js
await ctx.messageHub.registerIngress({
  id: 'telegram-in',
  name: 'Telegram 入站',
  description: '接收 Telegram 更新',
  template: '来自 {{sender}}：{{text}}',
  wakeup: true,
  setEnabled: async (enabled) => { /* 启停 transport */ },
})

await ctx.messageHub.registerEgress({
  id: 'telegram-out',
  name: 'Telegram 出站',
  description: '发送一条 Telegram 消息',
  schema: { type: 'object', required: ['chatId', 'text'] },
  setEnabled: async (enabled) => { /* 启停 transport */ },
  async invoke(args, { deliveryId, sessionId }) {
    return { success: true, message: 'sent' }
  },
})
```

渠道 ID 在全局注册表中唯一，不能同时注册为 ingress 和 egress；注册函数返回解除注册的 disposer。Egress 的 `schema` 用于校验 `send` 参数。实现可通过 `reportChannelStatus(id, { light, detail })` 更新状态灯，`light` 为 `black`、`yellow` 或 `green`。

每个渠道同时有：

- `desiredEnabled`：用户/配置要求的开关。调用 Web API 的 toggle 或 `setChannelEnabled()` 时更新，并调用已注册实现的 `setEnabled`。
- `light`：实现报告的运行状态灯；它不等同于开关。默认是 `black`。
- `detail`、`updatedAt`：状态说明和更新时间。

入站关闭时事件返回 `disabled`；未绑定时返回 `unbound`。出站关闭或未知时，`send` 失败，不会隐式选择其他渠道或会话。

配置示例：

```yaml
- id: dsh-message-hub
  config:
    storagePath: ''                 # 默认 $DSH_HOME/message-hub/state.json
    channels:
      - id: telegram-in
        label: Telegram 入站
        desiredEnabled: true
      - id: telegram-out
        label: Telegram 出站
        desiredEnabled: true
```

状态、绑定、入站去重和投递记录保存在 `storagePath`；同一路径只允许一个 Hub 进程使用。

## 入站绑定、cwd 替代会话和投递方式

通过 `bindIngress(channelId, sessionId, options)` 把 ingress 绑定到**精确的 DSH session**。绑定记录可包含：

- `template`：覆盖渠道模板；支持 `{{text}}` 以及 `event.values` 中的 `{{sender}}` 等简单键。
- `wakeup`：是否在两个上下文注入后唤醒 Agent，默认开启。
- `cwd`：替代会话工作目录。

`emitIngress(channelId, event)` 的流程是：检查开关和绑定、按 `eventId`/`id` 去重，然后解析绑定 session。若 session 已不可用且绑定包含 `cwd`，Hub 会用该 cwd 创建替代会话、更新绑定并继续投递；没有 cwd 或创建失败则保留失败结果，不会投递到别的会话。

成功的 ingress 路由向目标 Agent 注入两条消息：第一条说明这是来自该渠道的不可信外部上下文，第二条包含渲染后的 `<external-message>` 内容；若事件、绑定和渠道都允许唤醒，再追加一次 `followup`。事件默认字段包括 `eventId`/`id`、`values`、`text`、`sender`；不同 transport 可携带自己的元数据。入站 ledger 提供至少一次语义。

## 固定 Agent 工具

渠道注册表的工具集合是固定的：

| 工具 | 参数与用途 |
|---|---|
| `message_hub_list_channels` | 无参数；列出渠道 ID、方向、`desiredEnabled`、状态灯和详情。 |
| `message_hub_describe_channels` | 可选 `channelIds: string[]`；返回 egress 的说明和 `argumentsSchema`。不传时列出全部 egress。 |
| `message_hub_send` | `channelId` 与 `arguments`；校验 schema 后调用对应 egress。调用上下文的 sessionId 会传给实现。 |
| `message_hub_bind` / `message_hub_unbind` | 绑定或解除当前对话对指定旧式 adapter 的绑定。 |
| `message_hub_status` | 查看完整快照（渠道、绑定、adapter、endpoint、outlet、近期投递）。 |
| `message_hub_read_input` | 读取绑定 file-spool 的 `input/` 下 UTF-8 文件（最大 64 KiB）。 |

`message_hub_send` 不接受任意地址、联系人或会话参数；路由由已注册渠道实现决定。旧式 adapter 的绑定工具不会改变 channel registry 的精确 ingress 绑定规则。

## Web API 与客户端

启用 Web runtime 时，插件注册本地前缀 `/message-hub/api`。所有接口均为 JSON `POST`，且只接受受信任的 localhost/配置 trusted host 请求：

- `/message-hub/api/snapshot`：返回 Hub 快照。
- `/message-hub/api/toggle`：传入 `{ channelId, enabled }`，修改 `desiredEnabled`。
- `/message-hub/api/bind`：传入 `{ channelId, sessionId, cwd?, template?, wakeup? }`，绑定 ingress，并可设置替代 cwd。

`lib/client.js` 提供 Web 客户端 bundle：在 **设置 → 插件 →「消息渠道」** 标签展示接入/发出渠道面板，包含黑黄绿灯、开关与 ingress 绑定；同时保留会话标题栏的快捷浮层。两处面板复用同一组件，每 5 秒刷新快照。设置页的插件配置标签只枚举 settings namespace，本插件的独立渠道面板通过 `settings.plugins.tab` 扩展槽位注册。Headless profile 可以只使用 Host runtime 和 Agent tools，不注入客户端。

## Legacy file-spool adapter

`file-spool` 是仍然受支持的旧式 adapter，适合共享目录、Docker volume 或跨语言脚本；它不是 channel registry 的 ingress/egress 实现。配置仍使用 `spools` 和 `outlets`：

```yaml
spools:
  - id: volume-main
    root: /mnt/message-device
    enabled: true
    defaultSessionId: ''
    ackMode: delete       # delete | keep
    pollMs: 1000
    stablePolls: 1
    maxBytes: 262144
    payloadFile: input/message.json
    payloadFormat: json   # json | text | reference
    statusFile: status.json
outlets:
  - id: panel-notify
    spoolId: volume-main
    endpointId: panel
    enabled: true
    allowBoundSession: true
    allowedSessionIds: []
```

目录布局：

```text
root/
├── input/message.json       # 默认入站 payload
├── output/                  # Hub 原子写入 outbound JSON
│   ├── .tmp/
│   └── ack/                 # 外部程序写回 ack JSON
├── status.json              # 可选 endpoint 状态快照
└── .message-hub/processed/  # 已处理 trigger/ack
```

`root` 直接子级的普通文件（不含 `statusFile`）是 trigger；目录、符号链接以及 `input/`、`output/`、`.message-hub/` 后代不会触发。推荐先写临时文件再 `rename`，Hub 会等待稳定轮询。trigger JSON 可提供 `messageId`/`id`、`sender`、`text` 和 `meta`；非 JSON 文件不会被当作 Agent 指令，默认从 `input/message.json` 读取 payload。

成功排进精确绑定 session 后，`ackMode: delete` 将 trigger 移入 processed，`keep` 则保留原文件并依靠 ledger 去重。session 不可用或路由失败时不会确认。语义是至少一次，外部事件应提供稳定 ID 并让业务动作幂等。

出站文件写入 `output/<deliveryId>.json`，这只表示 Hub 已接受并进入 outbox；外部程序可在 `output/ack/<deliveryId>.ack.json` 写入 `{ deliveryId, state: "sent", externalId }` 或 failed 结果。`status.json` 可原子替换，例如：

```json
{
  "endpoints": {
    "panel": {
      "state": "available",
      "accepting": true,
      "detail": "device ready"
    }
  }
}
```

endpoint `state` 为 `available | busy | offline | unknown`，`accepting: false` 或 `offline` 会阻止新的 file-spool 出站投递。缺少有效 status 文件时 endpoint 为 unknown，但默认仍 accepting；它不会自动阻止发送。

## DSH 兼容性与包格式

当前没有官方约定的 `dshVersion` / `dsh.version` 字段；兼容性由 `dsh.bundle`、可选的 `dsh.client`、peer dependencies 以及实际 profile composition 决定。本包针对 Node.js `>=22`，并声明 Cordis、DSH LLM/Tools 和 Schemastery peer dependencies。实际安装时应让目标 profile 的 `dsh plugin` 解析这些 peer，而不是把某个 DSH 版本硬编码进业务配置。

包结构遵循官方 Bundle 约定：根入口、`cordis.patch.yml`、`exports["./client"]` 和 `dsh.client`。推荐使用官方安装器，而不是手工修改 profile：

```sh
dsh plugin --profile web add github:FuLuTang/dsh-message-hub
# 安装后重启 dsh web，并强制刷新浏览器
```

参考：[官方发布文档](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)、[dsh-cron 社区实现](https://github.com/XiaoWind/dsh-cron) 和 [DSH plugin market 约定](https://github.com/deepseek-ai/deepseek-harness/discussions/5867)。

## 开发

```sh
npm run check
npm test
npm run build
```
