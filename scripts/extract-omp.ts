/**
 * 从上游 omp 源码抽取「设置项 ui 元数据」与「斜杠命令说明」，用于校对与补全词表。
 *
 * 用法：
 *   bun scripts/extract-omp.ts [上游源码根目录]
 *   默认 ../oh-my-pi，或读 $OMP_SOURCE。
 *
 * 产物写到 catalog/_extract/（不参与运行时）：
 *   settings.json —— [{ id, tab, group, label, description, options[] }]
 *   commands.json —— [{ id, file, description }]，id 形如 advisor 或 advisor:on
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const source = process.argv[2] ?? process.env.OMP_SOURCE ?? resolve(root, "../oh-my-pi");
const outDir = resolve(root, "catalog/_extract");

const COMMAND_FILES = [
	"builtin-collaboration.ts",
	"builtin-commit.ts",
	"builtin-control.ts",
	"builtin-lifecycle.ts",
	"builtin-marketplace.ts",
	"builtin-modes.ts",
	"builtin-session.ts",
	"builtin-skills.ts",
];

/** 把字符串与注释位置替换成下划线，保持长度与换行不变，便于按括号定位。 */
function maskLiterals(code: string): string {
	const out = [...code];
	let i = 0;
	while (i < code.length) {
		const ch = code[i];
		if (ch === "/" && code[i + 1] === "/") {
			while (i < code.length && code[i] !== "\n") i++;
			continue;
		}
		if (ch === "/" && code[i + 1] === "*") {
			const end = code.indexOf("*/", i + 2);
			const stop = end === -1 ? code.length : end + 2;
			for (let k = i; k < stop; k++) if (out[k] !== "\n") out[k] = "_";
			i = stop;
			continue;
		}
		if (ch === "'" || ch === '"' || ch === "`") {
			let j = i + 1;
			while (j < code.length) {
				if (code[j] === "\\") {
					j += 2;
					continue;
				}
				if (code[j] === ch) break;
				j++;
			}
			for (let k = i; k <= j && k < code.length; k++) if (out[k] !== "\n") out[k] = "_";
			i = j + 1;
			continue;
		}
		i++;
	}
	return out.join("");
}

/** 从开括号位置取到匹配的闭括号之后的切片。 */
function blockAt(masked: string, openIndex: number): string {
	const open = masked[openIndex];
	const close = open === "{" ? "}" : "]";
	let depth = 0;
	for (let i = openIndex; i < masked.length; i++) {
		if (masked[i] === open) depth++;
		else if (masked[i] === close) {
			depth--;
			if (depth === 0) return masked.slice(openIndex + 1, i);
		}
	}
	return masked.slice(openIndex + 1);
}

function stringAfter(code: string, masked: string, key: string, within?: [number, number]): string | undefined {
	const slice = within ? code.slice(within[0], within[1]) : code;
	const maskedSlice = within ? masked.slice(within[0], within[1]) : masked;
	const m = new RegExp(`${key}\\s*:\\s*`, "g").exec(maskedSlice);
	if (!m) return undefined;
	const at = (within?.[0] ?? 0) + m.index + m[0].length;
	const quote = code.slice(at, at + 4).match(/\s*(["'`])/);
	if (!quote) return undefined;
	const start = at + quote[0].length;
	let j = start;
	while (j < code.length && code[j] !== quote[1]) {
		j += code[j] === "\\" ? 2 : 1;
	}
	const body = code.slice(start, j);
	return body.includes("${") ? undefined : body;
}

interface SettingDef {
	id: string;
	tab?: string;
	group?: string;
	label?: string;
	description?: string;
	options: string[];
}

function extractSettings(code: string): SettingDef[] {
	const masked = maskLiterals(code);
	const defs: SettingDef[] = [];
	for (const m of masked.matchAll(/register\(\s*\{/g)) {
		const body = blockAt(masked, m.index! + m[0].length - 1);
		const offset = m.index! + m[0].length;
		const id = stringAfter(code, masked, "id", [offset, offset + body.length]);
		if (!id) continue;
		const uiMatch = /ui\s*:\s*\{/.exec(masked.slice(offset, offset + body.length));
		if (!uiMatch) continue;
		const brace = offset + uiMatch.index + uiMatch[0].length - 1;
		const uiBody = blockAt(masked, brace);
		const uiEnd = brace + uiBody.length + 2;
		const label = stringAfter(code, masked, "label", [brace, uiEnd]);
		const description = stringAfter(code, masked, "description", [brace, uiEnd]);
		const tab = stringAfter(code, masked, "tab", [brace, uiEnd]);
		const group = stringAfter(code, masked, "group", [brace, uiEnd]);
		const options: string[] = [];
		const optMatch = /options\s*:\s*\[/.exec(uiBody);
		if (optMatch) {
			const bracket = brace + optMatch.index + optMatch[0].length - 1;
			const optBody = blockAt(masked, bracket);
			for (const m2 of optBody.matchAll(/label\s*:\s*(["'`])((?:\\.|(?!\1).)*)\1/g)) {
				if (!m2[2].includes("${")) options.push(m2[2]);
			}
		}
		defs.push({ id, tab, group, label, description, options });
	}
	return defs;
}

interface CommandDef {
	id: string;
	file: string;
	description?: string;
}

function extractCommands(code: string, file: string): CommandDef[] {
	const masked = maskLiterals(code);
	const names: Array<{ name: string; depth: number; index: number; description?: string }> = [];
	let depth = 0;
	for (let i = 0; i < masked.length; i++) {
		const ch = masked[i];
		if (ch === "{" || ch === "[") depth++;
		else if (ch === "}" || ch === "]") depth--;
		if (ch !== "n") continue;
		if (!masked.startsWith("name", i)) continue;
		const name = stringAfter(code, masked, "name", [i, i + 200]);
		if (!name) continue;
		names.push({ name, depth, index: i, description: stringAfter(code, masked, "description", [i, i + 2000]) });
	}
	return names.map(entry => {
		let parent: (typeof names)[number] | undefined;
		for (const other of names) {
			if (other.index >= entry.index) break;
			if (other.depth < entry.depth) parent = other;
		}
		return {
			id: parent ? `${parent.name}:${entry.name}` : entry.name,
			file,
			description: entry.description,
		};
	});
}

const settings: SettingDef[] = [];
const configDir = resolve(source, "packages/coding-agent/src");
if (existsSync(configDir)) {
	for await (const entry of new Bun.Glob("**/*.ts").scan({ cwd: configDir })) {
		settings.push(...extractSettings(await Bun.file(resolve(configDir, entry)).text()));
	}
}

const commands: CommandDef[] = [];
const slashDir = resolve(source, "packages/coding-agent/src/slash-commands");
for (const name of COMMAND_FILES) {
	const path = resolve(slashDir, name);
	if (!(await Bun.file(path).exists())) continue;
	commands.push(...extractCommands(await Bun.file(path).text(), name.replace(/\.ts$/, "")));
}

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "settings.json"), `${JSON.stringify(settings, null, "\t")}\n`);
writeFileSync(resolve(outDir, "commands.json"), `${JSON.stringify(commands, null, "\t")}\n`);

console.log(`源码：${source}`);
console.log(`设置项：${settings.length}（带 label 的 ${settings.filter(s => s.label).length}）`);
console.log(`命令：${commands.length}`);
console.log(`产物：${outDir}`);
