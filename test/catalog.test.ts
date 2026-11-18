import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { basename, resolve } from "node:path";
import { CATALOG_DIRS, loadCatalog, packageRoot } from "../src/i18n/catalog";

const TAB_IDS = [
	"appearance",
	"model",
	"interaction",
	"context",
	"memory",
	"files",
	"shell",
	"tools",
	"tasks",
	"providers",
];

describe("catalog 词表", () => {
	const { catalog, files } = loadCatalog();

	test("读到了设置分片、界面词表与命令词表", () => {
		expect(files.length).toBeGreaterThanOrEqual(11);
		expect(files.some(f => f.endsWith("ui.json"))).toBe(true);
		expect(files.some(f => f.endsWith("commands.json"))).toBe(true);
		expect(files.some(f => f.includes(`${basename(CATALOG_DIRS.settings)}${"/"}`))).toBe(true);
	});

	test("设置项全部为 [中文标签, 中文描述?]", () => {
		expect(Object.keys(catalog.settings).length).toBeGreaterThan(400);
		for (const [id, entry] of Object.entries(catalog.settings)) {
			expect(Array.isArray(entry)).toBe(true);
			expect(typeof entry[0]).toBe("string");
			expect(entry[0].length).toBeGreaterThan(0);
			expect(entry[0]).toMatch(/[\u4e00-\u9fa5A-Za-z]/);
			if (entry[1] !== undefined) expect(typeof entry[1]).toBe("string");
			expect(id).not.toContain(" ");
		}
	});

	test("标签页、导语、分组全部覆盖且为中文", () => {
		for (const tab of TAB_IDS) {
			expect(catalog.tabs[tab]).toBeTruthy();
			expect(catalog.leads[tab]).toBeTruthy();
			expect(catalog.leads[tab]).toMatch(/[\u4e00-\u9fa5]/);
		}
		expect(Object.keys(catalog.groups).length).toBeGreaterThan(60);
		for (const [en, zh] of Object.entries(catalog.groups)) {
			expect(en.length).toBeGreaterThan(0);
			expect(zh).toMatch(/[\u4e00-\u9fa5A-Za-z]/);
		}
	});

	test("命令词表覆盖顶层命令与子命令", () => {
		expect(Object.keys(catalog.commands).length).toBeGreaterThan(200);
		for (const key of ["settings", "model", "compact", "advisor:on", "mcp:add"]) {
			expect(catalog.commands[key]).toBeTruthy();
		}
		for (const zh of Object.values(catalog.commands)) expect(zh).toMatch(/[\u4e00-\u9fa5]/);
	});

	test("选项标签与界面文案非空", () => {
		expect(Object.keys(catalog.options).length).toBeGreaterThan(150);
		expect(Object.keys(catalog.exact).length).toBeGreaterThan(200);
		for (const [en, zh] of Object.entries(catalog.options)) {
			expect(en.length).toBeGreaterThan(0);
			expect(zh.length).toBeGreaterThan(0);
		}
	});

	test("不含机器翻译占位或未替换的模板", () => {
		const all = [
			...Object.values(catalog.settings).flat().filter((v): v is string => typeof v === "string"),
			...Object.values(catalog.commands),
			...Object.values(catalog.exact),
			...Object.values(catalog.options),
		];
		for (const text of all) {
			// TODO.md 是上游真实文件名，因此只拦“待翻译”标记本身。
			expect(text).not.toMatch(/TODO[:：]|TBD|待翻译/);
			expect(text).not.toMatch(/\$\{\w+\}/);
			expect(text).not.toContain("undefined");
		}
	});

	test("设置分片文件名与标签页一致", () => {
		for (const tab of TAB_IDS) {
			expect(existsSync(resolve(packageRoot, "catalog/settings", `${tab}.json`))).toBe(true);
		}
	});
});
