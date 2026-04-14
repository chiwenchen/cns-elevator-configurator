/**
 * Parametric DXF Writer — production 版本
 *
 * 接受 ElevatorDesign，產出含平面圖 + 側面圖 + 規格卡的 DXF 字串。
 *
 * Layers（ACI 顏色編號 — AutoCAD Color Index）：
 *   SHAFT     7  white/black  井道外牆（結構）
 *   WALL      8  dark gray    井道內壁
 *   CAR       1  red          車廂
 *   CWT       3  green        配重框
 *   RAIL_CAR  5  blue         車廂導軌
 *   RAIL_CWT  4  cyan         配重導軌
 *   DOOR      6  magenta      門扇 + 門框 + 門檻
 *   CENTER    1  red DASHED   中心線
 *   DIMS      2  yellow       尺寸線 + 標註文字
 *   TEXT      7  white        一般標籤
 *   STOP      3  green        停站水平線（elevation）
 */

// @ts-ignore
import Drawing from 'dxf-writer'
import type { ElevatorDesign } from '../solver/types'
import type { EffectiveConfig } from '../config/types'
import { drawPlanView } from './plan'
import { DRAFT_LAYERS, PROFESSIONAL_LAYERS, registerLayers } from './layers'
import { drawElevationDraft } from './elevation-draft'
import { drawPlanProfessional } from './plan-professional'
import { drawElevationProfessional } from './elevation-professional'
import { drawSpecBlock, specBlockBBox } from './spec-block'
import { drawTitleBlock, titleBlockBBox } from './title-block'

type DetailLevel = 'draft' | 'professional'

export function generateElevatorDXF(
  design: ElevatorDesign,
  config: EffectiveConfig,
  detailLevel: DetailLevel = 'draft',
): string {
  const dw = new Drawing()
  dw.setUnits('Millimeters')

  registerLayers(dw, DRAFT_LAYERS)
  if (detailLevel === 'professional') {
    registerLayers(dw, PROFESSIONAL_LAYERS)
  }

  const { shaft } = design

  // ---- PLAN VIEW ----
  drawPlanView(dw, design, { x: 0, y: 0 }, config)

  if (detailLevel === 'professional' && config.professional) {
    drawPlanProfessional(dw, design, { x: 0, y: 0 }, config.professional, config)
  }

  // ---- SIDE SECTION ELEVATION (右側) ----
  // Elevation now uses shaft DEPTH as its horizontal axis (side view, not
  // front). So the right edge of the elevation is at elevOX + shaft.depth_mm,
  // plus a dim column ~1200mm wide for OH/PIT annotations.
  const elevOX = shaft.width_mm + 4000
  const elevOY = 0
  const elevHorizontalSpan = shaft.depth_mm + 1500 // shaft + dim column
  if (detailLevel === 'professional' && config.professional) {
    drawElevationProfessional(dw, design, { x: elevOX, y: 0 }, config.professional, config)
  } else {
    drawElevationDraft(dw, design, { x: elevOX, y: elevOY }, config)
  }

  // ---- SPEC BLOCK + TITLE BLOCK (最右側, 垂直堆疊) ----
  // Spec block sits above the baseline, title block sits below it.
  // Right edges align so the stack reads as one unit.
  const specBBox = specBlockBBox(12)
  const titleBBox = titleBlockBBox()
  const specX = elevOX + elevHorizontalSpan + 1500
  const specY = 0
  drawSpecBlock(dw, design, { x: specX, y: specY }, config)

  const titleX = specX - (titleBBox.width - specBBox.width)
  const titleY = specY - titleBBox.height - 400
  drawTitleBlock(dw, design, { x: titleX, y: titleY })

  return dw.toDxfString()
}
