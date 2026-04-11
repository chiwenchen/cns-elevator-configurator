#!/usr/bin/env bun
/**
 * Solver CLI
 *
 * Mode A 範例：
 *   bun src/solver/cli.ts mode-a \
 *     --shaft 2000x2200x18000 --overhead 4200 --pit 1600 \
 *     --stops 6 --usage passenger
 *
 * Mode B 範例：
 *   bun src/solver/cli.ts mode-b \
 *     --load 500 --stops 6 --usage passenger --machine MR
 *
 * 輸出：
 *   stdout → ElevatorDesign JSON
 *   --out <path> → 同時寫 DXF 檔到 path
 */

import { solveModeA } from './mode-a'
import { solveModeB } from './mode-b'
import { NonStandardError } from './types'
import { generateElevatorDXF } from '../dxf/generate'
import type { Usage, MachineLocation } from './types'

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2)
      const val = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : 'true'
      out[key] = val
      if (val !== 'true') i++
    }
  }
  return out
}

function parseShaft(str: string): { w: number; d: number; h: number } {
  const parts = str.toLowerCase().split('x').map((s) => parseInt(s, 10))
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid --shaft format: ${str} (expected WxDxH e.g. 2000x2200x18000)`)
  }
  return { w: parts[0], d: parts[1], h: parts[2] }
}

function printUsage() {
  console.error(`
Solver CLI

Mode A (空間 → 電梯):
  bun src/solver/cli.ts mode-a --shaft WxDxH --overhead N --pit N --stops N --usage passenger|freight|bed|accessible
  [--speed 60] [--out /path/to/output.dxf]

Mode B (需求 → 空間):
  bun src/solver/cli.ts mode-b --load kg --stops N --usage passenger|freight|bed|accessible --machine MR|MRL
  [--speed 60] [--out /path/to/output.dxf]

Examples:
  bun src/solver/cli.ts mode-a --shaft 2000x2200x18000 --overhead 4200 --pit 1600 --stops 6 --usage passenger
  bun src/solver/cli.ts mode-b --load 500 --stops 6 --usage passenger --machine MR
`)
}

const [mode, ...rest] = process.argv.slice(2)

if (!mode || mode === '--help' || mode === '-h') {
  printUsage()
  process.exit(0)
}

const args = parseArgs(rest)

try {
  let design
  if (mode === 'mode-a') {
    const shaft = parseShaft(args.shaft || '')
    design = solveModeA({
      width_mm: shaft.w,
      depth_mm: shaft.d,
      total_height_mm: shaft.h,
      overhead_mm: parseInt(args.overhead, 10),
      pit_depth_mm: parseInt(args.pit, 10),
      stops: parseInt(args.stops, 10),
      usage: (args.usage || 'passenger') as Usage,
      preferred_speed_mpm: args.speed ? parseInt(args.speed, 10) : undefined,
    })
  } else if (mode === 'mode-b') {
    design = solveModeB({
      rated_load_kg: parseInt(args.load, 10),
      stops: parseInt(args.stops, 10),
      usage: (args.usage || 'passenger') as Usage,
      machine_location: (args.machine || 'MR') as MachineLocation,
      rated_speed_mpm: args.speed ? parseInt(args.speed, 10) : undefined,
      floor_height_mm: args['floor-height']
        ? parseInt(args['floor-height'], 10)
        : undefined,
    })
  } else {
    console.error(`Unknown mode: ${mode}`)
    printUsage()
    process.exit(2)
  }

  console.log(JSON.stringify(design, null, 2))

  if (args.out) {
    const dxf = generateElevatorDXF(design)
    await Bun.write(args.out, dxf)
    console.error(`\nDXF written: ${args.out} (${(dxf.length / 1024).toFixed(1)} KB)`)
  }
} catch (err) {
  if (err instanceof NonStandardError) {
    console.error(`\n非標輸入：${err.message}`)
    console.error(`reason: ${err.reason}`)
    if (err.suggestion) console.error(`suggestion: ${err.suggestion}`)
    process.exit(3)
  }
  throw err
}
