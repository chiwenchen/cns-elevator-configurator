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
import { drawSpecBlock } from './spec-block'

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

  // ---- ELEVATION VIEW (右側) ----
  const elevOX = shaft.width_mm + 4000
  const elevOY = 0
  if (detailLevel === 'professional' && config.professional) {
    drawElevationProfessional(dw, design, { x: elevOX, y: 0 }, config.professional, config)
  } else {
    drawElevationDraft(dw, design, { x: elevOX, y: elevOY })
  }

  // ---- SPEC BLOCK (最右, 對齊 plan view 頂端) ----
  const specX = elevOX + shaft.width_mm + 3500
  const specY = shaft.depth_mm + 500
  drawSpecBlock(dw, design, { x: specX, y: specY })

  return dw.toDxfString()
}
