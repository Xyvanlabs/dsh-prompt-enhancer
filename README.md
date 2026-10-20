# dsh-prompt-enhancer

给 [DeepSeek Harness](https://github.com/deepseek-ai)（下称 DSH）的会话输入框加一颗**提示词增强**按钮：写下大概的意思，点一下，草稿变成一条清晰、具体、可直接发送的提示词；不满意就取消，改坏了就还原。

按钮位于输入框右下角、发送按钮左侧、模型选择器左边——和 WorkBuddy 5.8.3 里那颗星芒按钮同一个位置、同一套三态交互。

![按钮在输入框右下角](docs/button-in-composer.png)

## 它解决什么问题

人在输入框里写下的第一版，往往「意图清楚但表述含糊」：缺上下文、混着多个目标、藏着自己没说清的前提。直接发给模型，得到的是猜出来的答案。这个插件把「把话说清楚」这一步交给模型自己：读你的草稿，静默补全那些没写出来但显然需要的东西，然后只回一份改写后的提示词。

它不改写你的意图，也不替你回答。原文是提问就还是提问，是命令就还是命令，是中文就还是中文。

## 四个例子（实测）

下面四条不是手写的理想答案，是对着运行中的插件实跑的：provider `aliyun`、model `deepseek-v4.1-flash-1017`，单次 1~2 秒。同一条草稿再跑一次，措辞会变——**语言、约束是否保留、大致长度**是稳定的，具体句式不是。

先交代一句：长度是提示词里的软约束（约 800 字、通常不超过原稿两倍），代码层不做截断，所以下面第 2、4 条的实测结果比原稿长出两倍多，这属于正常波动。

### 1. 模糊的交付物 → 可执行的同语言提示词

**场景**：周五下午想先把周报起个头，心里只有个大概。

**输入**（38 字）：

```
帮我把这周的工作整理成周报，主要是给领导看，别太啰嗦，能看出我做了哪些事就行
```

**实测输出**（64 字）：

```
请根据我这周的工作内容整理一份周报，给领导看。要求简洁不啰嗦，重点突出我做了哪些事，按事项分条列出，每条写清做了什么、结果如何。
```

看点在：把「别太啰嗦」「能看出我做了哪些事」这种感受翻成可执行的要求（分条、每条含动作与结果），而没有凭空塞进「本周完成 / 下周计划」这类它自己编的结构。

### 2. 英文草稿 → 英文提示词，不夹带标签

**场景**：给上游项目提单前，先把自己那句抱怨理成一份能提交的 issue 描述。

**输入**（119 字）：

```
the cli crashes when the config file has a trailing comma, i want to report it upstream but im not sure what to include
```

**实测输出**（339 字）：

```
The CLI crashes when the config file has a trailing comma. I want to report this upstream but I'm not sure what to include. Help me reproduce the crash and put together a bug report: a minimal config file that triggers it, the exact command and full error output, and the environment details (CLI version, OS) that a maintainer would need.
```

看点在：语言严格跟随草稿（没有 `Language: English` 这类前缀）；把「不知道要写什么」展开成一份清单——最小复现配置、命令与完整错误、环境信息。代价是长度涨到 2.8 倍，这也是它有时会「过头」的一面：短草稿想更紧凑，再点一次让它重写通常就收得住。

### 3. 啰嗦的长草稿 → 保留全部约束的压缩

**场景**：需求写了大半屏，重复的句子比信息还多。

**输入**（119 字）：

```
我想要一个导出功能，就是可以把数据导出来，导出的格式最好是 CSV，另外最好也能支持 Excel，主要是 CSV 就行，因为我们同事都用 Excel 打开 CSV，还有就是导出的时候能不能选时间范围，时间范围这个挺重要的，别的就没什么了。
```

**实测输出**（93 字）：

```
请实现一个数据导出功能，要求如下：主要格式为 CSV，同时支持导出 Excel；导出时用户可以选择时间范围，该功能很重要，需作为必选项；其他细节无特殊要求。请说明实现方案并给出代码改动。
```

看点在：四件事（CSV、Excel、时间范围、Excel 能直接打开）一件不少，重复句被删掉；它还会补一句「说明实现方案并给出代码改动」——草稿没明说，但这是「加个功能」隐含的交付要求。

### 4. 已经说清楚的草稿 → 只补「列什么」

**场景**：目标、文件、行号范围都写明白了，只想让表述更准一点。

**输入**（39 字）：

```
看看 lib/client.js 120-160 行有没有空指针，有的话列出来
```

**实测输出**（118 字）：

```
查看 lib/client.js 第 120-160 行，检查是否存在空指针（null/undefined 解引用）风险，例如未判空就访问属性或调用方法。如有，请逐条列出：行号、相关代码片段、触发空指针的条件。若没有，请明确说明未发现。
```

看点在：不扩写成教程、不追加无关要求，只把「列出来」具体化成行号 + 代码片段 + 触发条件；文件与行号范围原样保留。长度约 3 倍，属于同一类波动。

## 三态，同一个位置

按钮永远不会并排出现两个——三种身份共用同一颗按钮。

| 状态 | 图标 | 悬停提示 | 点击 |
| --- | --- | --- | --- |
| 空闲 | 星芒 | 增强提示词 | 发起增强 |
| 增强中 | 转圈 | 增强中…（点击取消） | 中止本次请求 |
| 已增强 | 还原箭头 | 还原原文 | 把原草稿写回输入框 |
| 出错 | 红色星芒 | 增强失败：<原因> | 重新增强 |

细节：

- **结果写回后进入「已增强」态**，此时再点就是还原。只要你手动改了输入框内容，备份立刻作废、回到空闲态——「还原」永远不会覆盖你手打的东西。
- **错误只出现在 tooltip 里**，6 秒后自动消失，不弹窗、不阻塞输入。
- **请求期间你改了草稿**，回来的结果会被丢弃并提示「输入内容已变化，增强结果已丢弃」，不会把旧草稿的成品盖到新内容上。
- **输入框正在发送/排队时按钮置灰**，判据是输入框相位：`plain`（普通编辑）与 `claimed`（挂着命令 chip）可点，`adjudicating` / `submitting` / `frozen` 一律禁用。
- **草稿为空时按钮仍然占位**（半透明），点击只提示「先输入内容再增强」。这是刻意与 WorkBuddy 原版不同的一处：原版此时整颗按钮不渲染，这里保留占位让功能能被发现。

## 同样的按钮，不做多余的事

上面说的是顺路走通的情况。真正拿它天天用，下面这些边界才是保命的部分——提示文案都是插件里写死的原文：

| 你的操作 | 实际发生什么 |
| --- | --- |
| 草稿为空时点星芒 | 提示「先输入内容再增强」，**不发请求**，不产生模型调用 |
| 输入超过 12000 字 | 提示「内容过长，请控制在 12000 字以内」，草稿原样不动 |
| 增强中再点一下 | 请求中止，草稿保持原样，提示「已取消增强」，按钮回到星芒 |
| 增强中改了草稿 | 结果回来直接丢弃，提示「输入内容已变化，增强结果已丢弃」 |
| 增强完成后手改一个字 | 还原箭头消失（备份作废），**不会**把你改过的内容盖回去 |
| 正在发送消息时 | 按钮置灰，提示「正在发送消息，暂时无法改写输入框」 |
| 没有可用的默认模型 | 提示「增强失败：没有可用的默认模型，请先在设置里选择模型」 |

## 与 WorkBuddy 原版的对齐

行为规格来自对 WorkBuddy 5.8.3 同名功能的分析，交互差异只有一条：空草稿时按钮仍占位（原版整颗不渲染）；其余差别都在实现层——这里没有 WorkBuddy 的会话/渠道概念。

## 安装

### 前置条件

| 依赖 | 要求 |
| --- | --- |
| DSH | `>=0.1.1-rc.2 <0.3.0`（写在 `package.json` 的 `dsh.engines.dsh`） |
| Node.js | `^22.19.0 \|\| >=24.0.0` |
| 宿主服务 | `webServer`（路由）、`llm`（模型调用）、`agentDefaultModel`（取默认模型）——都由 DSH 自带 |

插件是「bundle」形态：`package.json` 声明 `dsh.bundle.patch` 指向 `cordis.patch.yml`，后者往 loader 配置里插一行。客户端半边是独立的 `lib/client.js`，由 `dsh-client-modules` 通过 `window.__ModuleLoader__` 加载。

### 方式一：GUI 插件管理器（推荐）

打开 DSH 的插件管理器，选择「安装本地目录 / 安装 bundle」，指向本仓库的绝对路径，装进你要用的 profile（通常是 `desktop`）。安装时会以 link 方式登记，源码改动即时可见（客户端 bundle 需重新加载，见下文）。

### 方式二：通过 `plugin_manager` 工具

在 DSH 会话里让 agent 执行：

```
plugin_manager { action: 'install_bundle', target: '<本仓库绝对路径>' }
```

成功后返回 `application: 'restart-required'`（新 bundle 的加载器行在启动时解析）。

### 方式三：命令行

```powershell
dsh plugin add link:<本仓库绝对路径> --profile desktop
```

`dsh` 不在 PATH 里时，用前两种方式即可——它们走的是同一套 `plugin_manager` 逻辑。

### 装完必须重启 DSH

bundle 的加载器行只在启动时解析。重启后按下面三步确认：

1. `cordis_inspect_query` 查 `conversation.input.right` 插槽，`occupants` 里应出现 `id: prompt-enhancer`；
2. 页面里输入框右下角出现星芒按钮；
3. `curl http://127.0.0.1:<端口>/prompt-enhancer/status` 返回 `configured: true` 以及当前的 `provider` / `model`。

## 使用

1. 在输入框里写下你的草稿（一句话也行）。
2. 点星芒。按钮转圈，输入框内容不变——改写期间你仍可以看、可以改。
3. 结果回来，草稿整段被替换成增强版提示词，按钮变成还原箭头。此时接着编辑或直接发送都行。
4. 想退回原稿：点还原箭头，或者手动改动输入框（备份会自动作废）。

用的是**当前会话的默认模型**（`agentDefaultModel.currentSelection()`），插件本身不带模型选择器。

## 工作原理

```
点按钮
  → 客户端读 useInput(s => s.draft)，去零宽空格、trim，空则只提示
  → POST /prompt-enhancer/enhance { text }
      → 主机校验：只接受回环地址、方法、长度 ≤ 12000 字
      → agentDefaultModel.currentSelection() 拿 provider / model
      → llm.stream({ system, messages:[user{draft}], temperature:0.5, maxTokens:1400 })
      → 累加 text-delta；finish 的 reason 为 error/aborted 时抛出
  → 客户端清洗结果 → inputActions.setDraft(text) 整段写回，同时存一份原稿用于还原
```

**结果清洗流水线**（主机侧 `cleanResult`）：去零宽空格 → trim → 去掉整段 ``` 代码围栏 → 去掉「增强后的提示词：」这类标签行与语言标签行 → 去掉首尾成对引号（`" ' “ ” ‘ ’ 「 」`）→ trim。清洗后为空按失败处理，绝不清空编辑器。

**安全边界**

- 路由只接受回环地址（`127.0.0.1` / `::1` / `::ffff:127.0.0.1`），其余一律 403。
- 入参上限 12000 字符，超了回 413。
- 模型调用 120 秒超时；浏览器断开连接时 `AbortController` 立刻中止上游请求。
- 客户端不接触模型、凭证和 provider 配置——它只会调这一个本机路由。

**提示词**（`lib/index.js` 里的 `SYSTEM_PROMPT` / `USER_TEMPLATE`）三条要求：语言跟草稿一致（中文进中文出，混写进混写出，禁止输出语言标签）、长度约 800 字符且不超过原稿两倍、只输出改写文本（无前言、无围栏、无引号）。这三条是写给模型的，代码层只做格式清洗不做截断——实测偶尔会超出两倍（见上文例子 2、4）。其余是静默分析步骤与十条改写原则。

## 目录结构

```
package.json          bundle 清单：dsh.bundle.patch / dsh.client.platform / exports
cordis.patch.yml      loader 补丁：insert 一行 prompt-enhancer
lib/index.js          主机半边：注册 /prompt-enhancer 路由，调 llm.stream
lib/client.js         客户端半边：__ModuleLoader__ bundle，注册 conversation.input.right 按钮
locale/zh.json        插件卡片的标题与描述（中文）
locale/en.json        同上（英文）
icon.svg              插件图标
docs/                 文档配图
test/                 两个离线冒烟测试（host / client）
```

## 开发与调试

### 离线测试（不需要跑起 DSH）

```bash
node test/host.mjs     # 主机半边：假 ctx / 假 llm / 假 HTTP 对象
node test/client.mjs   # 客户端半边：伪造 __ModuleLoader__ 与 stub React
```

- `test/host.mjs` —— 捕获 `webServer.register` 拿到路由，用假 `llm.stream`、假 `agentDefaultModel` 跑 `apply()`，断言：路由注册、回环鉴权、入参长度、请求结构与模型参数、结果清洗、上游错误映射、未知端点 404。
- `test/client.mjs` —— 伪造 `window.__ModuleLoader__`、stub React 与槽位上下文，断言：bundle 形态与导出、插槽注册参数、组件的三态切换、取消与还原、失败不写回。

两者都是纯 Node 脚本（`node:test` 之外的零依赖写法），退出码非 0 即失败。

### 改完客户端代码怎么生效（不用重启整个 DSH）

`dsh-client-modules` 启动时把 `lib/client.js` 读进内存、按 `rev`（mtime/ctime/size）发 immutable 缓存，所以只改文件 + 刷新页面拿不到新代码。让宿主重读一次：

```
plugin_manager { action: 'set_plugin', target: 'include:prompt-enhancer', enabled: false }
plugin_manager { action: 'set_plugin', target: 'include:prompt-enhancer', enabled: true }
```

行被移除再挂上时客户端 bundle 会被重新 `readFileSync`，`rev` 变化、URL 跟着变，页面按一次 `Ctrl+R` 即可。改主机半边（`lib/index.js`）按普通插件热重载处理。

### 常见问题

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 按钮不出现 | 插槽没拿到 `useInput` / `inputActions`，或加载器行没生效 | 查 `conversation.input.right` 的 `occupants`；确认已重启 |
| 按钮一直是灰的 | 输入框在 `submitting` / `frozen` 相位 | 等发送完成 |
| 增强返回 503 | 没有可用默认模型，或 `llm` 服务没起来 | 去设置里选一个模型 |
| 增强返回 502 | 上游报错或结果被清洗成空 | tooltip 里有上游原文 |
| 返回 403 | 不是回环地址访问 | 只支持本机使用 |

## 已知限制

- 依赖宿主 `conversation.input.right` 插槽提供 `useInput` / `inputActions`；缺一样组件就不渲染（不会炸工具栏）。
- 一次只认一颗按钮、一个会话一份状态；切换会话会中止进行中的请求。
- 固定用会话默认模型，暂不支持单独选模型；也不做流式回显（一次返回完整改写）。
- 每次点按钮都是一次独立的模型调用（system 约 3.4k 字符 + 你的草稿），失败同样可能计费。
- 长度只是提示词层面的软约束，实测短草稿有时会涨到原稿的 2~3 倍；想要更短就再点一次让它重写，或直接手动删。

## 卸载

从 profile 里移除本 bundle（`plugin_manager { action: 'remove_bundle', target: 'dsh-prompt-enhancer' }`，或直接在插件管理器里卸载），然后重启 DSH。插件不落任何持久化状态，卸载后不留残留。

## 许可证

MIT，见 [LICENSE](LICENSE)。