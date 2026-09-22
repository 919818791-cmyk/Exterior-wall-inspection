import type { DroneType } from "@/types/projects";

export const DRONE_TYPE_OPTIONS: ReadonlyArray<{
  value: DroneType;
  label: string;
}> = [
  { value: "dji_mavic_3_enterprise", label: "DJI Mavic 3 Enterprise（M3E）" },
  { value: "dji_mavic_3_thermal", label: "DJI Mavic 3 Thermal（M3T）" },
  { value: "dji_matrice_4e", label: "DJI Matrice 4E" },
  { value: "dji_matrice_4t", label: "DJI Matrice 4T" },
  { value: "dji_matrice_30", label: "DJI Matrice 30（M30）" },
  { value: "dji_matrice_30t", label: "DJI Matrice 30T（M30T）" },
  { value: "dji_matrice_300_rtk", label: "DJI Matrice 300 RTK" },
  { value: "dji_matrice_350_rtk", label: "DJI Matrice 350 RTK" },
  { value: "dji_matrice_400", label: "DJI Matrice 400" },
  { value: "dji_phantom_4_rtk", label: "DJI Phantom 4 RTK" },
  { value: "autel_evo_max_4t", label: "Autel EVO Max 4T" },
  { value: "other_professional", label: "其他专业无人机" }
];

export function getDroneTypeLabel(value: DroneType | null | undefined) {
  return DRONE_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? "未选择";
}
