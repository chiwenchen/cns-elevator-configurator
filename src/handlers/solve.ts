/**
 * /api/solve handler — orchestrator.
 *
 * Flow:
 *   1. Load active rules from the provided RulesLoader (D1 or static)
 *   2. Build EffectiveConfig from rules + optional case override
 *   3. Solve Mode A or B with the config
 *   4. Generate DXF with the config
 *   5. Return design + dxf + analysis + stub validation report
 *
 * Throws NonStandardError or BaselineViolationError; caller converts to HTTP.
 */

import { solveModeA } from '../solver/mode-a'
import { solveModeB } from '../solver/mode-b'
import { NonStandardError } from '../solver/types'
import type { Usage, MachineLocation } from '../solver/types'
import { generateElevatorDXF } from '../dxf/generate'
import { analyzeGeneratedDxf } from './analyze-generated'
import {
  buildEffectiveConfig,
  BaselineViolationError,
} from '../config/effective'
import type { RulesLoader } from '../config/load'
import type { CaseOverride } from '../config/types'

export interface ValidationReportStub {
  summary: {
    guideline_pass: number
    guideline_warning: number
    cns_pass: number
    cns_warning: number
    total_fail: number
  }
  items: []
}

export interface SolveResponse {
  design: ReturnType<typeof solveModeA>
  dxf_string: string
  dxf_kb: number
  analysis: ReturnType<typeof analyzeGeneratedDxf>
  validation_report: ValidationReportStub
}

export async function handleSolve(
  body: any,
  loader: RulesLoader,
): Promise<SolveResponse> {
  // 1. Load rules
  const teamRules = await loader.loadActiveRules()

  // 2. Merge with case override
  const caseOverride: CaseOverride = body.caseOverride ?? {}
  const config = buildEffectiveConfig(teamRules, caseOverride)

  // 3. Solve
  const mode = String(body.mode || '').toUpperCase()
  let design: ReturnType<typeof solveModeA>
  if (mode === 'A') {
    design = solveModeA(
      {
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
      },
      config,
    )
  } else if (mode === 'B') {
    design = solveModeB(
      {
        rated_load_kg: Number(body.rated_load_kg),
        stops: Number(body.stops),
        usage: (body.usage || 'passenger') as Usage,
        machine_location: (body.machine_location || 'MR') as MachineLocation,
        rated_speed_mpm: body.rated_speed_mpm ? Number(body.rated_speed_mpm) : undefined,
        floor_height_mm: body.floor_height_mm ? Number(body.floor_height_mm) : undefined,
      },
      config,
    )
  } else {
    throw new Error(`Unknown mode: ${mode}`)
  }

  // 4. Generate DXF
  const dxfString = generateElevatorDXF(design, config)
  const analysis = analyzeGeneratedDxf(
    dxfString,
    `solver-${mode.toLowerCase()}`,
    '(in-memory)',
  )

  // 5. Stub validation report (real logic in 1c)
  const validation_report: ValidationReportStub = {
    summary: {
      guideline_pass: 0,
      guideline_warning: 0,
      cns_pass: 0,
      cns_warning: 0,
      total_fail: 0,
    },
    items: [],
  }

  return {
    design,
    dxf_string: dxfString,
    dxf_kb: Number((dxfString.length / 1024).toFixed(1)),
    analysis,
    validation_report,
  }
}

// Re-export for worker to catch
export { BaselineViolationError, NonStandardError }
