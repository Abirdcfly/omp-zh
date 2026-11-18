# 实现原理

`omp` 18.22.2 没有任何 i18n 基础设施，也没有“语言包”概念，因此汉化只能以扩展（extension）形式在运行时改写官方注入面。本插件锁定三条注入面，全部来自上游源码的公开导出，不修改 `omp` 安装目录。

## 1. 设置面板

`config/registry` 的 `all()` 返回设置句柄数组，每个句柄带：

- `definition`：只读定义（`id`、`type`、`default` 等）；
- `ui`：活的 `ui` 元数据对象，`label` / `description` / `warning` / `tab` / `group` / `options` 都在这里。

`config/settings-ui.ts` 的 `createSettingsHost()` 按引用把 `ui` 塞进 `SettingsDisplayEntry`，面板再经 `entryToSettingDef()` 读取。因此**在打开 `/settings` 之前**改写 `ui` 就会生效；面板已经打开时需重开一次。

标签页名、导语、分组来自 `@oh-my-pi/pi-tui/overlays/settings-defs` 的模块级常量：

- `TAB_METADATA[tab].label` —— 渲染时实时读取，可直接改写；
- `TAB_LEADS[tab]` —— 同上；
- `TAB_GROUPS[tab]` —— 数组元素既用于渲染分组标题，也用于 `getSettingsForTab` 的排序（`indexOf(group)`）。所以必须**同时**改写 `ui.group` 与 `TAB_GROUPS` 的对应元素，否则分组顺序会错乱。

选项标签在 `ui.options[]` 的 `{ value, label, description }` 上，只改 `label` / `description`，`value` 永远不动。

### 为什么用 defineProperty 而不是赋值

设置项与命令 spec 里大量字段是只读 getter（例如命令的 `get description()`），在严格模式下直接赋值会抛 `Attempted to assign to readonly property`，导致整个扩展加载失败。插件统一走 `patchProperty()`：先看属性描述符，可配置就用 `defineProperty` 换成可写数据属性，不可配置就跳过，并记录原始描述符供还原。真实进程验证结果：461 条设置项、608 处选项、412 处分组、9 个标签页名（`Shell` 保持原样所以不计入）、89 个命令、130 个子命令。

## 2. 斜杠命令

`slash-commands/builtin-registry.ts` 导出 `BUILTIN_SLASH_COMMANDS_INTERNAL`（spec 对象数组）。`BUILTIN_SLASH_COMMAND_DEFS` 用 getter 实时读 `command.description`，所以改 spec 的 `description` 与 `subcommands[].description`，`/help`、ACP、补全与选中说明会一起变。

动态文案（如 `/effort` 的描述是 getter 拼出来的、`/advisor` 的状态是运行时算的）由补全 provider 那一层兜底：`ctx.ui.addAutocompleteProvider(factory)` 包裹内置 provider，只翻译 `description` / `nativeDetail` / `hint` / `state`，`value` / `label` / `icon` 保持原样，避免补全错位。

## 3. 界面文案

`Text` 组件从根包 `@oh-my-pi/pi-coding-agent` 正式再导出。插件在 `Text.prototype` 上挂包装：

- `describe()` 返回 NativeNode，递归翻译 `p.text` 与 `p.spans[].t`；
- `render(width)` 返回带 ANSI 的终端行，逐行交给 `Translator.line()`。

`Translator.line()` 只替换“最外层可见字符区间”：先剥掉 ANSI 求可见文本，命中词表才替换，左右两侧的样式序列、缩进内边距与行尾补位空格原样保留，因此不会掉色。

助手正文走 Markdown / md 节点，不经过 `Text`，所以正文与代码不会被误译。缺词收集模式把未命中的界面行写入 `<agentDir>/omp-zh-missing.log`，用于继续补词表。

## 4. 词表与匹配

`Catalog` 分三类匹配，按“越来越宽松”的顺序尝试，命中即返回：

1. `exact` —— 整条文案精确命中（界面文案与选项提示的主体）；
2. `regex` —— 带捕获组的模板，处理“数字/路径嵌在句子里”的文案；
3. `prefix` —— 固定前缀 + 动态后缀，剩余部分继续走 `span`；
4. `span` —— 片段级整词替换，带词边界判断，避免 `Job` 误伤 `Jobber`。

设置项、选项、分组、标签页、导语、命令各有独立映射表（`settings` / `options` / `groups` / `tabs` / `leads` / `commands`），不参与上面的文本匹配，避免把设置项 id 当成界面文案误翻。

## 5. 边界

上游没有接口的部分，插件不硬改：

- `ctx.ui.setFooter` / `setHeader` 在交互模式与 RPC 模式下都是空操作，状态栏无法替换；
- 模型输出、工具原始输出、帮助正文属于内容，不做翻译。
