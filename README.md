# dsh-plugin

DeepSeek Harness (DSH) 插件 monorepo —— 多插件开发与托管仓库。

## 结构

```text
dsh-plugin/
├── package.json          # workspace 根（pnpm）
├── pnpm-workspace.yaml   # packages/*
└── packages/
    └── dsh-approve/      # 命令白名单插件（当前唯一插件）
```

## 新增插件

在 `packages/` 下按 `packages/<plugin-name>/` 创建目录，遵循：

- `package.json`：声明 `dsh.bundle.patch`（宿主激活补丁，如有）；客户端半区另声明
  `dsh.client`（`platform: "web"`、`inject` 只列启动清单里真实存在的包、
  `immediately: true`）。
- **宿主入口**（Node）：`lib/server.js`，并让 `main` / `exports["."]` 指向它
  —— 绝不能让 tsdown 客户端构建覆盖同名文件。
- **客户端半区**（浏览器）：`src/client/` + tsdown 构建到 `lib/client.js`，
  `exports["./client"]` 指向它。构建用
  `/Users/huzilin/workdir/deepseek-harness/node_modules/.bin/tsdown`（DSH 客户端 face）。

## 部署到 DSH

```sh
dsh plugin --profile web add 'github:huzilin/dsh-plugin#path:/packages/<plugin-name>'
```

1. 依赖以真实包安装（无本地符号链接），`dsh plugin` 自动把它加入 profile 的 bundle 层；
2. 在 `~/.dsh/profiles/web/cordis.patch.yml` **保持 `[]`**（bundle 层已挂载，用户层再加会双挂载）；
3. 改完**冷启动**（不要热插）：kill 3080 后重跑 `dsh web`；
4. 本地修改流程：commit → push → `cd ~/.dsh/profiles/web && pnpm update dsh-approve` → 重启；
5. 客户端半区变更后**必须清浏览器缓存刷新**（rev 变化在线生效，但旧 index.html
   会持续加载旧 boot graph；Pake 桌面壳尤甚，网页端无痕窗口最稳）。

本机若 `dsh` 不在 PATH，在 deepseek-harness 检出内用 `pnpm dsh` 等价调用（如
`pnpm dsh plugin --profile web add 'github:huzilin/dsh-plugin#path:/packages/<plugin-name>'`）。

插件各自的安装/配置详见 `packages/<plugin-name>/README.md`。

## dsh-approve

- [dsh-approve](packages/dsh-approve/) —— DSH 命令白名单：非当前目录命令需确认
  （弹框三动作：拒绝 / 加入白名单 / 允许一次），白名单精确匹配后永不拦截。
  安装：
  ```sh
  dsh plugin --profile web add 'github:huzilin/dsh-plugin#path:/packages/dsh-approve'
  ```
  注意：DSH 自身审批（沙箱升级等）**保持开启兜底**；白名单写入**必须经用户审批**（agent 不能自主写）。
