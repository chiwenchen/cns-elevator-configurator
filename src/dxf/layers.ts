// @ts-ignore
import Drawing from 'dxf-writer'

interface LayerDef {
  name: string
  aci: number
  lineStyle?: 'DASHED'
}

/**
 * Draft mode layers (11 layers)
 * ACI = AutoCAD Color Index
 */
export const DRAFT_LAYERS: LayerDef[] = [
  { name: 'SHAFT',    aci: Drawing.ACI.WHITE },
  { name: 'WALL',     aci: 8 },
  { name: 'CAR',      aci: Drawing.ACI.RED },
  { name: 'CWT',      aci: Drawing.ACI.GREEN },
  { name: 'RAIL_CAR', aci: Drawing.ACI.BLUE },
  { name: 'RAIL_CWT', aci: Drawing.ACI.CYAN },
  { name: 'DOOR',     aci: Drawing.ACI.MAGENTA },
  { name: 'CENTER',   aci: Drawing.ACI.RED, lineStyle: 'DASHED' },
  { name: 'DIMS',     aci: Drawing.ACI.YELLOW },
  { name: 'TEXT',     aci: Drawing.ACI.WHITE },
  { name: 'STOP',     aci: Drawing.ACI.GREEN },
]

/**
 * Professional mode layers (7 additional layers)
 */
export const PROFESSIONAL_LAYERS: LayerDef[] = [
  { name: 'SLING',   aci: 14 },
  { name: 'BUFFER',  aci: 34 },
  { name: 'SAFETY',  aci: 174 },
  { name: 'ROPE',    aci: 214 },
  { name: 'MACHINE', aci: 32 },
  { name: 'LANDING', aci: 154 },
]

/**
 * Register layers on a dxf-writer Drawing instance.
 * DASHED layers get a line type definition before layer registration.
 */
export function registerLayers(dw: any, layers: LayerDef[]): void {
  for (const layer of layers) {
    if (layer.lineStyle === 'DASHED') {
      dw.addLineType('DASHED', '_ _ ', [5, -5])
      dw.addLayer(layer.name, layer.aci, 'DASHED')
    } else {
      dw.addLayer(layer.name, layer.aci, 'CONTINUOUS')
    }
  }
}
