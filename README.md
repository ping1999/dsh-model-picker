# dsh-model-picker[![awesome · DSH plugin](https://awesome-dsh-plugin.com/badge.svg)](https://awesome-dsh-plugin.com)

为 dsh web GUI 的模型选择器提供增强面板：**左侧提供商栏 + 右侧模型列表**，两侧独立滚动，支持跨提供商搜索——替代默认的单列长滚动分组列表。

An enhanced model picker for the dsh web GUI: a **left provider column with the model list on the right**, both independently scrollable, plus a cross-provider search box — replacing the default single-column grouped list.

## 功能 Features

- 左栏按提供商纵向排列（独立滚动，带模型计数徽章），右栏显示当前提供商的模型（独立滚动）——几十个提供商、上百个模型也能顺畅浏览
- 默认选中当前模型所属的提供商；点击任意提供商即切换
- 顶部搜索框跨提供商匹配（提供商名 / 模型名 / 描述，大小写不敏感），结果带提供商名，点选即切换
- 保留推理档位切换（当前模型支持时显示在底部）、加载 / 错误 / 重试 / 空态
- 与内置 `/model` 弹层共享同一份模型目录（`ctx.modelDirectories`），任何一处切换另一处立即同步；composer 的模型阻塞逻辑不受影响
- 界面跟随系统深浅色主题；文案中英文自动切换

A left column lists providers (independently scrollable, with model-count badges); the right column shows the active provider's models (independently scrollable). The search box matches across providers (provider name / model name / description, case-insensitive). Reasoning-effort switching, loading/error/retry/empty states are preserved, and the panel shares the same per-session model directory as the built-in `/model` popup. Dark/light theme aware; UI text follows the system language.

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
- 当前模型支持推理档位时，菜单底部出现档位按钮（含「提供方默认」）

After the web server restarts, open any session and click the model selector at the right end of the composer tool row:

- Click a provider in the left column to switch the right list; click a model to select it (✓ marks the current one)
- Type in the search box to see cross-provider results; clicking any provider exits search
- When the current model supports reasoning efforts, effort buttons (including "provider default") appear at the bottom of the menu

## 工作原理 How it works

持久化 bundle（`package.json` 的 `dsh.bundle.patch` → `cordis.patch.yml`），由 `dsh plugin add` 的 reconcile 自动加入 profile 的 `dsh.profile.bundles` 层：

- **Client 半**（`lib/client.js`）：通过 `exports["./client"]` + `dsh.client` 声明被 web 前端加载，注册到 composer 的 `conversation.input.model` 座位（priority -1，顶替默认实现）；数据复用内置 `ui-model-selection` 的 `ctx.modelDirectories` 每会话目录（`session.models` / `session.selectModel`），不引入第二份状态
- 纯客户端插件，无 Host 半区，无网络请求，无持久化状态

## 要求与限制 Requirements and limitations

- 需要 web profile 已装载 `@deepseek-ai/dsh-client-ui-model-selection`（web-app 内置，通常已存在）；缺失时选择器座位保持空置（回退安全）
- 动态安装后需重启 web 服务生效（与所有 profile bundle 一致）
- 仅影响 composer 的模型选择座位；`/model` 弹层保持原样，但与面板共享同一份当前选择

## License

MIT
