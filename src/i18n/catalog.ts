/**
 * 词表加载：直接读磁盘，支持 /zh-cn reload 热更新（不依赖 import 缓存）。
 *
 * 词表分三处：
 *  - catalog/settings/*.json —— 按设置面板标签页切片的设置项词表；
 *  - catalog/ui.json        —— 标签页名、导语、分组、选项标签与界面文案；
 *  - catalog/commands.json  —— 斜杠命令与子命令说明。
 *
 * 分片是纯数据文件，新增分片无需改代码。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { type Catalog, emptyCatalog, mergeCatalog } from "./engine";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");

export const CATALOG_DIRS = {
	settings: resolve(root, "catalog/settings"),
	ui: resolve(root, "catalog/ui.json"),
	commands: resolve(root, "catalog/commands.json"),
} as const;

function readJson<T>(path: string, fallback: T): T {
	try {
		if (!existsSync(path)) return fallback;
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return fallback;
	}
}

/** catalog/settings/*.json，按文件名排序保证合并顺序稳定。 */
function readSettingShards(): Array<{ file: string; entries: Record<string, [string, string?]> }> {
	const dir = CATALOG_DIRS.settings;
	if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
	const files = readdirSync(dir)
		.filter(name => name.endsWith(".json"))
		.sort();
	const shards: Array<{ file: string; entries: Record<string, [string, string?]> }> = [];
	for (const name of files) {
		const file = join(dir, name);
		const entries = readJson<Record<string, [string, string?]>>(file, {});
		if (Object.keys(entries).length === 0) continue;
		shards.push({ file, entries });
	}
	return shards;
}

export interface LoadedCatalog {
	catalog: Catalog;
	files: string[];
}

/** 读取并合并全部词表；缺文件或坏 JSON 不影响其余部分。 */
export function loadCatalog(): LoadedCatalog {
	const files: string[] = [];
	const parts: Partial<Catalog>[] = [];

	const settings: Record<string, [string, string?]> = {};
	for (const shard of readSettingShards()) {
		Object.assign(settings, shard.entries);
		files.push(shard.file);
	}
	parts.push({ settings });

	const ui = readJson<Partial<Catalog>>(CATALOG_DIRS.ui, {});
	if (Object.keys(ui).length > 0) {
		files.push(CATALOG_DIRS.ui);
		parts.push(ui);
	}

	const commands = readJson<Partial<Catalog>>(CATALOG_DIRS.commands, {});
	if (Object.keys(commands).length > 0) {
		files.push(CATALOG_DIRS.commands);
		parts.push({ commands });
	}

	const catalog = parts.length > 0 ? mergeCatalog(...parts) : emptyCatalog();
	return { catalog, files };
}

export { root as packageRoot };
