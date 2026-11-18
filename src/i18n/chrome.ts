/**
 * 界面文案汉化（对话框、命令报告、提示卡、警告行等）。
 *
 * omp 把 `Text` 组件从根包导出，对话框、通知、报告大量使用它。
 * 我们在原型上挂一层薄包装：`describe()` 产出的原生文本节点与
 * `render()` 产出的终端行都会过一遍词表。只替换整行/整段命中的已知文案，
 * 助手正文（Markdown 节点）不在 `Text` 里渲染，因此不会被误译。
 *
 * 当 `capture` 打开时，未命中的英文界面行会写入日志，方便继续补词表。
 */
import { appendFileSync } from "node:fs";
import { type Translator, stripAnsi } from "./engine";

interface NativeTextNode {
	k?: string;
	p?: { text?: string; spans?: Array<{ t: string }> } & Record<string, unknown>;
	c?: NativeTextNode[];
}

export interface ChromePatchStats {
	active: boolean;
}

const MARKER = "__ompZhPatched";

/** 看起来像界面文案、而不是代码/路径/正文的行。 */
function looksLikeUiText(text: string): boolean {
	if (text.length < 8 || text.length > 160) return false;
	if (!/[A-Za-z]/.test(text)) return false;
	if (!/ [A-Za-z]/.test(text) && !/^[A-Z][a-z]/.test(text)) return false;
	if (/^(?:[/~.]|https?:|git@)/.test(text)) return false;
	if (/[\x1b]/ .test(text)) return false;
	if (/[{};=<>|]/.test(text) && !/[A-Za-z] [A-Za-z]/.test(text)) return false;
	if (/\$ omp |npm |bun |cargo |go build/.test(text)) return false;
	return true;
}

function translateNode(node: NativeTextNode, translator: Translator): NativeTextNode {
	if (!node || typeof node !== "object") return node;
	if (node.k === "text" && node.p) {
		const props = node.p;
		if (typeof props.text === "string") {
			const zh = translator.text(props.text);
			if (zh !== props.text) return { ...node, p: { ...props, text: zh } };
			return node;
		}
		if (Array.isArray(props.spans)) {
			let changed = false;
			const spans = props.spans.map(span => {
				const zh = translator.text(span.t);
				if (zh === span.t) return span;
				changed = true;
				return { ...span, t: zh };
			});
			return changed ? { ...node, p: { ...props, spans } } : node;
		}
	}
	if (Array.isArray(node.c)) {
		let changed = false;
		const children = node.c.map(child => {
			const next = translateNode(child, translator);
			if (next !== child) changed = true;
			return next;
		});
		return changed ? { ...node, c: children } : node;
	}
	return node;
}

export class ChromePatch {
	#applied = false;
	#textClass: any;
	#captureFile: string | undefined;

	async load(): Promise<boolean> {
		try {
			const mod = (await import("@oh-my-pi/pi-coding-agent")) as unknown as { Text?: any };
			this.#textClass = mod.Text;
		} catch {
			this.#textClass = undefined;
		}
		return !!this.#textClass;
	}

	setCaptureFile(path: string | undefined): void {
		this.#captureFile = path;
	}

	apply(translator: Translator, isActive: () => boolean, capture: boolean): ChromePatchStats {
		const Text = this.#textClass;
		if (!Text?.prototype) return { active: false };
		if (Text.prototype[MARKER]) return { active: true };
		const proto = Text.prototype;
		const originalDescribe = proto.describe;
		const originalRender = proto.render;
		const captureSink = (text: string) => this.#capture(text);

		proto.describe = function describe(this: any, cx: any) {
			try {
				const node = originalDescribe.call(this, cx);
				return isActive() ? translateNode(node, translator) : node;
			} catch {
				// 上游节点结构变化时不能让渲染挂掉。
				return originalDescribe.call(this, cx);
			}
		};

		proto.render = function render(this: any, width: number) {
			const lines = originalRender.call(this, width) as readonly string[];
			if (!Array.isArray(lines) || lines.length === 0 || !isActive()) return lines;
			try {
				let changed = false;
				const next = lines.map(line => {
					const zh = translator.line(line);
					if (zh !== line) changed = true;
					else if (capture) {
						const plain = stripAnsi(line).trim();
						if (looksLikeUiText(plain)) captureSink(plain);
					}
					return zh;
				});
				return changed ? next : lines;
			} catch {
				return lines;
			}
		};

		// 原型方法在某些构建里可能被冻结，defineProperty 失败时保持原样即可。
		try {
			proto[MARKER] = true;
		} catch {
			return { active: false };
		}
		this.#applied = true;
		return { active: true };
	}

	get applied(): boolean {
		return this.#applied;
	}

	#capture(text: string): void {
		const file = this.#captureFile;
		if (!file) return;
		try {
			appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), text })}\n`, "utf8");
		} catch {
			// 写日志失败不影响使用。
		}
	}
}

export { looksLikeUiText };
