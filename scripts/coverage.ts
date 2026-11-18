/**
 * 覆盖率校验：对比上游 omp 18.22.2 的设置项清单与本仓库词表，列出缺口。
 *
 * 清单来源优先级：
 *  1. 当前已安装的 omp 运行时（能从 @oh-my-pi/pi-coding-agent/config/registry 读到 ui 元数据时以实时数据为准）；
 *  2. scripts/manifest/settings-18.22.2.json —— 基线版本 18.22.2 的离线快照。
 *
 * 只做只读统计。存在缺口时退出码为 1，便于 CI 拦住“少翻一条设置”的提交。
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { loadCatalog, packageRoot } from "../src/i18n/catalog";

interface Def {
	id: string;
	tab?: string | null;
	label?: string | null;
}

const manifestPath = resolve(packageRoot, "scripts/manifest/settings-18.22.2.json");

async function fromRuntime(): Promise<Def[]> {
	try {
		const registry = (await import("@oh-my-pi/pi-coding-agent/config/registry")) as any;
		const all = typeof registry.all === "function" ? registry.all() : [];
		return all
			.filter((setting: any) => setting?.ui?.label)
			.map((setting: any) => ({ id: setting.id, tab: setting.ui.tab, label: setting.ui.label }));
	} catch {
		return [];
	}
}

async function fromManifest(): Promise<Def[]> {
	if (!existsSync(manifestPath)) return [];
	try {
		return (await Bun.file(manifestPath).json()) as Def[];
	} catch {
		return [];
	}
}

const runtimeDefs = await fromRuntime();
const defs = runtimeDefs.length > 0 ? runtimeDefs : await fromManifest();
const origin = runtimeDefs.length > 0 ? "运行时 registry" : "18.22.2 快照";

const { catalog, files } = loadCatalog();

if (defs.length === 0) {
	console.error("找不到设置项清单：既读不到运行时 registry，也没有 scripts/manifest/settings-18.22.2.json。");
	process.exit(2);
}

const missing = defs.filter(def => !catalog.settings[def.id]);
const perTab = new Map<string, { total: number; done: number }>();
for (const def of defs) {
	const key = def.tab ?? "(none)";
	const row = perTab.get(key) ?? { total: 0, done: 0 };
	row.total++;
	if (catalog.settings[def.id]) row.done++;
	perTab.set(key, row);
}

console.log(`清单来源：${origin}（${defs.length} 条）`);
console.log(`词表文件：${files.length} 个`);
console.log(
	`设置 ${Object.keys(catalog.settings).length} / 命令 ${Object.keys(catalog.commands).length} / 选项 ${Object.keys(catalog.options).length} / 界面文案 ${Object.keys(catalog.exact).length}`,
);
console.log(`标签页 ${Object.keys(catalog.tabs).length} / 导语 ${Object.keys(catalog.leads).length} / 分组 ${Object.keys(catalog.groups).length}`);
console.log("按标签页：");
for (const [tab, row] of [...perTab.entries()].sort()) {
	const pct = Math.round((row.done / row.total) * 100);
	console.log(`  ${tab.padEnd(12)} ${String(row.done).padStart(3)}/${String(row.total).padStart(3)}  ${pct}%  词表名：${catalog.tabs[tab] ?? "—"}`);
}

if (missing.length > 0) {
	console.log(`覆盖缺口 ${missing.length} 条：`);
	for (const def of missing.slice(0, 80)) console.log(`  - ${def.id}\t${def.label ?? ""}`);
	process.exit(1);
}

console.log(`设置面板覆盖率 100%（${defs.length}/${defs.length}）。`);
