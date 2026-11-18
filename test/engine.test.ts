import { describe, expect, test } from "bun:test";
import { emptyCatalog, hasLatin, mergeCatalog, stripAnsi, Translator } from "../src/i18n/engine";

function catalog(patch: Partial<ReturnType<typeof emptyCatalog>> = {}) {
	return mergeCatalog(emptyCatalog(), patch);
}

describe("Translator.text", () => {
	test("整条精确命中", () => {
		const t = new Translator(catalog({ exact: { "Enable the advisor": "启用顾问" } }));
		expect(t.text("Enable the advisor")).toBe("启用顾问");
	});

	test("保留首尾空白", () => {
		const t = new Translator(catalog({ exact: { "Enable the advisor": "启用顾问" } }));
		expect(t.text("  Enable the advisor  ")).toBe("  启用顾问  ");
	});

	test("无拉丁字母不查表", () => {
		const t = new Translator(catalog({ exact: { "你好": "hello" } }));
		expect(t.text("你好")).toBe("你好");
		expect(hasLatin("你好")).toBe(false);
	});

	test("前缀命中后继续做片段替换", () => {
		const t = new Translator(
			catalog({
				prefix: [["Recalled", "已召回"]],
				span: [["memories", "条记忆"]],
			}),
		);
		expect(t.text("Recalled 3 memories")).toBe("已召回 3 条记忆");
	});

	test("正则模板使用捕获组", () => {
		const t = new Translator(catalog({ regex: [["^(\\d+) tokens$", "$1 个 token"]] }));
		expect(t.text("128 tokens")).toBe("128 个 token");
	});

	test("片段替换遵守词边界", () => {
		const t = new Translator(catalog({ span: [["Job", "任务"]] }));
		expect(t.text("Job failed")).toBe("任务 failed");
		expect(t.text("Jobber failed")).toBe("Jobber failed");
 	});

	test("翻译结果进入缓存且 replace 后失效", () => {
		const t = new Translator(catalog({ exact: { "Show tools": "显示工具" } }));
		expect(t.text("Show tools")).toBe("显示工具");
		t.replace(catalog({ exact: { "Show tools": "列出工具" } }));
		expect(t.text("Show tools")).toBe("列出工具");
	});
});

describe("Translator.line", () => {
	test("保留 ANSI 颜色与缩进", () => {
		const t = new Translator(catalog({ exact: { "Enable the advisor": "启用顾问" } }));
		const line = "\x1b[38;5;110m  Enable the advisor  \x1b[0m   ";
		const out = t.line(line);
		expect(stripAnsi(out).trim()).toBe("启用顾问");
		expect(out.startsWith("\x1b[38;5;110m")).toBe(true);
		expect(out.endsWith("\x1b[0m   ")).toBe(true);
	});

	test("无命中时原样返回（同一引用）", () => {
		const t = new Translator(catalog());
		const line = "\x1b[31mhello world\x1b[0m";
		expect(t.line(line)).toBe(line);
	});
});

describe("Translator.spans", () => {
	test("只改 t 字段，保留其余属性", () => {
		const t = new Translator(catalog({ exact: { Thinking: "思考中" } }));
		const spans = [{ t: "Thinking", fg: "muted" }];
		expect(t.spans(spans)[0]).toEqual({ t: "思考中", fg: "muted" });
	});
});

describe("查找接口", () => {
	test("setting / option / group / tab / lead / command", () => {
		const t = new Translator(
			catalog({
				settings: { "advisor.enabled": ["启用顾问", "配置第二个模型"] },
				options: { Global: "全局" },
				groups: { Theme: "主题" },
				tabs: { appearance: "外观" },
				leads: { appearance: "主题与输入区" },
				commands: { advisor: "切换顾问", "advisor:on": "启用顾问" },
			}),
		);
		expect(t.setting("advisor.enabled")).toEqual(["启用顾问", "配置第二个模型"]);
		expect(t.setting("missing")).toBeUndefined();
		expect(t.option("Global")).toBe("全局");
		expect(t.group("Theme")).toBe("主题");
		expect(t.tab("appearance")).toBe("外观");
		expect(t.lead("appearance")).toBe("主题与输入区");
		expect(t.command("advisor")).toBe("切换顾问");
		expect(t.command("advisor", "on")).toBe("启用顾问");
	});

	test("stats 统计条目数", () => {
		const t = new Translator(catalog({ exact: { a: "b" }, settings: { x: ["y"] } }));
		expect(t.stats.exact).toBe(1);
		expect(t.stats.settings).toBe(1);
	});
});

describe("mergeCatalog", () => {
	test("后合并的分片覆盖同 id 设置项", () => {
		const merged = mergeCatalog({ settings: { a: ["1"] } }, { settings: { a: ["2"], b: ["3"] } });
		expect(merged.settings.a).toEqual(["2"]);
		expect(merged.settings.b).toEqual(["3"]);
	});
});
