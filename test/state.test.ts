import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, createConfigStore, parseScope, scopeIncludes } from "../src/state";

const dirs: string[] = [];
const originalEnv = process.env.OMP_ZH;

function tempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "omp-zh-state-"));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
	if (originalEnv === undefined) delete process.env.OMP_ZH;
	else process.env.OMP_ZH = originalEnv;
});

describe("配置存储", () => {
	test("默认值全开", () => {
		delete process.env.OMP_ZH;
		expect(createConfigStore(tempDir()).read()).toEqual(DEFAULT_CONFIG);
	});

	test("写入后可读回", () => {
		delete process.env.OMP_ZH;
		const dir = tempDir();
		const store = createConfigStore(dir);
		store.write({ ...DEFAULT_CONFIG, scope: "settings", capture: true });
		const file = join(dir, "omp-zh.json");
		expect(existsSync(file)).toBe(true);
		expect(JSON.parse(readFileSync(file, "utf8"))).toMatchObject({ scope: "settings", capture: true });
		expect(store.read()).toMatchObject({ scope: "settings", capture: true });
	});

	test("坏 JSON 回退默认值", () => {
		delete process.env.OMP_ZH;
		const dir = tempDir();
		writeFileSync(join(dir, "omp-zh.json"), "{ 坏数据");
		expect(createConfigStore(dir).read()).toEqual(DEFAULT_CONFIG);
	});

	test("环境变量覆盖 enabled", () => {
		const store = createConfigStore(tempDir());
		process.env.OMP_ZH = "0";
		expect(store.read().enabled).toBe(false);
		process.env.OMP_ZH = "on";
		expect(store.read().enabled).toBe(true);
	});
});

describe("scope", () => {
	test("scopeIncludes 按范围生效", () => {
		const base = { ...DEFAULT_CONFIG };
		expect(scopeIncludes(base, "settings")).toBe(true);
		expect(scopeIncludes(base, "commands")).toBe(true);
		expect(scopeIncludes({ ...base, enabled: false }, "settings")).toBe(false);
		expect(scopeIncludes({ ...base, scope: "settings" }, "commands")).toBe(false);
		expect(scopeIncludes({ ...base, scope: "commands" }, "commands")).toBe(true);
		expect(scopeIncludes({ ...base, scope: "chrome" }, "settings")).toBe(false);
	});

	test("parseScope 接受别名", () => {
		expect(parseScope("all")).toBe("all");
		expect(parseScope("settings")).toBe("settings");
		expect(parseScope("commands")).toBe("commands");
		expect(parseScope("chrome")).toBe("chrome");
		expect(parseScope("ui")).toBeUndefined();
		expect(parseScope(undefined)).toBeUndefined();
	});
});
