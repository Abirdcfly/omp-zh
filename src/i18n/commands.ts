/**
 * 斜杠命令汉化。
 *
 * 两条通道：
 *  1. 命令注册表：`BUILTIN_SLASH_COMMANDS_INTERNAL` 里的 spec 对象被
 *     `BUILTIN_SLASH_COMMAND_DEFS` 的 getter 实时读取，改写 description 后
 *     `/help`、ACP、补全与选中说明同步变中文；
 *  2. 补全 provider：包裹内置 provider，翻译技能命令、扩展命令、
 *     动态状态文案（如 “none saved”），并保持 label/value/命令名不变。
 */
import { type PropertySnapshot, patchProperty, restoreProperty, type Translator } from "./engine";

type AnyCommand = {
	name?: string;
	description?: unknown;
	subcommands?: Array<{ name?: string; description?: unknown; usage?: string }>;
};

export interface CommandsPatchStats {
	commands: number;
	subcommands: number;
}

export class CommandsPatch {
	#restores: PropertySnapshot[] = [];
	#applied = false;
	#stats: CommandsPatchStats = { commands: 0, subcommands: 0 };
	#specs: AnyCommand[] = [];

	get applied(): boolean {
		return this.#applied;
	}

	get stats(): CommandsPatchStats {
		return this.#stats;
	}

	async load(): Promise<boolean> {
		try {
			const registry = await import("@oh-my-pi/pi-coding-agent/slash-commands/builtin-registry");
			const internal = (registry as unknown as { BUILTIN_SLASH_COMMANDS_INTERNAL?: readonly AnyCommand[] })
				.BUILTIN_SLASH_COMMANDS_INTERNAL;
			this.#specs = internal ? [...internal] : [];
			return true;
		} catch {
			this.#specs = [];
			return false;
		}
	}

	apply(translator: Translator): CommandsPatchStats {
		if (this.#applied) return this.#stats;
		this.#stats = { commands: 0, subcommands: 0 };
		for (const spec of this.#specs) {
			if (!spec?.name) continue;
			const zh = translator.command(spec.name);
			if (zh && typeof spec.description === "string" && spec.description !== zh) {
				if (this.#set(spec as Record<string, any>, "description", zh)) this.#stats.commands++;
			}
			for (const sub of spec.subcommands ?? []) {
				if (!sub?.name) continue;
				const subZh = translator.command(spec.name, sub.name);
				if (subZh && typeof sub.description === "string" && sub.description !== subZh) {
					if (this.#set(sub as Record<string, any>, "description", subZh)) this.#stats.subcommands++;
				}
			}
		}
		this.#applied = true;
		return this.#stats;
	}

	/** spec 的 description 常是只读 getter，统一按描述符改写并记录还原点。 */
	#set(target: Record<string, any>, key: string, value: unknown): boolean {
		const snapshot = patchProperty(target, key, value);
		if (!snapshot) return false;
		this.#restores.push(snapshot);
		return true;
	}

	revert(): void {
		for (const snapshot of this.#restores.reverse()) restoreProperty(snapshot);
		this.#restores = [];
		this.#applied = false;
	}
}

interface CompletionItem {
	value?: string;
	label?: string;
	description?: string;
	nativeDetail?: string;
	state?: string;
	hint?: string;
}

interface CompletionProvider {
	getSuggestions?: (...args: any[]) => any;
	applyCompletion?: (...args: any[]) => any;
	getInlineHint?: (...args: any[]) => string | null;
	trySyncSlashCompletion?: (...args: any[]) => any;
	trySyncInlineReplace?: (...args: any[]) => any;
}

/** 只翻译说明类字段，永远不动 value / label / icon，否则补全会错位。 */
export function translateCompletionItem(translator: Translator, item: CompletionItem): CompletionItem {
	const next: CompletionItem = { ...item };
	for (const key of ["description", "nativeDetail", "hint", "state"] as const) {
		const value = item[key];
		if (typeof value !== "string" || value.length === 0) continue;
		const zh = translator.text(value);
		if (zh !== value) next[key] = zh;
	}
	return next;
}

/** 构造一个包裹当前 provider 的工厂。 */
export function createCompletionFactory(translator: Translator, isActive: () => boolean) {
	return (current: CompletionProvider): CompletionProvider => {
		const translateResult = (result: any) => {
			if (!isActive() || !result || !Array.isArray(result.items)) return result;
			return { ...result, items: result.items.map((item: CompletionItem) => translateCompletionItem(translator, item)) };
		};

		return {
			async getSuggestions(...args: any[]) {
				const result = await current.getSuggestions?.(...args);
				return translateResult(result);
			},
			applyCompletion(...args: any[]) {
				return current.applyCompletion?.(...args);
			},
			getInlineHint(...args: any[]) {
				const hint = current.getInlineHint?.(...args);
				if (!isActive() || !hint) return hint ?? null;
				return translator.text(hint) ?? null;
			},
			trySyncSlashCompletion(...args: any[]) {
				return translateResult(current.trySyncSlashCompletion?.(...args));
			},
			trySyncInlineReplace(...args: any[]) {
				return current.trySyncInlineReplace?.(...args);
			},
		};
	};
}
