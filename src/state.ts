/**
 * 插件配置：环境变量 > 插件设置 > 本地文件 > 默认值。
 *
 * 本地文件默认位于 omp 的 agent 目录（~/.omp/agent/omp-zh.json），
 * 只由 /zh 命令写入，不会改动 omp 自己的 config.yml。
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export type ZhScope = "all" | "settings" | "commands" | "chrome";

export interface ZhConfig {
	/** 总开关。 */
	enabled: boolean;
	/** 汉化范围。 */
	scope: ZhScope;
	/** 是否翻译对话框等界面文案。 */
	chrome: boolean;
	/** 缺词收集模式。 */
	capture: boolean;
}

export const DEFAULT_CONFIG: ZhConfig = { enabled: true, scope: "all", chrome: true, capture: false };

const SCOPES: readonly ZhScope[] = ["all", "settings", "commands", "chrome"];

export function parseScope(value: unknown): ZhScope | undefined {
	return typeof value === "string" && (SCOPES as readonly string[]).includes(value)
		? (value as ZhScope)
		: undefined;
}

export interface ConfigStore {
	read: () => ZhConfig;
	write: (config: ZhConfig) => void;
	path: string;
}

export function createConfigStore(agentDirPath: string | undefined): ConfigStore {
	const dir = agentDirPath && agentDirPath.length > 0 ? agentDirPath : join(homedir(), ".omp", "agent");
	const file = join(dir, "omp-zh.json");

	const readFile = (): Partial<ZhConfig> => {
		try {
			if (!existsSync(file)) return {};
			const parsed = JSON.parse(readFileSync(file, "utf8")) as Partial<ZhConfig>;
			return parsed && typeof parsed === "object" ? parsed : {};
		} catch {
			return {};
		}
	};

	const fromEnv = (config: ZhConfig): ZhConfig => {
		const raw = process.env.OMP_ZH;
		if (raw === undefined || raw.trim() === "") return config;
		const value = raw.trim().toLowerCase();
		if (["0", "false", "off", "no"].includes(value)) return { ...config, enabled: false };
		if (["1", "true", "on", "yes"].includes(value)) return { ...config, enabled: true };
		return config;
	};

	return {
		path: file,
		read() {
			const fileConfig = readFile();
			const scope = parseScope(fileConfig.scope);
			const merged: ZhConfig = {
				enabled: typeof fileConfig.enabled === "boolean" ? fileConfig.enabled : DEFAULT_CONFIG.enabled,
				scope: scope ?? DEFAULT_CONFIG.scope,
				chrome: typeof fileConfig.chrome === "boolean" ? fileConfig.chrome : DEFAULT_CONFIG.chrome,
				capture: typeof fileConfig.capture === "boolean" ? fileConfig.capture : DEFAULT_CONFIG.capture,
			};
			return fromEnv(merged);
		},
		write(config) {
			try {
				mkdirSync(dirname(file), { recursive: true });
				writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, "utf8");
			} catch {
				// 写不进去只影响持久化，不影响本次会话的开关。
			}
		},
	};
}

export function scopeIncludes(config: ZhConfig, area: Exclude<ZhScope, "all">): boolean {
	if (!config.enabled) return false;
	if (config.scope === "all") return true;
	if (config.scope === area) return true;
	// chrome 是对话框文案；settings 面板里也会出现 chrome 文案，故两者互不影响。
	return false;
}
