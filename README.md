# dsh-model-picker[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

为 dsh web GUI 的模型选择器提供增强面板：**左侧提供商栏 + 右侧模型列表**，两侧独立滚动，支持跨提供商搜索——替代默认的单列长滚动分组列表。

An enhanced model picker for the dsh web GUI: a **left provider column with the model list on the right**, both independently scrollable, plus a cross-provider search box — replacing the default single-column grouped list.

## 功能 Features

- 左栏按提供商纵向排列（独立滚动，带模型计数徽章），右栏显示当前提供商的模型（独立滚动）——几十个提供商、上百个模型也能顺畅浏览
- 默认选中当前模型所属的提供商；点击任意提供商即切换
- 顶部搜索框跨提供商匹配（提供商名 / 模型名 / 描述，大小写不敏感），结果带提供商名，点选即切换
- 推理档位独立为模型按钮右侧的第二个按钮（当前模型支持时显示；模型未声明默认档位时，菜单含「提供方默认」项），点击弹出窄菜单切换；加载 / 错误 / 重试 / 空态保留
- 打开面板毫秒级渲染：模型列表直接渲染 host 共享的每会话目录（root 级目录随 web 启动即由 host 自预热，所有会话共享同一份目录数据）；目录由 host 侧在 `llm/adapters-updated` / `settings/document-updated` / `credentials/reference-updated` / `connection/reset` 事件上自动刷新，面板经 store 订阅实时收到最新快照；后台刷新永远不显示加载行，仅真正无数据时的首次加载显示整屏加载态
- 当前模型 / 阻塞状态与内置 `/model` 弹层共享同一份每会话目录（`ctx.modelDirectories`），任何一处切换另一处立即同步；composer 的模型阻塞逻辑不受影响
- 选择持久化由 host 负责：每次选择都写入 durable 的 `model/selection` 会话事件，web 重启后由 host 的 model-selection projection 恢复（改完档位没发消息也不会回退），插件不再本地留存任何选择副本
- 界面跟随 dsh 主题（深浅色由 dsh 主题的 CSS 变量决定）；文案中英文自动切换

A left column lists providers (independently scrollable, with model-count badges); the right column shows the active provider's models (independently scrollable). The search box matches across providers (provider name / model name / description, case-insensitive). Reasoning effort gets its own trigger button immediately right of the model trigger (shown when the current model supports it; the menu includes a "provider default" entry only when the model declares no default effort), opening a compact effort menu; loading/error/retry/empty states are preserved. The panel renders straight from the host-shared per-session model directory (`ctx.modelDirectories`): the host pre-warms the root-level directory at web startup and refreshes it on `llm/adapters-updated`, `settings/document-updated`, `credentials/reference-updated`, and `connection/reset`, so the panel paints in milliseconds and every session reads the same directory data through the store subscription. Background revalidation never shows a loading row; only a first load with no data at all shows a full loading state. The current selection and composer block state ride that same directory as the built-in `/model` popup, so a switch made in either surface is reflected in the other. Selection persistence is owned by the host: every pick is written as a durable `model/selection` session event and restored after a web restart by the host's model-selection projection (a pick made after the session's last request survives too), so the plugin keeps no local selection copy. The UI follows the dsh theme (dark/light via the theme's CSS variables); text follows the browser language.

## 安装 Install

方式一：从 **npm registry** 安装（推荐，无 git 克隆 / prepare 脚本步骤）：

```sh
dsh plugin --profile web add dsh-model-picker
```

方式二：从 GitHub 源码安装：

```sh
dsh plugin --profile web add github:ping1999/dsh-model-picker
```

安装后**重启 web 服务**生效：

```sh
pnpm dsh web
```

## 使用 Usage

重启后打开任意会话，点击 composer 工具行右端的模型选择器（发送按钮左侧）：

- 左栏点击提供商切换右侧模型列表；右栏点击模型即选中（✓ 标记当前模型）。点选模型或档位后面板立即关闭，trigger 标签与 ✓ 即时迁移；切换失败时回滚原选择并重开面板显示错误
- 顶部输入关键词，右栏切换为跨提供商搜索结果；点击左侧任意提供商即退出搜索并切换
- 当前模型支持推理档位时，模型按钮右侧出现档位按钮（未声明默认档位时菜单含「提供方默认」项），点击弹出窄菜单切换

After the web server restarts, open any session and click the model selector at the right end of the composer tool row:

- Click a provider in the left column to switch the right list; click a model to select it (✓ marks the current one). Picking a model or effort closes the panel instantly while the trigger label and ✓ move right away; a failed switch rolls back to the previous selection and reopens the panel with an error
- Type in the search box to see cross-provider results; clicking any provider exits search
- When the current model supports reasoning efforts, an effort pill appears right of the model trigger (the menu includes "provider default" only when the model declares no default effort); click it to open a compact effort menu

## 工作原理 How it works

持久化 bundle（`package.json` 的 `dsh.bundle.patch` → `cordis.patch.yml`），由 `dsh plugin add` 的 reconcile 自动加入 profile 的 `dsh.profile.bundles` 层：

- **Client 半**（`lib/client.js`）：通过 `exports["./client"]` + `dsh.client`（`immediately: true`，随 web 启动加载）声明被 web 前端加载，注册到 composer 的 `conversation.input.model` 座位（priority -1，顶替默认实现）。面板是内置 `ui-model-selection` 的 `ctx.modelDirectories` 每会话目录（`session.models` / `session.selectModel`）的纯视图：列表数据（groups/failures/status/error）与当前选择（current/routable/select）全部来自这唯一一份共享目录，不引入第二份状态；目录的预热与失效刷新（适配器 / 设置 / 凭据变更、连接重置）全部由 host 侧完成，选择跨重启恢复也由 host 的 durable `model/selection` 事件 + projection 负责
- **Host 半**（`lib/host.js`）：空实现——Node 侧 loader 以包根入口导入它（浏览器专属的 `lib/client.js` 必须只在 `./client` 导出下被 web 端加载），无网络请求、无持久化状态

## 要求与限制 Requirements and limitations

- 需要 **dsh ≥ v0.1.3-alpha.1**（1.3.x 起插件只保留共享目录单一路径，不再兼容旧版 host；0.1.3-alpha.1 目前仅以 GitHub tag 发布，npm 尚未发布）
- 需要 web profile 已装载 `@deepseek-ai/dsh-client-ui-model-selection`（web-app 内置，通常已存在）；缺失时选择器座位保持空置（回退安全）
- 动态安装后需重启 web 服务生效（与所有 profile bundle 一致）
- 仅影响 composer 的模型选择座位；`/model` 弹层保持原样，但与面板共享同一份当前选择

## License

MIT
