/**
 * 翻译引擎。
 *
 * 词表分四类，按“越来越宽松”的顺序匹配，任何一类命中即返回：
 *  1. exact   —— 整行/整段精确命中，最常见的界面文案；
 *  2. prefix  —— 固定前缀 + 动态后缀（例如 "Recalled 3 memories"、"3 files changed"）；
 *  3. regex   —— 带占位符的模板，用于“数字/路径嵌在句子里”的文案；
 *  4. span    —— 片段级替换，用于一行里混排了多个已知短语的情况。
 *
 * 所有替换都在“可见文本”上做，ANSI 转义序列保持原位不动，
 * 因此主题色、背景色、加粗等样式不会丢失。
 */

export interface Catalog {
	/** 整条文案。 */
	exact: Record<string, string>;
	/** [英文前缀, 中文前缀]，按长度降序匹配，剩余部分继续走 span 替换。 */
	prefix: Array<[string, string]>;
	/** [正则源码, 中文模板]，模板里用 $1..$9 引用捕获组。 */
	regex: Array<[string, string]>;
	/** [英文片段, 中文片段]，只做整词替换。 */
	span: Array<[string, string]>;
	/** 设置项：id -> [标签, 描述]。 */
	settings: Record<string, [string, string?]>;
	/** 设置项选项 / 枚举值标签：英文标签 -> 中文标签。 */
	options: Record<string, string>;
	/** 设置面板标签页：tab id -> 中文名。 */
	tabs: Record<string, string>;
	/** 设置面板标签页导语：tab id -> 中文导语。 */
	leads: Record<string, string>;
	/** 设置分组标题：英文分组 -> 中文分组。 */
	groups: Record<string, string>;
	/** 斜杠命令：命令名（不含 /）-> 中文说明；子命令用 "name:sub" 作为键。 */
	commands: Record<string, string>;
}

const EMPTY: Catalog = {
	exact: {},
	prefix: [],
	regex: [],
	span: [],
	settings: {},
	options: {},
	tabs: {},
	leads: {},
	groups: {},
	commands: {},
};

/** ANSI / OSC 转义序列（含光标控制、超链接）。 */
const ESCAPE = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])/g;

export function stripAnsi(text: string): string {
	return text.replace(ESCAPE, "");
}

/** 是否含有可翻译的拉丁字母（纯符号、纯数字、纯中文都直接跳过）。 */
export function hasLatin(text: string): boolean {
	return /[A-Za-z]/.test(text);
}

interface Compiled {
	exact: Map<string, string>;
	prefix: Array<[string, string]>;
	regex: Array<[RegExp, string]>;
	span: Array<[string, string]>;
}

function escapeRegExp(text: string): string {
	return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function compile(catalog: Catalog): Compiled {
	const prefix = [...catalog.prefix].sort((a, b) => b[0].length - a[0].length);
	const span = [...catalog.span].sort((a, b) => b[0].length - a[0].length);
	const regex: Array<[RegExp, string]> = [];
	for (const [source, zh] of catalog.regex) {
		try {
			regex.push([new RegExp(source), zh]);
		} catch {
			// 词表里的坏正则不应拖垮整个插件，跳过即可。
		}
	}
	return { exact: new Map(Object.entries(catalog.exact)), prefix, regex, span };
}

export class Translator {
	#catalog: Catalog;
	#compiled: Compiled;
	/** 已翻译过的可见文本缓存：同一帧会重复渲染同一批组件。 */
	#cache = new Map<string, string>();
	#wordBoundary = /[A-Za-z0-9]/;

	constructor(catalog: Catalog = EMPTY) {
		this.#catalog = catalog;
		this.#compiled = compile(catalog);
	}

	get catalog(): Catalog {
		return this.#catalog;
	}

	replace(catalog: Catalog): void {
		this.#catalog = catalog;
		this.#compiled = compile(catalog);
		this.#cache.clear();
	}

	/** 可见文本层面的翻译，返回原文或译文。 */
	text(text: string): string {
		if (!text || !hasLatin(text)) return text;
		const cached = this.#cache.get(text);
		if (cached !== undefined) return cached;
		const result = this.#resolve(text);
		if (this.#cache.size > 4096) this.#cache.clear();
		this.#cache.set(text, result);
		return result === text ? text : result;
	}

	#resolve(text: string): string {
		const { exact, prefix, regex, span } = this.#compiled;

		const direct = exact.get(text);
		if (direct !== undefined) return direct;

		const trimmed = text.trim();
		if (trimmed !== text) {
			const inner = exact.get(trimmed);
			if (inner !== undefined) return text.replace(trimmed, inner);
		}

		for (const [pattern, zh] of regex) {
			const m = pattern.exec(text);
			if (!m) continue;
			return text.replace(pattern, zh);
		}

		for (const [en, zh] of prefix) {
			if (!text.startsWith(en)) continue;
			const rest = text.slice(en.length);
			return zh + this.#spanReplace(rest);
		}

		const replaced = this.#spanReplace(text);
		return replaced === text ? text : replaced;
	}

	#spanReplace(text: string): string {
		let out = text;
		for (const [en, zh] of this.#compiled.span) {
			let index = out.indexOf(en);
			while (index !== -1) {
				if (!this.#boundaryOk(out, index, en)) {
					index = out.indexOf(en, index + 1);
					continue;
				}
				out = out.slice(0, index) + zh + out.slice(index + en.length);
				index = out.indexOf(en, index + zh.length);
			}
		}
		return out;
	}

	#boundaryOk(text: string, index: number, en: string): boolean {
		const first = en[0] ?? "";
		const last = en.at(-1) ?? "";
		if (!this.#wordBoundary.test(first) && !this.#wordBoundary.test(last)) return true;
		const before = index === 0 ? " " : text[index - 1];
		const after = text[index + en.length] ?? " ";
		const okBefore = !this.#wordBoundary.test(first) || !this.#wordBoundary.test(before);
		const okAfter = !this.#wordBoundary.test(last) || !this.#wordBoundary.test(after);
		return okBefore && okAfter;
	}

	/**
	 * 翻译一行已渲染的终端文本：只替换最外层可见字符区间，保留两侧的内边距与
	 * 首个/末个 ANSI 序列之外的样式前缀、后缀。
	 */
	line(line: string): string {
		if (!line || !hasLatin(line)) return line;
		const plain = stripAnsi(line);
		const trimmed = plain.trim();
		if (!trimmed) return line;

		const translated = this.text(trimmed);
		if (translated === trimmed) return line;

		const [start, end] = visibleSpan(line);
		if (start === -1) return line;
		// 只替换最外层可见字符区间：左侧的样式序列、缩进内边距与右侧的复位序列、
		// 行尾补位空格全部原样保留，因此单色行不会掉色。
		return line.slice(0, start) + translated + line.slice(end);
	}

	/** 片段级：保留 span 结构，只翻译每个 span 的文字。 */
	spans(spans: ReadonlyArray<{ t: string }>): Array<{ t: string }> {
		return spans.map(span => {
			if (!hasLatin(span.t)) return span;
			const translated = this.text(span.t.trim());
			if (translated === span.t.trim()) return span;
			return { ...span, t: translated };
		}) as Array<{ t: string }>;
	}

	/** 设置项翻译：id 命中则返回 [标签, 描述]。 */
	setting(id: string): [string, string?] | undefined {
		return this.#catalog.settings[id];
	}

	option(label: string): string | undefined {
		return this.#catalog.options[label];
	}

	group(name: string): string | undefined {
		return this.#catalog.groups[name];
	}

	tab(id: string): string | undefined {
		return this.#catalog.tabs[id];
	}

	lead(id: string): string | undefined {
		return this.#catalog.leads[id];
	}

	command(name: string, sub?: string): string | undefined {
		return this.#catalog.commands[sub ? `${name}:${sub}` : name];
	}

	get stats(): { exact: number; prefix: number; regex: number; span: number; settings: number; commands: number } {
		return {
			exact: Object.keys(this.#catalog.exact).length,
			prefix: this.#catalog.prefix.length,
			regex: this.#catalog.regex.length,
			span: this.#catalog.span.length,
			settings: Object.keys(this.#catalog.settings).length,
			commands: Object.keys(this.#catalog.commands).length,
		};
	}
}

/** 可见字符的 [起, 止) 索引，忽略 ANSI 序列与首尾空白。 */
function visibleSpan(line: string): [number, number] {
	ESCAPE.lastIndex = 0;
	let start = -1;
	let end = -1;
	const escapes: Array<[number, number]> = [];
	for (const m of line.matchAll(ESCAPE)) escapes.push([m.index!, m.index! + m[0].length]);
	let cursor = 0;
	for (let i = 0; i < line.length; i++) {
		if (cursor < escapes.length && i === escapes[cursor][0]) {
			i = escapes[cursor][1] - 1;
			cursor++;
			continue;
		}
		if (/\s/.test(line[i])) continue;
		if (start === -1) start = i;
		end = i + 1;
	}
	return start === -1 ? [-1, -1] : [start, end];
}

export function emptyCatalog(): Catalog {
	return {
		exact: {},
		prefix: [],
		regex: [],
		span: [],
		settings: {},
		options: {},
		tabs: {},
		leads: {},
		groups: {},
		commands: {},
	};
}

export function mergeCatalog(...parts: Array<Partial<Catalog>>): Catalog {
	const out = emptyCatalog();
	for (const part of parts) {
		Object.assign(out.exact, part.exact ?? {});
		out.prefix.push(...(part.prefix ?? []));
		out.regex.push(...(part.regex ?? []));
		out.span.push(...(part.span ?? []));
		Object.assign(out.settings, part.settings ?? {});
		Object.assign(out.options, part.options ?? {});
		Object.assign(out.tabs, part.tabs ?? {});
		Object.assign(out.leads, part.leads ?? {});
		Object.assign(out.groups, part.groups ?? {});
		Object.assign(out.commands, part.commands ?? {});
	}
	return out;
}

/**
 * 属性描述符快照。omp 的设置元数据与命令 spec 里有大量只读 getter
 * （例如 `get description()`），直接赋值在严格模式下会抛
 * “Attempted to assign to readonly property”，因此统一走 defineProperty。
 */
export interface PropertySnapshot {
	target: Record<string, any>;
	key: string;
	descriptor: PropertyDescriptor | undefined;
}

export function snapshotProperty(target: Record<string, any>, key: string): PropertySnapshot {
	return { target, key, descriptor: Object.getOwnPropertyDescriptor(target, key) };
}

/**
 * 改写一个自有属性，返回快照用于还原；不可写、不可配置或对象被冻结时返回 undefined。
 */
export function patchProperty(target: Record<string, any>, key: string, value: unknown): PropertySnapshot | undefined {
	if (!target || typeof target !== "object") return undefined;
	const snapshot = snapshotProperty(target, key);
	const descriptor = snapshot.descriptor;
	if (descriptor) {
		if (!descriptor.configurable && "value" in descriptor && !descriptor.writable) return undefined;
		if (!descriptor.configurable && !("value" in descriptor)) return undefined;
	} else if (!Object.isExtensible(target)) {
		return undefined;
	}
	try {
		Object.defineProperty(target, key, {
			value,
			configurable: true,
			enumerable: descriptor?.enumerable ?? true,
			writable: true,
		});
		return snapshot;
	} catch {
		return undefined;
	}
}

export function restoreProperty(snapshot: PropertySnapshot): void {
	if (snapshot.descriptor) {
		Object.defineProperty(snapshot.target, snapshot.key, snapshot.descriptor);
		return;
	}
	delete snapshot.target[snapshot.key];
}

export { escapeRegExp };
