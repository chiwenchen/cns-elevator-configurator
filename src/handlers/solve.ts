/**
 * /api/solve handler — runtime-neutral。
 *
 * 輸入：JSON body（mode + Mode A 或 Mode B 參數）
 * 輸出：{ design, dxf_string, dxf_kb, analysis }
 *
 * 拋 NonStandardError 給 caller 決定 HTTP 狀態碼。
 */

import { solveModeA } from '../solver/mode-a'
import { solveModeB } from '../solver/mode-b'
import type { Usage, MachineLocation } from '../solver/types'
import { generateElevatorDXF } from '../dxf/generate'
import { analyzeGeneratedDxf } from './analyze-generated'

export function handleSolve(body: any) {
  const mode = String(body.mode || '').toUpperCase()
  let design
  if (mode === 'A') {
    design = solveModeA({
      width_mm: Number(body.width_mm),
      depth_mm: Number(body.depth_mm),
      total_height_mm: Number(body.total_height_mm),
      overhead_mm: Number(body.overhead_mm),
      pit_depth_mm: Number(body.pit_depth_mm),
      stops: Number(body.stops),
      usage: (body.usage || 'passenger') as Usage,
      preferred_speed_mpm: body.preferred_speed_mpm
        ? Number(body.preferred_speed_mpm)
        : undefined,
    })
  } else if (mode === 'B') {
    design = solveModeB({
      rated_load_kg: Number(body.rated_load_kg),
      stops: Number(body.stops),
      usage: (body.usage || 'passenger') as Usage,
      machine_location: (body.machine_location || 'MR') as MachineLocation,
      rated_speed_mpm: body.rated_speed_mpm ? Number(body.rated_speed_mpm) : undefined,
      floor_height_mm: body.floor_height_mm ? Number(body.floor_height_mm) : undefined,
    })
  } else {
    throw new Error(`Unknown mode: ${mode}`)
  }

  const dxfString = generateElevatorDXF(design)
  const analysis = analyzeGeneratedDxf(dxfString, `solver-${mode.toLowerCase()}`, '(in-memory)')
  return {
    design,
    dxf_string: dxfString,
    dxf_kb: Number((dxfString.length / 1024).toFixed(1)),
    analysis,
  }
}
