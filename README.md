# Message Hub（v1）

一个面向 DSH 的**通信路由插件**。它不实现 Telegram、QQ、邮件或串口协议；这些由用户自己的程序实现。Hub 只统一四件事：

1. 以**至少一次**语义将外部事件投递到绑定的 DSH 会话；
2. 让 Agent 通过预配置的逻辑出口主动发送；
3. 记录去重、绑定、投递状态和出口可用性；
4. 给自定义 transport 留一个很小的 Adapter 接口。

v1 随附一个 `file-spool` transport，适合 Docker volume、共享目录、串口守护程序、shell 脚本或任何能读写文件的程序。

## 「目录服务」和「进程服务」是不是同一种东西？

从 Hub 的角度，**是同一个抽象层：Adapter**。它们都只能向 Hub 报告入站事件、出口状态，以及接受 Hub 的出站投递。

差别是传输边界：

- `file-spool` 用目录作为可靠边界：外部代码与 Hub 无需同进程；可跨容器、跨语言、重启后仍有文件可恢复。
- `process` adapter（本版只定义接口，未内置）用 stdin/stdout、socket 或 SDK 调用作为边界；更适合持续连接的 Telegram/QQ bot。
- `in-process` adapter（本版已开放注册接口）由另一个可信 DSH 插件直接注册；适合共享登录态、共享运行时的代码。

因此不用把“看目录的服务”另做一个与 Message Hub 平行的概念：它就是一个 transport 实现。目录协议需要单独规定，是因为**原子写入、触发、归档、去重和 ack**和长连接程序完全不同。

## v1 标准模型

```text
user code / QQ / Telegram / serial device
               │
         Adapter (file-spool first)
               │ emitInbound / reportEndpoint
               ▼
 Message Hub: binding + durable ledger + routing
               │ exact sessionId
               ▼
ctx.sessionController.resolveAgent(sessionId)
               │ createUserMessage + followup
               ▼
             DSH Agent
               │ message_hub_send(outletId, text)
               ▼
          adapter outbox / user code
```

Adapter **永远拿不到** `Agent`、`Session` 或任意会话选择权。Hub 根据 adapter id 的显式绑定决定唯一目标会话；找不到目标时保留 pending，不会退回到“当前活跃会话”。

## File-spool 目录协议

假设 `root=/mnt/message-device`：

```text
/mnt/message-device/
├── input/                         # 外部代码写入给 Agent 看的内容
│   └── message.json
├── output/                        # Hub 写给外部代码的投递文件
│   ├── mh-<uuid>.json
│   ├── .tmp/                      # Hub 内部临时发布目录
│   └── ack/                       # 外部代码写回 delivery ack
├── status.json                    # 外部代码维护的逻辑出口状态（可选）
├── anything-at-all.trigger        # 任意普通文件：入站触发器
└── .message-hub/processed/        # Hub 归档已消费 trigger/ack
```

### 入站触发

- `root` **直接子级**的任意普通文件，只要不是 `status.json`，就是 trigger。
- `input/`、`output/`、`.message-hub/` 及其后代永不触发。
- 目录和符号链接不触发；Hub 也拒绝符号链接逃逸。
- 推荐写入方在同一文件系统内：先写临时文件，再 `rename()` 成任意 trigger 文件名。Hub 会等待它至少经过一次稳定轮询后再读取。
- trigger 可以是空文件，也可以是 JSON。它本身的任意非 JSON 文本**不会**直接成为 Agent 指令，避免把碰巧被 touch 的文件内容当消息。

默认 payload 来自 `input/message.json`：

```json
{
  "text": "设备按钮被按下，请查看 input/ 中的最新文件。"
}
```

也可把文字直接放在 trigger JSON：

```json
{
  "messageId": "device-event-842",
  "sender": "panel-A",
  "text": "开始执行检测",
  "meta": { "button": "green" }
}
```

字段说明：

| 字段 | 含义 |
|---|---|
| `messageId` / `id` | 外部系统的稳定事件 ID；优先用于跨重启去重。没有时 Hub 用 trigger 的路径、stat 和内容 hash 生成 ID。 |
| `sender` | 外部来源的显示身份；仅作溯源，不能选择 DSH 会话。 |
| `text` | 交给 Agent 的文本。Hub 会标为 external input，而非系统指令。 |
| `meta` | 任意 JSON 元数据；v1 只审计/保留，不给模型拼接复杂算法。 |

若没有文字 payload，Hub 会向绑定会话发送一个“外部 trigger 已到达”的简短 notice；Agent 可调用 `message_hub_read_input(adapterId, path)` 安全读取该 adapter 的 `input/` 内 UTF-8 文件。

### Ack 与去重

Hub 只有在消息已成功排进**精确绑定会话**后才 ack：

- `ackMode: delete`（默认）：trigger 原子移动到 `.message-hub/processed/`。
- `ackMode: keep`：保留 trigger；Hub 的持久 ledger 阻止重复路由。
- session 未绑定、无法恢复或路由失败时，trigger 保留，之后重试。
- Hub 重启后依旧使用 ledger 去重；不会把失败消息改投递给别的会话。
- 语义是**至少一次**，不是跨崩溃的“恰好一次”：若进程恰好在 `followup()` 成功后、写入 routed 记录前崩溃，同一个 trigger 可能再次入队。因此外部代码应提供稳定 `messageId`，业务动作也应具备幂等性。

### 出站

Agent 调用 `message_hub_send` 后，Hub 原子发布：

```json
{
  "protocol": "message-hub/v1",
  "type": "outbound",
  "deliveryId": "mh-...",
  "idempotencyKey": "mh-...",
  "adapterId": "volume-main",
  "endpointId": "panel",
  "outletId": "panel-notify",
  "sessionId": "...",
  "createdAt": "2026-...Z",
  "payload": [{ "kind": "text", "text": "任务完成" }],
  "meta": {}
}
```

到 `output/<deliveryId>.json`。这只表示文件已进入 outbox（`accepted`），不表示你的用户程序已经把它发到 QQ/邮件/设备。

若用户程序想回报最终结果，在 `output/ack/<deliveryId>.ack.json` 写：

```json
{ "deliveryId": "mh-...", "state": "sent", "externalId": "qq-msg-7" }
```

或：

```json
{ "deliveryId": "mh-...", "state": "failed", "error": "serial device offline", "retryable": true }
```

Hub 将状态更新为 `sent` / `failed`；可用 `message_hub_status` 查看。

### 用户代码维护出口可用性

外部代码可随时原子替换 `status.json`：

```json
{
  "endpoints": {
    "panel": {
      "state": "available",
      "accepting": true,
      "detail": "serial ttyUSB0 connected",
      "updatedAt": "2026-09-12T01:00:00Z"
    },
    "qq-shell": {
      "state": "busy",
      "accepting": false,
      "detail": "reconnecting"
    }
  }
}
```

`state` 为 `available | busy | offline | unknown`；`accepting` 独立表达“当前是否接受新投递”。逻辑 endpoint 是用户定义的稳定名字，不等同于某条网络连接。

## 配置

安装后，在 profile patch 中覆盖 `dsh-message-hub`：

```yaml
- id: dsh-message-hub
  config:
    storagePath: '' # 默认 $DSH_HOME/message-hub/state.json
    spools:
      - id: volume-main
        root: /mnt/message-device
        enabled: true
        # 留空后，在目标对话中由 Agent 调用 message_hub_bind 绑定。
        defaultSessionId: ''
        ackMode: delete       # delete | keep
        pollMs: 1000
        stablePolls: 1
        maxBytes: 262144
        payloadFile: input/message.json
        payloadFormat: json  # json | text | reference
        statusFile: status.json
    outlets:
      - id: panel-notify
        spoolId: volume-main
        endpointId: panel
        enabled: true
        # true: 仅允许绑定到 volume-main 的会话使用该出口。
        allowBoundSession: true
        allowedSessionIds: [] # 可额外显式允许的会话
```

`defaultSessionId` 适用于运维静态配置；通常建议留空，然后在目标 Web 对话中让 Agent 使用 `message_hub_bind`。动态绑定会覆盖 static binding。

`storagePath` 是 Hub 的绑定、去重和投递 ledger，**不得位于任一 spool 的 `root` 内**，否则它自己会成为“未知 trigger”。同一个 `storagePath` 只允许一个 Hub 进程持有；v1 使用带 PID 的 lockfile 拒绝第二实例。

## Agent 工具

| 工具 | 用途 |
|---|---|
| `message_hub_bind(adapterId)` | 将调用所在的 DSH 对话绑定为该 adapter 的唯一入站目标。 |
| `message_hub_unbind(adapterId)` | 仅解除调用所在对话自己的绑定。 |
| `message_hub_send(outletId, text)` | 向预配置逻辑出口投递文字；没有任意 address 参数。 |
| `message_hub_read_input(adapterId, path)` | 读取被绑定 adapter 的 `input/` 内、最大 64 KiB UTF-8 文件。 |
| `message_hub_status()` | 查看绑定、adapter、端点状态和近期投递。 |

## 自定义 Adapter 接口（v1）

另一个**受信任** DSH Host 插件可调用 `ctx.messageHub.registerAdapter(adapter)`：

```js
const dispose = await ctx.messageHub.registerAdapter({
  id: 'my-telegram',
  type: 'process',
  async start(api) {
    // 一个真实入站事件；没有 sessionId，不能绕过 Hub binding。
    await api.emitInbound({
      messageId: 'tg-123',
      sender: 'owner',
      text: 'hello',
      meta: { chatId: '...' },
    })
    api.reportEndpoint({ endpointId: 'owner-telegram', state: 'available', accepting: true })
  },
  async send(delivery) {
    // delivery 有 deliveryId / idempotencyKey / endpointId / payload。
    // 只表示本 adapter 已接收时返回 accepted。
    return { state: 'accepted', externalId: 'provider-request-id' }
  },
  async stop() {}
})
```

Adapter 可调用：

- `api.emitInbound(event)`：Hub 负责会话路由和去重；event 不携带可控制会话的字段。
- `api.reportEndpoint(status)`：增量更新一个逻辑出口状态。
- `api.replaceEndpoints(statuses)`：替换该 adapter 的完整 endpoint 快照；适合文件状态表，已删除的 endpoint 不会残留。
- `api.deliveryUpdate(update)`：异步更新一个已存在的出站 delivery。
- `api.log(message)`：写入 Host 日志。

这是刻意小的接口。v1 不做复杂规则 DSL、自动联系人管理、附件复制、跨会话广播或“恰好一次外部投递”。将来 process/socket/webhook adapter 都可复用同样的数据模型。

## 开发与测试

```sh
npm run check
npm test
```

当前测试覆盖：稳定 trigger、payload 路由、归档、outbox 发布、status/ack，以及 input 路径逃逸防护。
