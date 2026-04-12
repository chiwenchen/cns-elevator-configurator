/**
 * Real validation report builder — replaces the stub in handlers/solve.ts.
 *
 * Spec §4.5: for each active rule, produce a ValidationItem with status:
 *   - 'warning' if case override has key AND final value differs from team default
 *   - 'pass' otherwise
 *   - 'fail' defensive only (baseline violations throw earlier in buildEffectiveConfig)
 *
 * Summary aggregates counts split by source (cns vs guideline = industry|engineering).
 */

import type {
  TeamRule,
  CaseOverride,
  ValidationReport,
  ValidationItem,
  ValidationStatus,
} from './types'

export function buildValidationReport(
  teamRules: TeamRule[],
  caseOverride: CaseOverride,
): ValidationReport {
  const items: ValidationItem[] = teamRules.map((rule) => {
    const overrideValue = caseOverride[rule.key]
    const overridden = overrideValue !== undefined && overrideValue !== rule.value
    const finalValue = overrideValue !== undefined ? overrideValue : rule.value

    let status: ValidationStatus
    let reason: string

    if (overridden) {
      status = 'warning'
      reason = `案子微調：${rule.value} → ${overrideValue}`
    } else {
      status = 'pass'
      reason =
        rule.value === rule.default_value
          ? '使用出廠預設值'
          : `使用團隊設定（出廠值 ${rule.default_value}）`
    }

    return {
      rule_key: rule.key,
      rule_name: rule.name,
      category: rule.category,
      source: rule.source,
      mandatory: rule.mandatory === 1,
      final_value: finalValue,
      team_default_value: rule.value,
      factory_default_value: rule.default_value,
      baseline_description: describeBaseline(rule),
      status,
      status_reason: reason,
    }
  })

  // Sort: category then key, for stable UI order
  items.sort((a, b) => {
    if (a.category !== b.category) return a.category < b.category ? -1 : 1
    return a.rule_key < b.rule_key ? -1 : 1
  })

  const summary = {
    guideline_pass: items.filter((i) => i.source !== 'cns' && i.status === 'pass').length,
    guideline_warning: items.filter((i) => i.source !== 'cns' && i.status === 'warning').length,
    cns_pass: items.filter((i) => i.source === 'cns' && i.status === 'pass').length,
    cns_warning: items.filter((i) => i.source === 'cns' && i.status === 'warning').length,
    total_fail: items.filter((i) => i.status === 'fail').length,
  }

  return { summary, items }
}

function describeBaseline(rule: TeamRule): string {
  if (rule.type === 'number') {
    const unit = rule.unit || ''
    if (rule.baseline_min !== null && rule.baseline_max !== null) {
      return `${rule.baseline_min}-${rule.baseline_max} ${unit}`.trim()
    }
    if (rule.baseline_min !== null) return `≥ ${rule.baseline_min} ${unit}`.trim()
    if (rule.baseline_max !== null) return `≤ ${rule.baseline_max} ${unit}`.trim()
    return '無限制'
  }
  if (rule.type === 'enum' && rule.baseline_choices) {
    return `[${rule.baseline_choices.join(', ')}]`
  }
  return '未知'
}
