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

// ---- Request body validation ----

const VALID_USAGES: Usage[] = ['passenger', 'freight', 'bed', 'accessible']
const VALID_MACHINE_LOCATIONS: MachineLocation[] = ['MR', 'MRL']

export interface ValidatedSolveBody {
  mode: 'A' | 'B'
  caseOverride: CaseOverride
  stops: number
  usage: Usage
  // Mode A fields
  width_mm?: number
  depth_mm?: number
  total_height_mm?: number
  overhead_mm?: number
  pit_depth_mm?: number
  preferred_speed_mpm?: number
  // Mode B fields
  rated_load_kg?: number
  rated_speed_mpm?: number
  floor_height_mm?: number
  machine_location?: MachineLocation
}

export class InvalidSolveBodyError extends Error {
  constructor(message: string, public readonly field: string) {
    super(message)
    this.name = 'InvalidSolveBodyError'
  }
}

function isPositiveNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v) && v > 0
}

export function parseSolveBody(raw: unknown): ValidatedSolveBody {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new InvalidSolveBodyError('Request body must be a JSON object', 'body')
  }
  const body = raw as Record<string, unknown>

  // mode
  const modeRaw = typeof body.mode === 'string' ? body.mode.toUpperCase() : ''
  if (modeRaw !== 'A' && modeRaw !== 'B') {
    throw new InvalidSolveBodyError(`Invalid mode: ${String(body.mode)}`, 'mode')
  }
  const mode = modeRaw as 'A' | 'B'

  // stops
  const stopsRaw = body.stops
  if (
    typeof stopsRaw !== 'number' ||
    !Number.isInteger(stopsRaw) ||
    stopsRaw < 2
  ) {
    throw new InvalidSolveBodyError(
      `stops must be integer >= 2, got ${String(stopsRaw)}`,
      'stops',
    )
  }

  // usage
  const usage = (body.usage ?? 'passenger') as Usage
  if (!VALID_USAGES.includes(usage)) {
    throw new InvalidSolveBodyError(`Invalid usage: ${String(usage)}`, 'usage')
  }

  // caseOverride — must be a plain object if provided
  let caseOverride: CaseOverride = {}
  if (body.caseOverride !== undefined && body.caseOverride !== null) {
    if (typeof body.caseOverride !== 'object' || Array.isArray(body.caseOverride)) {
      throw new InvalidSolveBodyError(
        'caseOverride must be an object',
        'caseOverride',
      )
    }
    caseOverride = body.caseOverride as CaseOverride
  }

  const parsed: ValidatedSolveBody = {
    mode,
    caseOverride,
    stops: stopsRaw,
    usage,
  }

  if (mode === 'A') {
    const required: Array<keyof ValidatedSolveBody> = [
      'width_mm',
      'depth_mm',
      'total_height_mm',
      'overhead_mm',
      'pit_depth_mm',
    ]
    for (const field of required) {
      const v = body[field as string]
      if (!isPositiveNumber(v)) {
        throw new InvalidSolveBodyError(
          `${String(field)} must be a positive number for mode A`,
          String(field),
        )
      }
      ;(parsed as unknown as Record<string, unknown>)[field as string] = v
    }
    if (body.preferred_speed_mpm !== undefined) {
      if (!isPositiveNumber(body.preferred_speed_mpm)) {
        throw new InvalidSolveBodyError(
          'preferred_speed_mpm must be a positive number',
          'preferred_speed_mpm',
        )
      }
      parsed.preferred_speed_mpm = body.preferred_speed_mpm
    }
  } else {
    // Mode B
    if (!isPositiveNumber(body.rated_load_kg)) {
      throw new InvalidSolveBodyError(
        'rated_load_kg must be a positive number for mode B',
        'rated_load_kg',
      )
    }
    parsed.rated_load_kg = body.rated_load_kg

    const machineLocation = (body.machine_location ?? 'MR') as MachineLocation
    if (!VALID_MACHINE_LOCATIONS.includes(machineLocation)) {
      throw new InvalidSolveBodyError(
        `Invalid machine_location: ${String(machineLocation)}`,
        'machine_location',
      )
    }
    parsed.machine_location = machineLocation

    if (body.rated_speed_mpm !== undefined) {
      if (!isPositiveNumber(body.rated_speed_mpm)) {
        throw new InvalidSolveBodyError(
          'rated_speed_mpm must be a positive number',
          'rated_speed_mpm',
        )
      }
      parsed.rated_speed_mpm = body.rated_speed_mpm
    }
    if (body.floor_height_mm !== undefined) {
      if (!isPositiveNumber(body.floor_height_mm)) {
        throw new InvalidSolveBodyError(
          'floor_height_mm must be a positive number',
          'floor_height_mm',
        )
      }
      parsed.floor_height_mm = body.floor_height_mm
    }
  }

  return parsed
}

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
  rawBody: unknown,
  loader: RulesLoader,
): Promise<SolveResponse> {
  // 0. Validate request body
  const body = parseSolveBody(rawBody)

  // 1. Load rules
  const teamRules = await loader.loadActiveRules()

  // 2. Merge with case override
  const config = buildEffectiveConfig(teamRules, body.caseOverride)

  // 3. Solve
  let design: ReturnType<typeof solveModeA>
  if (body.mode === 'A') {
    design = solveModeA(
      {
        width_mm: body.width_mm as number,
        depth_mm: body.depth_mm as number,
        total_height_mm: body.total_height_mm as number,
        overhead_mm: body.overhead_mm as number,
        pit_depth_mm: body.pit_depth_mm as number,
        stops: body.stops,
        usage: body.usage,
        preferred_speed_mpm: body.preferred_speed_mpm,
      },
      config,
    )
  } else {
    design = solveModeB(
      {
        rated_load_kg: body.rated_load_kg as number,
        stops: body.stops,
        usage: body.usage,
        machine_location: body.machine_location as MachineLocation,
        rated_speed_mpm: body.rated_speed_mpm,
        floor_height_mm: body.floor_height_mm,
      },
      config,
    )
  }

  // 4. Generate DXF
  const dxfString = generateElevatorDXF(design, config)
  const analysis = analyzeGeneratedDxf(
    dxfString,
    `solver-${body.mode.toLowerCase()}`,
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
// InvalidSolveBodyError is already exported from its declaration above.
