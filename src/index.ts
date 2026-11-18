/**
 * omp-zh —— oh-my-pi 简体中文汉化插件（对应 omp 18.22.2）
 *
 * 覆盖范围：
 *  - 设置面板：标签页、导语、分组、条目名、说明、选项、告警
 *  - 斜杠命令：/help、补全、选中说明、内联提示
 *  - 界面文案：Text 渲染的对话框、命令报告、提示卡、警告
 *  - 插件自身命令与提示全部中文
 *
 * 开关：/zh-cn on | off | toggle | status | reload | scope <范围> | capture on|off
 */
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { ChromePatch } from "./i18n/chrome";
import { CommandsPatch, createCompletionFactory } from "./i18n/commands";
import { loadCatalog } from "./i18n/catalog";
import { Translator } from "./i18n/engine";
import { SettingsPatch } from "./i18n/settings";
import { createConfigStore, parseScope, scopeIncludes, type ZhConfig } from "./state";

/** 同一个进程内可能加载多次（子会话会重新绑定工厂），补丁只装一次。 */
const singleton = {
	applied: false,
	translator: undefined as Translator | undefined,
	settings: new SettingsPatch(),
	commands: new CommandsPatch(),
	chrome: new ChromePatch(),
	config: undefined as ZhConfig | undefined,
	agentDir: undefined as string | undefined,
	loggedStartup: false,
};

function agentDirectory(): Promise<string | undefined> {
	return import("@oh-my-pi/pi-coding-agent")
		.then(mod => (mod as { getAgentDir?: () => string }).getAgentDir?.())
		.catch(() => undefined);
}

function summarize(translator: Translator): string {
	const stats = translator.stats;
	return `词表 ${stats.exact + stats.prefix + stats.regex + stats.span} 条，设置项 ${stats.settings} 条，命令 ${stats.commands} 条`;
}

function applyAll(translator: Translator, config: ZhConfig): string {
	const parts: string[] = [];
	// 上游升级可能改动注入面：单个区域出错时只让该区域退回英文，
	// 不能让异常冒到扩展工厂，否则整个插件会被 omp 判定为加载失败。
	const step = (label: string, fn: () => void) => {
		try {
			fn();
		} catch {
			parts.push(`${label}降级（上游接口不匹配）`);
		}
	};

	if (scopeIncludes(config, "settings")) {
		step("设置面板", () => {
			const stats = singleton.settings.apply(translator);
			parts.push(`设置项 ${stats.settings}`);
		});
	}
	if (scopeIncludes(config, "commands")) {
		step("命令说明", () => {
			const stats = singleton.commands.apply(translator);
			parts.push(`命令 ${stats.commands} / 子命令 ${stats.subcommands}`);
		});
	}
	// 无论当前范围如何都安装补丁：生效与否由闭包读取最新配置决定，
	// 这样 /zh-cn on 或切换范围后无需重启即可恢复。
	step("界面文案", () => {
		const chromeStats = singleton.chrome.apply(
			translator,
			() => {
				const current = singleton.config ?? config;
				return current.enabled && current.chrome && (current.scope === "all" || current.scope === "chrome");
			},
			(singleton.config ?? config).capture,
		);
		if (chromeStats.active) {
			parts.push(config.chrome && scopeIncludes(config, "chrome") ? "界面文案已接管" : "界面文案待命");
		} else {
			parts.push("界面文案未接管");
		}
	});
	singleton.applied = true;
	return parts.join("，");
}

/**
 * 诊断探针：设置 OMP_ZH_DEBUG=1 时，把本次加载的补丁状态写到
 * <agentDir>/omp-zh-debug.json，便于在真实 omp 进程里核对汉化是否生效。
 */
function writeProbe(loadedFiles: number, config: ZhConfig): void {
	if (!process.env.OMP_ZH_DEBUG || !singleton.agentDir) return;
	try {
		const translator = singleton.translator;
		writeFileSync(
			join(singleton.agentDir, "omp-zh-debug.json"),
			`${JSON.stringify(
				{
					omp: process.env.OMP_VERSION ?? null,
					enabled: config.enabled,
					scope: config.scope,
					chrome: config.chrome,
					files: loadedFiles,
					catalog: translator ? translator.stats : null,
					patches: {
						settings: singleton.settings.stats,
						commands: singleton.commands.stats,
						chrome: singleton.chrome.applied,
					},
				},
				null,
				2,
			)}\n`,
			"utf8",
		);
	} catch {
		// 探针写不进去不影响汉化。
	}
}

function revertAll(): void {
	singleton.settings.revert();
	singleton.commands.revert();
}

export default async function ompZh(pi: any) {
	singleton.agentDir = await agentDirectory();
	const store = createConfigStore(singleton.agentDir);
	singleton.config = store.read();
	const captureFile = singleton.agentDir ? join(singleton.agentDir, "omp-zh-missing.log") : undefined;

	let loaded = loadCatalog();
	let translator = new Translator(loaded.catalog);
	singleton.translator = translator;
	singleton.chrome.setCaptureFile(captureFile);

	await singleton.settings.load();
	await singleton.commands.load();
	await singleton.chrome.load();

	const bootConfig = singleton.config;
	if (bootConfig.enabled) applyAll(translator, bootConfig);
	writeProbe(loaded.files.length, bootConfig);

	const repaint = (ctx: any) => {
		try {
			ctx?.ui?.requestRender?.();
		} catch {
			// 非 TUI 模式没有 requestRender。
		}
	};

	const statusText = () => {
		const config = singleton.config ?? store.read();
		const scopeText: Record<string, string> = {
			all: "全部",
			settings: "仅设置面板",
			commands: "仅命令与补全",
			chrome: "仅界面文案",
		};
		return [
			`中文界面：${config.enabled ? "已启用" : "已关闭"}`,
			`范围：${scopeText[config.scope] ?? config.scope}`,
			`界面文案：${config.chrome ? "翻译" : "保持英文"}`,
			`缺词收集：${config.capture ? "开启" : "关闭"}`,
			`${summarize(translator)}`,
		].join("\n");
	};

	const handle = async (args: string, ctx: any) => {
		const raw = (args ?? "").trim();
		const [action = "status", ...rest] = raw.split(/\s+/);
		const config = { ...(singleton.config ?? store.read()) };
		singleton.config = config;
		let message: string;
		let level: "info" | "error" | "warning" = "info";

		switch (action.toLowerCase()) {
			case "on":
			case "enable":
				config.enabled = true;
				applyAll(translator, config);
				message = `中文界面已启用。${summarize(translator)}`;
				break;
			case "off":
			case "disable":
				config.enabled = false;
				revertAll();
				message = "已恢复 omp 原始英文界面。";
				break;
			case "toggle":
				config.enabled = !config.enabled;
				if (config.enabled) applyAll(translator, config);
				else revertAll();
				message = config.enabled ? "中文界面已启用。" : "已恢复 omp 原始英文界面。";
				break;
			case "scope": {
				const scope = parseScope(rest[0]);
				if (!scope) {
					level = "error";
					message = "范围只能是 all / settings / commands / chrome。";
					break;
				}
				config.scope = scope;
				revertAll();
				if (config.enabled) applyAll(translator, config);
				message = `汉化范围已设为：${scope}。重新打开 /settings 后生效。`;
				break;
			}
			case "capture": {
				const value = (rest[0] ?? "").toLowerCase();
				if (["on", "1", "true", "yes"].includes(value)) config.capture = true;
				else if (["off", "0", "false", "no"].includes(value)) config.capture = false;
				else config.capture = !config.capture;
				if (singleton.config) singleton.config = config;
				message = config.capture
					? `缺词收集已开启，未翻译的界面文案会写入 ${captureFile ?? "日志"}。`
					: "缺词收集已关闭。";
				break;
			}
			case "reload": {
				loaded = loadCatalog();
				translator = new Translator(loaded.catalog);
				singleton.translator = translator;
				revertAll();
				if (config.enabled) applyAll(translator, config);
				message = `词表已重新加载：${loaded.files.length} 个文件，${summarize(translator)}。`;
				break;
			}
			case "status":
				message = statusText();
				break;
			case "help":
			default:
				message = [
					"/zh-cn status —— 查看当前状态",
					"/zh-cn on|off|toggle —— 启用 / 关闭 / 切换中文界面",
					"/zh-cn reload —— 修改词表后热重载",
					"/zh-cn scope all|settings|commands|chrome —— 限定汉化范围",
					"/zh-cn capture on|off —— 收集未翻译的界面文案",
				].join("\n");
				break;
		}

		singleton.config = config;
		store.write(config);
		repaint(ctx);
		ctx?.ui?.notify?.(message, level);
	};

	pi.registerCommand("zh-cn", { description: "中文界面开关：状态、启停、热重载、范围与缺词收集", handler: handle });
	pi.registerCommand("zhcn", { description: "中文界面开关（/zh-cn 的简写）", handler: handle });

	pi.on("session_start", async (_event: any, ctx: any) => {
		const config = singleton.config ?? store.read();
		if (config.enabled && config.scope !== "settings") {
			ctx?.ui?.addAutocompleteProvider?.(
				createCompletionFactory(translator, () => {
					const current = singleton.config ?? config;
					return current.enabled && (current.scope === "all" || current.scope === "commands");
				}),
			);
		}

		if (!singleton.loggedStartup) {
			singleton.loggedStartup = true;
			const level = config.enabled ? "info" : "warning";
			const text = config.enabled
				? `omp-zh：中文界面已启用（${summarize(translator)}）。输入 /zh-cn help 查看用法。`
				: "omp-zh：当前为英文界面。输入 /zh-cn on 启用中文。";
			ctx?.ui?.notify?.(text, level);
		}
	});

	pi.on("session_shutdown", async () => {
		// 进程可能被复用：保持补丁，仅清掉渲染缓存。
		translator.replace(translator.catalog);
	});
}
