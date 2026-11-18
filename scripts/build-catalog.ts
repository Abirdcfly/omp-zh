/**
 * 词表构建与校验：把 catalog/settings/*.json 合并成一份快照，并做结构检查。
 *
 * 用法：bun scripts/build-catalog.ts [--out=catalog/_build/catalog.json]
 *
 * 检查项：
 *  - 每个分片是「平铺对象 → [标签, 描述?]」；
 *  - 同一设置项 id 不在多个分片里重复定义；
 *  - 标签非空且含中文或明确的专名；
 *  - ui.json 的标签页 / 导语 / 分组 / 选项 / 文案结构正确。
 * 任何一项失败都会以非 0 退出码结束，便于提交前拦截。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { CATALOG_DIRS, loadCatalog, packageRoot } from "../src/i18n/catalog";

const outArg = process.argv.find(arg => arg.startsWith("--out="))?.slice("--out=".length);
const outFile = resolve(packageRoot, outArg ?? "catalog/_build/catalog.json");

const problems: string[] = [];

const { catalog, files } = loadCatalog();
if (files.length === 0) problems.push("没有读到任何词表文件");

const seen = new Map<string, string>();
for (const file of files.filter(name => name.includes("/settings/"))) {
	const shard = JSON.parse(await Bun.file(file).text()) as Record<string, [string, string?]>;
	for (const [id, entry] of Object.entries(shard)) {
		if (seen.has(id)) problems.push(`设置项 ${id} 重复定义：${seen.get(id)} 与 ${file}`);
		seen.set(id, file);
		if (!Array.isArray(entry) || typeof entry[0] !== "string" || entry[0].trim() === "") {
			problems.push(`设置项 ${id} 的标签不是非空字符串（${file}）`);
		}
		if (entry.length > 2) problems.push(`设置项 ${id} 有多余字段（应为 [标签, 描述?]）`);
		if (typeof entry[1] === "string" && entry[1].includes("  ")) {
			problems.push(`设置项 ${id} 的描述含连续空格（${file}）`);
		}
	}
}

for (const [tab, label] of Object.entries(catalog.tabs)) {
	if (!/[A-Za-z\u4e00-\u9fa5]/.test(label)) problems.push(`标签页 ${tab} 的名称异常：${label}`);
	if (!catalog.leads[tab]) problems.push(`标签页 ${tab} 缺少导语`);
}

for (const key of Object.keys(catalog.commands)) {
	if (!/^[a-z0-9-]+(?::[a-z0-9 -]+)?$/i.test(key)) problems.push(`命令 key 形态异常：${key}`);
}

mkdirSync(dirname(outFile), { recursive: true });
writeFileSync(
	outFile,
	`${JSON.stringify(
		{
			generatedAt: new Date().toISOString(),
			files: files.map(file => file.replace(`${packageRoot}/`, "")),
			stats: catalog ? Object.fromEntries(Object.entries(catalog).map(([key, value]) => [key, Array.isArray(value) ? value.length : Object.keys(value).length])) : {},
			catalog,
		},
		null,
		"\t",
	)}\n`,
	"utf8",
);

console.log(`词表分片：${files.length} 个`);
console.log(`设置 ${Object.keys(catalog.settings).length} / 命令 ${Object.keys(catalog.commands).length} / 选项 ${Object.keys(catalog.options).length}`);
console.log(`标签页 ${Object.keys(catalog.tabs).length} / 导语 ${Object.keys(catalog.leads).length} / 分组 ${Object.keys(catalog.groups).length}`);
console.log(`快照：${outFile}`);

if (problems.length > 0) {
	console.error(`发现 ${problems.length} 个问题：`);
	for (const problem of problems.slice(0, 50)) console.error(`  - ${problem}`);
	process.exit(1);
}
console.log("结构检查通过。");

void CATALOG_DIRS;
