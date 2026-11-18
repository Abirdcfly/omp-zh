# omp-zh

[`oh-my-pi`](https://github.com/can1357/oh-my-pi)（命令 `omp`）的简体中文汉化插件，基线版本 **18.22.2**。

装上之后，`omp` 的设置面板、斜杠命令说明、补全提示、界面文案全部显示中文；命令名、配置键名、代码标识符、路径与产品专名保持原样，避免影响可执行性。

## 覆盖范围

| 区域 | 覆盖情况 | 生效方式 |
| --- | --- | --- |
| 设置面板 | 462/462 条设置项，10 个标签页、10 条导语、62 个分组、269 个选项标签 | 改写 `config/registry` 的 `ui` 元数据与 `@oh-my-pi/pi-tui/overlays/settings-defs` 的 `TAB_METADATA` / `TAB_LEADS` / `TAB_GROUPS` |
| 斜杠命令 | 89 个顶层命令 + 130 个子命令说明 | 改写 `BUILTIN_SLASH_COMMANDS_INTERNAL` 的 spec 描述 |
| 补全 / 内联提示 | 技能命令、扩展命令、状态文案 | 包裹 `addAutocompleteProvider`，只翻译说明字段 |
| 界面文案 | 对话框、命令报告、提示卡、警告行 | 包裹 `Text` 原型的 `describe()` / `render()` |
| 助手正文 | **不翻译** | 正文走 Markdown 节点，不经过 `Text`，因此不会被误译 |

已知边界（上游没有对应接口，无法从插件侧改写）：

- 状态栏、footer / header 的自定义渲染（交互与 RPC 模式下 `setFooter` / `setHeader` 是空操作）；
- 帮助正文、模型输出、工具原始输出（这些属于内容而非界面文案）。

## 环境要求

- `omp` **18.22.2**（`omp --version` 应输出 `omp/18.22.2`）；
- `omp` 自身以 TypeScript 源码方式加载扩展，无需预编译。

## 安装

1. 克隆仓库到本地任意目录：

   ```bash
   git clone https://github.com/Abirdcfly/omp-zh.git
   ```

2. 在 omp 的 agent 配置文件 `~/.omp/agent/config.yml` 的 `extensions` 列表里加入本插件入口（路径指向克隆下来的仓库）：

   ```yaml
   extensions:
     - <仓库目录>/src/index.ts
   ```

   已有其它扩展时追加一行即可，顺序无关。

3. 重启 `omp`。

也可以用 omp 自带的扩展安装命令，参数同样指向仓库目录：

```bash
omp plugin install <仓库目录>
```

安装后输入 `/zh-cn`，能看到词表统计即表示插件已生效。

## 用法

| 命令 | 作用 |
| --- | --- |
| `/zh-cn` 或 `/zhcn` | 显示当前状态与词表统计 |
| `/zh-cn on` / `off` / `toggle` | 启用、关闭、切换中文界面（关闭即恢复原始英文，无需重启） |
| `/zh-cn scope all\|settings\|commands\|chrome` | 限定汉化范围，下次打开 `/settings` 生效 |
| `/zh-cn reload` | 改完词表后热重载 |
| `/zh-cn capture on\|off` | 收集未翻译的界面文案，写入 `<agentDir>/omp-zh-missing.log` |

插件自身配置保存在 `<agentDir>/omp-zh.json`，不改动 `omp` 的 `config.yml`。环境变量 `OMP_ZH=0/1` 可临时覆盖总开关。

插件同时在 `omp` 的设置面板里注册了四个中文设置项（启用、范围、界面文案、缺词收集），可以直接在 `/settings` 里改。

## 词表结构

```
catalog/
├── settings/            # 按设置面板标签页切片，文件名为 tab id
│   ├── appearance.json  # { "<setting.id>": ["中文标签", "中文描述"] }
│   ├── model.json
│   └── ...
├── ui.json              # tabs / leads / groups / options / exact / prefix / regex / span
└── commands.json        # { "<命令名>": "中文说明", "<命令名>:<子命令>": "中文说明" }
```

词表是纯数据，新增分片不用改代码：`src/i18n/catalog.ts` 会读取 `catalog/settings/` 下所有 `*.json` 并合并。

## 开发与校验

```bash
bun test                     # 引擎、词表结构、配置存储
bun scripts/coverage.ts       # 对照 18.22.2 设置清单，逐标签页报覆盖率
bun scripts/build-catalog.ts  # 合并快照 + 结构检查
bun scripts/extract-omp.ts <oh-my-pi 源码目录>  # 从上游源码重抽设置项与命令清单
```

`scripts/coverage.ts` 优先读运行时 registry，读不到就回退到 `scripts/manifest/settings-18.22.2.json`（18.22.2 的离线快照），存在缺口时退出码为 1，适合放进 CI。

## 版本策略

- 插件锁 `engines.omp = 18.22.2`；上游改动设置项或文案后，跑 `bun scripts/extract-omp.ts` 与 `bun scripts/coverage.ts` 就能看出缺口。
- 所有改写都记录还原点，`/zh-cn off` 会逐条还原，不会留下半汉化状态。

## 许可

MIT，见 `LICENSE`。
