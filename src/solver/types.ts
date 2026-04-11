/**
 * 核心 pipeline 交換格式。每一個 solver 的輸入輸出都經過這幾個型別。
 */

export type Usage = 'passenger' | 'freight' | 'bed' | 'accessible'
export type MachineLocation = 'MR' | 'MRL'
export type DoorType = 'side_opening' | 'center_opening'
export type SolverMode = 'A' | 'B'

/**
 * Mode A 輸入：使用者已知坑道，要求系統推算電梯設計
 */
export interface ShaftSpec {
  width_mm: number
  depth_mm: number
  total_height_mm: number
  overhead_mm: number
  pit_depth_mm: number
  stops: number
  usage: Usage
  /** 可選：若使用者對速度有偏好 */
  preferred_speed_mpm?: number
}

/**
 * Mode B 輸入：使用者已知需求，要求系統推算最小坑道
 */
export interface ElevatorRequirement {
  rated_load_kg: number
  stops: number
  usage: Usage
  machine_location: MachineLocation
  /** 預設 60 m/min (1 m/s) */
  rated_speed_mpm?: number
  /** 預設 3000 mm */
  floor_height_mm?: number
}

/**
 * Solver 輸出 = Validator / DXF Writer 輸入
 */
export interface ElevatorDesign {
  shaft: {
    width_mm: number
    depth_mm: number
    total_height_mm: number
    overhead_mm: number
    pit_depth_mm: number
    stops: number
    usage: Usage
  }
  car: {
    width_mm: number
    depth_mm: number
    height_mm: number
    area_m2: number
  }
  door: {
    width_mm: number
    type: DoorType
  }
  rated_load_kg: number
  rated_speed_mpm: number
  machine_location: MachineLocation
  /** 從哪個 solver 路徑產出 */
  solver_mode: SolverMode
  /** 產生時的 timestamp (ISO string) */
  generated_at: string
}

/**
 * 解算錯誤 — 非標或不可行的輸入。
 * 這是 Mode A / Mode B solver 都可能拋的例外。
 */
export class NonStandardError extends Error {
  constructor(
    message: string,
    public readonly reason: string,
    public readonly suggestion?: string
  ) {
    super(message)
    this.name = 'NonStandardError'
  }
}
