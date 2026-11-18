/**
 * 设置面板汉化。
 *
 * omp 的设置面板由 `config/registry` 里的定义对象驱动：
 * `setting.ui` 是活的元数据对象，`TAB_METADATA` / `TAB_LEADS` / `TAB_GROUPS`
 * 是模块级常量对象，都被渲染层按引用读取。因此改写这些对象即可让
 * `/settings` 的标签页、分组、条目名、说明、选项、告警全部显示中文，
 * 而且不用改 omp 源码、不用重启。
 *
 * 所有原始值都会记录，`/zh off` 时原样还原。
 */
import { type PropertySnapshot, patchProperty, restoreProperty, type Translator } from "./engine";

type AnySetting = {
	id: string;
	ui?: Record<string, any> | undefined;
};

export interface SettingsPatchStats {
	settings: number;
	options: number;
	groups: number;
	tabs: number;
}

export class SettingsPatch {
	#restores: PropertySnapshot[] = [];
	#applied = false;
	#stats: SettingsPatchStats = { settings: 0, options: 0, groups: 0, tabs: 0 };
	#registry: { all(): readonly AnySetting[] } | undefined;
	#defs: { TAB_METADATA: Record<string, any>; TAB_LEADS: Record<string, any>; TAB_GROUPS: Record<string, any> } | undefined;

	get applied(): boolean {
		return this.#applied;
	}

	get stats(): SettingsPatchStats {
		return this.#stats;
	}

	async load(): Promise<boolean> {
		try {
			const registry = await import("@oh-my-pi/pi-coding-agent/config/registry");
			this.#registry = registry as unknown as { all(): readonly AnySetting[] };
		} catch {
			this.#registry = undefined;
		}
		try {
			const defs = await import("@oh-my-pi/pi-tui/overlays/settings-defs");
			this.#defs = defs as unknown as {
				TAB_METADATA: Record<string, any>;
				TAB_LEADS: Record<string, any>;
				TAB_GROUPS: Record<string, any>;
			};
		} catch {
			this.#defs = undefined;
		}
		return this.#registry !== undefined;
	}

	apply(translator: Translator): SettingsPatchStats {
		if (this.#applied) return this.#stats;
		this.#stats = { settings: 0, options: 0, groups: 0, tabs: 0 };
		this.#restores = [];

		const settings = this.#registry?.all() ?? [];
		for (const setting of settings) {
			const ui = setting.ui;
			if (!ui) continue;
			const tr = translator.setting(setting.id);
			if (tr) {
				let changed = false;
				if (ui.label !== tr[0] && this.#set(ui, "label", tr[0])) changed = true;
				const desc = tr[1];
				if (desc && ui.description !== desc && this.#set(ui, "description", desc)) changed = true;
				if (changed) this.#stats.settings++;
			}
			if (ui.group) {
				const group = translator.group(ui.group);
				if (group && group !== ui.group && this.#set(ui, "group", group)) this.#stats.groups++;
			}
			if (ui.warning) {
				const warning = translator.text(ui.warning);
				if (warning !== ui.warning) this.#set(ui, "warning", warning);
			}
			const options = ui.options;
			if (Array.isArray(options)) {
				for (const option of options) {
					if (!option || typeof option !== "object") continue;
					this.#translateOption(option, translator, "label");
					this.#translateOption(option, translator, "description");
				}
			}
		}

		this.#translateGroups(translator);
		this.#translateTabs(translator);

		this.#applied = true;
		return this.#stats;
	}

	#translateOption(option: Record<string, any>, translator: Translator, key: string): void {
		const value = option[key];
		if (typeof value !== "string") return;
		const zh = key === "label" ? translator.option(value) : translator.text(value);
		if (!zh || zh === value) return;
		if (this.#set(option, key, zh)) this.#stats.options++;
	}

	#translateGroups(translator: Translator): void {
		const groups = this.#defs?.TAB_GROUPS;
		if (!groups) return;
		for (const tab of Object.keys(groups)) {
			const arr = groups[tab];
			if (!Array.isArray(arr)) continue;
			for (let i = 0; i < arr.length; i++) {
				const group = translator.group(arr[i]);
				if (!group || group === arr[i]) continue;
				this.#set(arr, String(i), group);
			}
		}
	}

	#translateTabs(translator: Translator): void {
		const defs = this.#defs;
		if (!defs) return;
		for (const tab of Object.keys(defs.TAB_METADATA ?? {})) {
			const meta = defs.TAB_METADATA[tab];
			const label = translator.tab(tab);
			if (meta && label && meta.label !== label && this.#set(meta, "label", label)) this.#stats.tabs++;
		}
		for (const tab of Object.keys(defs.TAB_LEADS ?? {})) {
			const lead = translator.lead(tab);
			if (lead && defs.TAB_LEADS[tab] !== lead) this.#set(defs.TAB_LEADS as Record<string, any>, tab, lead);
		}
	}

	/** 只记录真正改写成功的属性，还原时按描述符放回（含只读 getter）。 */
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
