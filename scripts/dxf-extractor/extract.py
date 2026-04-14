#!/usr/bin/env python3
"""
DXF/DWG Pattern Extractor for elevator drawings.

Extracts a structured JSON summary of an elevator CAD drawing so multiple
manufacturer drawings can be compared side-by-side to reveal industry
consensus vs. company-specific style.

Usage:
    ./extract.py FILE.dwg [FILE2.dwg ...] [-o OUT.json] [--pretty] [--compare]

Requires:
    - ezdxf           (pip install ezdxf)
    - dwg2dxf         (libredwg) for DWG inputs; DXF inputs pass straight through.

Discovery order for dwg2dxf:
    1. $PATH
    2. /tmp/libredwg/programs/dwg2dxf  (our in-tree build)
    3. ~/.local/bin/dwg2dxf
    4. /opt/homebrew/bin/dwg2dxf
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
from collections import Counter
from pathlib import Path
from typing import Any

import ezdxf
from ezdxf.document import Drawing


# --------------------------------------------------------------------------
# DWG → DXF conversion
# --------------------------------------------------------------------------

DWG2DXF_SEARCH_PATHS = [
    '/tmp/libredwg/programs/dwg2dxf',
    f'{Path.home()}/.local/bin/dwg2dxf',
    '/opt/homebrew/bin/dwg2dxf',
    '/usr/local/bin/dwg2dxf',
]


def find_dwg2dxf() -> str | None:
    # $PATH first
    try:
        r = subprocess.run(['which', 'dwg2dxf'], capture_output=True, text=True)
        if r.returncode == 0 and r.stdout.strip():
            return r.stdout.strip()
    except Exception:
        pass
    for p in DWG2DXF_SEARCH_PATHS:
        if Path(p).is_file():
            return p
    return None


def dwg_to_dxf(dwg_path: str) -> str:
    tool = find_dwg2dxf()
    if not tool:
        raise RuntimeError(
            'dwg2dxf not found. Build libredwg (see scripts/dxf-extractor/README.md) '
            'or place dwg2dxf on PATH.'
        )
    # dwg2dxf refuses to overwrite; point it at a path that does not yet exist.
    tmp_dir = tempfile.mkdtemp(prefix='dxf-extract-')
    out_path = str(Path(tmp_dir) / (Path(dwg_path).stem + '.dxf'))
    env = os.environ.copy()
    maybe_libs = Path(tool).parent.parent / 'src' / '.libs'
    if maybe_libs.is_dir():
        env['DYLD_LIBRARY_PATH'] = str(maybe_libs)
    r = subprocess.run(
        [tool, '-o', out_path, dwg_path],
        capture_output=True, text=True, env=env,
    )
    # libredwg prints warnings on stderr but still writes a usable DXF.
    # Trust the output file rather than the exit code.
    if not Path(out_path).is_file() or Path(out_path).stat().st_size < 1024:
        raise RuntimeError(f'dwg2dxf produced no output: {r.stderr[-500:]}')
    return out_path


def prepare_dxf(path: str) -> tuple[str, bool]:
    """Return (dxf_path, is_temp). Converts DWG if needed."""
    p = Path(path)
    if p.suffix.lower() == '.dxf':
        return (str(p), False)
    if p.suffix.lower() == '.dwg':
        return (dwg_to_dxf(str(p)), True)
    raise ValueError(f'Unsupported extension: {p.suffix}')


# --------------------------------------------------------------------------
# Text cleaning
# --------------------------------------------------------------------------

_MTEXT_FORMAT_CODE = re.compile(r'\\[a-zA-Z]+[^;]*;')
_BRACES = re.compile(r'[\{\}]')


def clean_text(raw: str) -> str:
    """Strip DXF MTEXT formatting codes and paragraph breaks."""
    t = _MTEXT_FORMAT_CODE.sub('', raw)
    t = _BRACES.sub('', t)
    t = t.replace('\\P', ' ').replace('\n', ' ')
    return ' '.join(t.split())


# --------------------------------------------------------------------------
# Layer classification
# --------------------------------------------------------------------------

_STANDARD_LAYERS = {
    '0', '00', 'Defpoints', 'DEFPOINTS', 'DIM', 'VIEWPORTS',
    'BORDER', 'SHEET', 'REVISIONING', '1', '4', 'C',
}
_LINEWEIGHT_PATTERN = re.compile(r'^(CONT|DASH|DASHD|DASHDD|DOT|HATCH|FREE|TEXT|DIM)_\d+$')
_SEMANTIC_JP_PATTERN = re.compile(r'^E\d+[-_]')
_SEMANTIC_EN_PATTERN = re.compile(r'^[A-Z][a-zA-Z][a-zA-Z_ ]+$')


def classify_layer(name: str) -> str:
    n = name.strip()
    if n in _STANDARD_LAYERS:
        return 'standard'
    if _LINEWEIGHT_PATTERN.match(n):
        return 'lineweight'
    if _SEMANTIC_JP_PATTERN.match(n):
        return 'semantic_japanese'
    if re.search(r'[\u4e00-\u9fff]', n):
        return 'semantic_cjk'
    if _SEMANTIC_EN_PATTERN.match(n):
        return 'semantic_english'
    return 'other'


# --------------------------------------------------------------------------
# Dimension variables (industry-standard shorthand)
# --------------------------------------------------------------------------

DIM_VARIABLES = {
    'HH': 'Hall door Height',
    'HR': 'Hall Rough opening height',
    'CH': 'Car Height',
    'HB': 'Car sling Height',
    'HC': 'Car interior Height',
    'HK': 'Hall Kick / sill',
    'PH': 'Pit Height',
    'PD': 'Pit Depth',
    'SH': 'Shaft / overhead Height',
    'OH': 'Overhead',
    'WW': 'Well Width',
    'DD': 'Well Depth',
    'BB': 'Door/Car Width',
    'WD': 'Well + Door total',
    'LL': 'Landing Left',
    'LR': 'Landing Right',
    'CW': 'Car Width',
    'CD': 'Car Depth',
}
_DIM_VAR_RE = re.compile(r'\b(' + '|'.join(DIM_VARIABLES) + r')\b')


def find_dim_variables(text: str) -> list[str]:
    return _DIM_VAR_RE.findall(text)


# --------------------------------------------------------------------------
# View detection (by title text inside a block or region)
# --------------------------------------------------------------------------

VIEW_KEYWORDS = {
    # More specific categories first so e.g. "機房平面圖" classifies as
    # machine_room, not just plan.
    'machine_room': ['machine room plan', 'machine room', 'control room layout',
                     'control room', 'mr plan', '機房平面', '機房'],
    'pit': ['pit layout', 'pit detail', 'pit plan', '底坑'],
    'car_view': ['car elevation', 'cab detail', '車廂立面'],
    'door': ['door detail', 'other floors entrance', 'entrance detail',
             '門口', '層門'],
    'disclaimer': ['disclaimer', 'not for construction', 'notes:'],
    'specs': ['specifications', 'main specification', 'spec table',
              '規格表', '主要規格'],
    'title_block': ['title box', 'dwg title', 'drafter', 'designed', 'approved',
                    'project name', 'drawing no', 'admin no'],
    'side_section': ['elevation section', 'hoistway section', 'pit and top',
                     'shaft section', '側面剖面', '側面', '立面'],
    'plan': ['plan view', 'hoistway plan', 'shaft plan', 'car and shaft',
             'car and well', '平面圖', '平面'],
}


def classify_view(title: str) -> str | None:
    # Normalize underscores/hyphens to spaces so block names like
    # "Hoistway_Plan_S330a" match keyword "hoistway plan".
    t = re.sub(r'[_\-]+', ' ', title.lower())
    for view_type, keywords in VIEW_KEYWORDS.items():
        for kw in keywords:
            if kw.lower() in t:
                return view_type
    return None


# --------------------------------------------------------------------------
# Spec table field recognition
# --------------------------------------------------------------------------

SPEC_FIELD_KEYWORDS = {
    'capacity': ['capacity', 'load', '載重', '容量'],
    'speed': ['speed', '速度'],
    'type': ['type', 'model type', 'series', '機種'],
    'control': ['control', '制御'],
    'power': ['power', 'motor', '電源', 'voltage'],
    'stops': ['stops', '停站'],
    'travel': ['travel', 'total height', '行程'],
    'car_size': ['cab size', 'car size', '車廂尺寸'],
    'opening': ['opening', 'entrance', '開門'],
    'rope': ['rope', '鋼索'],
    'ratio': ['ratio', '繞繩', '比'],
    'guide_rail': ['guide rail', 'guide raic', '導軌'],
    'regulation': ['regulation', 'code', 'asme', 'cns', 'en 81'],
    'pit_depth': ['pit depth', 'min. pit depth', '底坑'],
    'overhead': ['overhead', 'min. overhead', '頂部'],
    'seismic': ['seismic', 'zone', '耐震'],
    'reaction_load': ['reaction load', '反作用力'],
}


def detect_spec_field(text: str) -> str | None:
    t = text.lower().strip()
    for field, keywords in SPEC_FIELD_KEYWORDS.items():
        for kw in keywords:
            if kw == t or (len(t) < 40 and kw in t):
                return field
    return None


# --------------------------------------------------------------------------
# Core extraction
# --------------------------------------------------------------------------

def _flatten_block(doc: Drawing, block: Any, depth: int = 0, max_depth: int = 8) -> list:
    out = []
    if depth > max_depth:
        return out
    for e in block:
        if e.dxftype() == 'INSERT':
            try:
                sub = doc.blocks.get(e.dxf.name)
                out.extend(_flatten_block(doc, sub, depth + 1, max_depth))
            except Exception:
                pass
        else:
            out.append(e)
    return out


def _extent_of(entities: list) -> dict[str, float] | None:
    xs, ys = [], []
    for e in entities:
        if e.dxftype() == 'LINE':
            xs.extend([e.dxf.start.x, e.dxf.end.x])
            ys.extend([e.dxf.start.y, e.dxf.end.y])
        elif e.dxftype() == 'CIRCLE':
            xs.append(e.dxf.center.x)
            ys.append(e.dxf.center.y)
    if not xs:
        return None
    return {
        'x_min': min(xs), 'x_max': max(xs),
        'y_min': min(ys), 'y_max': max(ys),
        'width': max(xs) - min(xs),
        'height': max(ys) - min(ys),
    }


def _text_of(e: Any) -> str:
    if e.dxftype() == 'TEXT':
        return clean_text(e.dxf.text)
    if e.dxftype() == 'MTEXT':
        return clean_text(e.text)
    return ''


def _analyze_block_as_view(doc: Drawing, block_name: str) -> dict | None:
    try:
        block = doc.blocks.get(block_name)
    except Exception:
        return None
    ents = _flatten_block(doc, block)
    if not ents:
        return None

    # Collect text content and detect all view titles present in this region.
    # A single region (e.g. JFI's modelspace) can contain multiple view types
    # side-by-side, so we return the full set, not just the first match.
    texts = []
    view_types: set[str] = set()
    for e in ents:
        if e.dxftype() in ('TEXT', 'MTEXT'):
            t = _text_of(e)
        elif e.dxftype() == 'DIMENSION':
            try:
                t = clean_text(e.dxf.text or '')
            except Exception:
                t = ''
        else:
            continue
        if not t:
            continue
        texts.append(t)
        vt = classify_view(t)
        if vt:
            view_types.add(vt)
    # Fall back to block-name hint if no matching text title found
    if not view_types:
        vt = classify_view(block_name)
        if vt:
            view_types.add(vt)

    return {
        'block_name': block_name,
        'entity_count': len(ents),
        'view_types': sorted(view_types),
        'extents': _extent_of(ents),
        'text_samples': texts[:30],
        'dim_variables': sorted(set(
            v for t in texts for v in find_dim_variables(t)
        )),
    }


def _collect_dimensions(doc: Drawing) -> dict:
    """Collect DIMENSION entities across msp + all blocks."""
    dim_data = []
    # modelspace
    for e in doc.modelspace():
        if e.dxftype() == 'DIMENSION':
            dim_data.append(_dim_info(e))
    # blocks (DIMENSIONs are often inside view blocks)
    for block in doc.blocks:
        if block.name.startswith('*'):
            continue
        for e in block:
            if e.dxftype() == 'DIMENSION':
                dim_data.append(_dim_info(e))
    # Variable usage frequency
    var_counts: Counter = Counter()
    for d in dim_data:
        for v in find_dim_variables(d.get('text', '')):
            var_counts[v] += 1
    return {
        'count': len(dim_data),
        'variable_usage': dict(var_counts.most_common()),
        'samples': dim_data[:15],
    }


def _dim_info(e: Any) -> dict:
    try:
        measurement = float(e.dxf.actual_measurement)
    except Exception:
        measurement = None
    try:
        text_override = e.dxf.text
    except Exception:
        text_override = ''
    return {
        'measurement': measurement,
        'text': text_override,
        'layer': e.dxf.layer,
    }


def _detect_specs_table(all_texts: list[tuple[str, str, float, float]]) -> dict:
    """Detect a specs table by clustering texts that match spec field keywords."""
    spec_hits = []
    for layer, text, x, y in all_texts:
        field = detect_spec_field(text)
        if field:
            spec_hits.append({
                'field': field, 'text': text, 'x': x, 'y': y, 'layer': layer,
            })
    # Determine density: at least 5 distinct fields = likely specs table
    distinct_fields = sorted({h['field'] for h in spec_hits})
    return {
        'detected': len(distinct_fields) >= 5,
        'distinct_fields_found': distinct_fields,
        'hit_count': len(spec_hits),
    }


def _count_responsibility_markers(all_texts: list[tuple[str, str, float, float]]) -> dict:
    by_others = 0
    by_us = 0
    for _, text, _, _ in all_texts:
        low = text.lower()
        if 'by others' in low or 'by other' in low:
            by_others += 1
        if 'by mitsubishi' in low or 'by kone' in low or 'by otis' in low or 'by schindler' in low:
            by_us += 1
    return {'by_others': by_others, 'by_manufacturer': by_us}


def _language_breakdown(all_texts: list[tuple[str, str, float, float]]) -> dict:
    """Rough language detection by Unicode range."""
    lang = Counter()
    for _, text, _, _ in all_texts:
        if re.search(r'[\u4e00-\u9fff]', text):
            lang['cjk'] += 1
        elif re.search(r'[\u3040-\u30ff]', text):
            lang['japanese_kana'] += 1
        elif re.search(r'[a-zA-Z]', text):
            lang['latin'] += 1
    return dict(lang)


def extract_pattern(dxf_path: str, source_name: str | None = None) -> dict:
    doc = ezdxf.readfile(dxf_path)
    msp = doc.modelspace()

    # Layer catalog
    layer_classification: Counter = Counter()
    layer_list = []
    for layer in sorted(doc.layers, key=lambda l: l.dxf.name):
        cls = classify_layer(layer.dxf.name)
        layer_classification[cls] += 1
        layer_list.append({
            'name': layer.dxf.name,
            'color': layer.dxf.color,
            'linetype': layer.dxf.linetype,
            'class': cls,
        })

    # Blocks (named, non-anonymous)
    named_blocks = [b for b in doc.blocks if not b.name.startswith('*')]

    # Flatten everything: msp + all blocks (dedup by identity)
    all_entities = []
    for e in msp:
        all_entities.append(e)
    # Collect texts across msp + all blocks for cross-cutting analysis.
    # Includes DIMENSION text overrides because KONE stores variable labels
    # (e.g. "<> HH") as dimension text, not as MTEXT.
    all_texts: list[tuple[str, str, float, float]] = []

    def _collect_from(entity_iter):
        for e in entity_iter:
            kind = e.dxftype()
            try:
                x, y = e.dxf.insert.x, e.dxf.insert.y
            except Exception:
                x, y = 0.0, 0.0
            if kind in ('TEXT', 'MTEXT'):
                t = _text_of(e)
                if t:
                    all_texts.append((e.dxf.layer, t, x, y))
            elif kind == 'DIMENSION':
                try:
                    override = e.dxf.text or ''
                except Exception:
                    override = ''
                if override:
                    all_texts.append((e.dxf.layer, clean_text(override), x, y))

    for b in named_blocks:
        _collect_from(_flatten_block(doc, b))
    _collect_from(msp)

    # Views — three strategies (union of candidates):
    #   (a) Each top-level INSERT target (KONE/Mitsubishi style).
    #   (b) Any named user block with >= MIN_BLOCK_ENTITIES, because some tools
    #       (Schindler) reference view blocks from paper space, not modelspace.
    #   (c) Modelspace content itself (JFI style where multiple views share
    #       the modelspace and are separated spatially).
    MIN_BLOCK_ENTITIES = 20
    view_candidates = []
    seen_blocks: set[str] = set()
    top_level_inserts = {e.dxf.name for e in msp if e.dxftype() == 'INSERT'}
    for bname in top_level_inserts:
        if bname in seen_blocks:
            continue
        v = _analyze_block_as_view(doc, bname)
        if v:
            view_candidates.append(v)
            seen_blocks.add(bname)
    for b in named_blocks:
        if b.name in seen_blocks:
            continue
        entity_count = sum(1 for _ in b)
        if entity_count < MIN_BLOCK_ENTITIES:
            continue
        v = _analyze_block_as_view(doc, b.name)
        if v:
            view_candidates.append(v)
            seen_blocks.add(b.name)
    msp_entities = list(msp)
    # Add modelspace as a view candidate if it contains geometry beyond just
    # INSERT stubs (i.e. direct lines/text not nested inside a named block).
    msp_non_insert = [e for e in msp_entities if e.dxftype() != 'INSERT']
    if msp_non_insert:
        msp_texts = []
        for e in msp_non_insert:
            if e.dxftype() in ('TEXT', 'MTEXT'):
                msp_texts.append(_text_of(e))
            elif e.dxftype() == 'DIMENSION':
                try:
                    msp_texts.append(clean_text(e.dxf.text or ''))
                except Exception:
                    pass
        msp_texts = [t for t in msp_texts if t]
        msp_view_types: set[str] = set()
        for t in msp_texts:
            vt = classify_view(t)
            if vt:
                msp_view_types.add(vt)
        view_candidates.append({
            'block_name': '<modelspace>',
            'entity_count': len(msp_non_insert),
            'view_types': sorted(msp_view_types),
            'extents': _extent_of(msp_non_insert),
            'text_samples': msp_texts[:30],
            'dim_variables': sorted(set(
                v for t in msp_texts for v in find_dim_variables(t)
            )),
        })

    # MSP entity type counts
    msp_types: Counter = Counter(e.dxftype() for e in msp)

    # Overall extents
    overall_extent = _extent_of([e for e in msp if e.dxftype() == 'LINE']) or \
                     _extent_of(_flatten_block(doc, doc.blocks.get(next(iter(top_level_inserts)))) if top_level_inserts else [])

    return {
        'source': source_name or dxf_path,
        'dxf_version': doc.dxfversion,
        'encoding': doc.encoding,
        'stats': {
            'layers': len(doc.layers),
            'blocks_user': len(named_blocks),
            'entities_modelspace': sum(1 for _ in msp),
            'text_entities_total': len(all_texts),
        },
        'extents': overall_extent,
        'layer_taxonomy': dict(layer_classification),
        'layers': layer_list,
        'msp_entity_types': dict(msp_types),
        'views': view_candidates,
        'dimensions': _collect_dimensions(doc),
        'specs_table': _detect_specs_table(all_texts),
        'responsibility_markers': _count_responsibility_markers(all_texts),
        'languages': _language_breakdown(all_texts),
        'dim_variables_used': sorted(set(
            v for _, t, _, _ in all_texts for v in find_dim_variables(t)
        )),
    }


# --------------------------------------------------------------------------
# Compare mode
# --------------------------------------------------------------------------

def compare_patterns(patterns: list[dict]) -> dict:
    if not patterns:
        return {}
    sources = [p['source'] for p in patterns]

    layer_sets = [{l['name'] for l in p['layers']} for p in patterns]
    common_layers = sorted(set.intersection(*layer_sets)) if layer_sets else []

    view_type_sets = [
        {vt for v in p['views'] for vt in v.get('view_types', [])}
        for p in patterns
    ]
    common_view_types = sorted(set.intersection(*view_type_sets)) if view_type_sets else []

    dim_var_sets = [set(p['dim_variables_used']) for p in patterns]
    common_dim_vars = sorted(set.intersection(*dim_var_sets)) if dim_var_sets else []

    spec_field_sets = [set(p['specs_table']['distinct_fields_found']) for p in patterns]
    common_spec_fields = sorted(set.intersection(*spec_field_sets)) if spec_field_sets else []

    return {
        'sources': sources,
        'industry_consensus': {
            'common_view_types': common_view_types,
            'common_dim_variables': common_dim_vars,
            'common_spec_fields': common_spec_fields,
            'layer_naming_philosophies': [
                p['layer_taxonomy'] for p in patterns
            ],
        },
        'common_layers_by_exact_name': common_layers,
        'unique_layers_per_source': {
            sources[i]: sorted(layer_sets[i] - set.union(*(
                layer_sets[j] for j in range(len(sources)) if j != i
            )))
            for i in range(len(sources))
        } if len(sources) > 1 else {},
    }


# --------------------------------------------------------------------------
# CLI
# --------------------------------------------------------------------------

def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('files', nargs='+', help='DWG or DXF files to analyze')
    ap.add_argument('-o', '--output', help='Output JSON file (default: stdout)')
    ap.add_argument('--pretty', action='store_true', help='Pretty-print JSON')
    ap.add_argument('--compare', action='store_true',
                    help='Output a cross-file comparison summary instead of per-file details')
    args = ap.parse_args()

    patterns = []
    for fp in args.files:
        if not Path(fp).is_file():
            print(f'skip: not a file: {fp}', file=sys.stderr)
            continue
        print(f'extracting: {fp}', file=sys.stderr)
        dxf_path, is_temp = prepare_dxf(fp)
        try:
            p = extract_pattern(dxf_path, source_name=fp)
            patterns.append(p)
        finally:
            if is_temp:
                try:
                    os.unlink(dxf_path)
                    os.rmdir(Path(dxf_path).parent)
                except Exception:
                    pass

    if args.compare:
        payload: Any = {
            'per_file': patterns,
            'comparison': compare_patterns(patterns),
        }
    elif len(patterns) == 1:
        payload = patterns[0]
    else:
        payload = patterns

    indent = 2 if args.pretty else None
    text = json.dumps(payload, indent=indent, ensure_ascii=False, default=str)
    if args.output:
        Path(args.output).write_text(text)
        print(f'wrote: {args.output}', file=sys.stderr)
    else:
        print(text)
    return 0


if __name__ == '__main__':
    sys.exit(main())
