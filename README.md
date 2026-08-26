# dsh-model-picker[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

为 dsh web GUI 的模型选择器提供增强面板：**左侧提供商栏 + 右侧模型列表**，两侧独立滚动，支持跨提供商搜索——替代默认的单列长滚动分组列表。

An enhanced model picker for the dsh web GUI: a **left provider column with the model list on the right**, both independently scrollable, plus a cross-provider search box — replacing the default single-column grouped list.

## 功能 Features

- 左栏按提供商纵向排列（独立滚动，带模型计数徽章），右栏显示当前提供商的模型（独立滚动）——几十个提供商、上百个模型也能顺畅浏览
- 默认选中当前模型所属的提供商；点击任意提供商即切换
- 顶部搜索框跨提供商匹配（提供商名 / 模型名 / 描述，大小写不敏感），结果带提供商名，点选即切换
- 推理档位独立为模型按钮右侧的第二个按钮（当前模型支持时显示，含「提供方默认」），点击弹出窄菜单切换；加载 / 错误 / 重试 / 空态保留
- 打开面板毫秒级渲染：模型列表由全局目录供给（`llm.models` RPC，免会话、免 agent resume，所有会话共享一份），localStorage 持久化快照让刷新页面后的首次打开也瞬时出列表；插件随 web 启动即预热（`dsh.client.immediately`），之后靠 `llm/adapters-updated` / `settings/document-updated` 推送失效刷新，不再依赖定时 TTL；后台刷新永远不显示加载行，仅真正无任何缓存时的首次加载显示整屏加载态
- 当前模型 / 阻塞状态仍与内置 `/model` 弹层共享同一份每会话目录（`ctx.modelDirectories`），任何一处切换另一处立即同步；composer 的模型阻塞逻辑不受影响
- 界面跟随系统深浅色主题；文案中英文自动切换

A left column lists providers (independently scrollable, with model-count badges); the right column shows the active provider's models (independently scrollable). The search box matches across providers (provider name / model name / description, case-insensitive). Reasoning effort gets its own trigger button immediately right of the model trigger (shown when the current model supports it, including a "provider default" entry), opening a compact effort menu; loading/error/retry/empty states are preserved. The model list is served by a global catalog (the session-free `llm.models` RPC — no per-session duplication, no agent resume) with a localStorage-persisted snapshot, so the panel renders in milliseconds even on the first open after a page reload; the bundle loads at startup (`dsh.client.immediately`) to warm the cache, and `llm/adapters-updated` / `settings/document-updated` push events keep it fresh — no polling TTL. Background revalidation never shows a loading row; only the very first load with no cache at all shows a full loading state. The current selection and composer block state still ride the same per-session directory as the built-in `/model` popup (`ctx.modelDirectories`), so a switch made in either surface is reflected in the other. Dark/light theme aware; UI text follows the system language.

## 安装 Install

方式一：从 **npm registry** 安装（推荐，无 git 克隆 / prepare 脚本步骤）：

```sh
dsh plugin --profile web add dsh-model-picker
```

方式二：从 GitHub 源码安装：

```sh
dsh plugin --profile web add github:Sanqi-normal/dsh-model-picker
```

安装后**重启 web 服务**生效：

```sh
pnpm dsh web
```

GitHub 源安装会执行包内 prepare 脚本，如被 pnpm 拦截，把提示的包名加入 profile 的 `pnpm-workspace.yaml` 的 `allowBuilds` 后重试。

## 使用 Usage

重启后打开任意会话，点击 composer 工具行右端的模型选择器（发送按钮左侧）：

- 左栏点击提供商切换右侧模型列表；右栏点击模型即选中（✓ 标记当前模型）
- 顶部输入关键词，右栏切换为跨提供商搜索结果；点击左侧任意提供商即退出搜索并切换
- 当前模型支持推理档位时，模型按钮右侧出现档位按钮（含「提供方默认」），点击弹出窄菜单切换

After the web server restarts, open any session and click the model selector at the right end of the composer tool row:

- Click a provider in the left column to switch the right list; click a model to select it (✓ marks the current one)
- Type in the search box to see cross-provider results; clicking any provider exits search
- When the current model supports reasoning efforts, an effort pill (including "provider default") appears right of the model trigger; click it to open a compact effort menu

## 工作原理 How it works

持久化 bundle（`package.json` 的 `dsh.bundle.patch` → `cordis.patch.yml`），由 `dsh plugin add` 的 reconcile 自动加入 profile 的 `dsh.profile.bundles` 层：

- **Client 半**（`lib/client.js`）：通过 `exports["./client"]` + `dsh.client`（`immediately: true`，随 web 启动加载以预热）声明被 web 前端加载，注册到 composer 的 `conversation.input.model` 座位（priority -1，顶替默认实现）。模型列表走 root 级全局目录：直接调 `llm.models` RPC（host 侧与 `session.models` 共用同一个 `buildModelCatalog`，但不需要 sessionId、不触发 agent resume、所有会话共享一份），快照持久化到 localStorage，靠 `llm/adapters-updated` / `settings/document-updated` 推送失效（10 分钟 TTL 仅作兜底）；当前选择 / routable / select 仍复用内置 `ui-model-selection` 的 `ctx.modelDirectories` 每会话目录（`session.models` / `session.selectModel`），不引入第二份选择状态；host 过旧无 `llm.models` 时回退到每会话目录路径
- **Host 半**（`lib/host.js`）：空实现——Node 侧 loader 以包根入口导入它（浏览器专属的 `lib/client.js` 必须只在 `./client` 导出下被 web 端加载），无网络请求、无持久化状态

## 要求与限制 Requirements and limitations

- 需要 web profile 已装载 `@deepseek-ai/dsh-client-ui-model-selection`（web-app 内置，通常已存在）；缺失时选择器座位保持空置（回退安全）
- 动态安装后需重启 web 服务生效（与所有 profile bundle 一致）
- 仅影响 composer 的模型选择座位；`/model` 弹层保持原样，但与面板共享同一份当前选择

## License

MIT
