import type { DetectionPromptSettings } from "@/types/systemSettings";

type PromptSettingKey = keyof DetectionPromptSettings;

type PromptFacadeType = "general" | "tile" | "coating" | "plaster" | "panel" | "curtain_wall";

interface PromptSettingGroup {
  key: PromptFacadeType;
  label: string;
  options: Array<{ key: PromptSettingKey; label: string }>;
}

export const PROMPT_SETTING_GROUPS: PromptSettingGroup[] = [
  {
    key: "general",
    label: "通用设置",
    options: [
      { key: "visible_prompt", label: "裂缝 + 脱落" },
      { key: "crack_prompt", label: "裂缝" },
      { key: "spalling_prompt", label: "脱落" },
      { key: "thermal_prompt", label: "空鼓（热成像）" },
      { key: "photo_guard_prompt", label: "照片相关性判断" }
    ]
  },
  {
    key: "tile",
    label: "饰面砖",
    options: [
      { key: "tile_crack_prompt", label: "裂缝" },
      { key: "tile_spalling_prompt", label: "脱落" },
      { key: "tile_visible_prompt", label: "裂缝 + 脱落" },
      { key: "tile_thermal_prompt", label: "空鼓（热成像）" }
    ]
  },
  {
    key: "coating",
    label: "涂饰",
    options: [
      { key: "coating_crack_prompt", label: "裂缝" },
      { key: "coating_peeling_prompt", label: "起皮" },
      { key: "coating_crack_peeling_prompt", label: "裂缝 + 起皮" },
      { key: "coating_thermal_prompt", label: "空鼓（热成像）" }
    ]
  },
  {
    key: "plaster",
    label: "抹灰",
    options: [
      { key: "plaster_crack_prompt", label: "裂缝" },
      { key: "plaster_spalling_prompt", label: "脱落" },
      { key: "plaster_visible_prompt", label: "裂缝 + 脱落" },
      { key: "plaster_thermal_prompt", label: "空鼓（热成像）" }
    ]
  },
  {
    key: "panel",
    label: "饰面板",
    options: [
      { key: "panel_damage_prompt", label: "面板破损" },
      { key: "panel_spalling_prompt", label: "脱落" }
    ]
  },
  {
    key: "curtain_wall",
    label: "幕墙",
    options: [
      { key: "curtain_wall_damage_prompt", label: "面板破损" }
    ]
  }
];
