# Seeds

This directory holds database seed data for the Cloudflare D1 `elevator-configurator-db` database. Seeds are kept **separate from schema migrations** (which live in `../migrations/`).

## Files

- `generate-baseline.ts` — TypeScript generator. Single source of truth for the baseline rules seeded into the `rules` table. Values mirror hardcoded constants in `src/solver/*` and `src/dxf/*`.
- `generate-baseline.test.ts` — Tests for the generator (structural sanity + specific rule existence).
- `0001_baseline_rules.sql` — Checked-in generated output. Regenerate via the generator command below.

## Regenerating the baseline seed

When any baseline rule changes:

```bash
bun seeds/generate-baseline.ts > seeds/0001_baseline_rules.sql
bun test seeds/generate-baseline.test.ts
git add seeds/0001_baseline_rules.sql
git commit -m "chore(seeds): regenerate baseline rules"
```

## Applying seeds

**Local D1 (dev):**
```bash
wrangler d1 execute elevator-configurator-db --local --file seeds/0001_baseline_rules.sql
```

**Production D1:**
```bash
wrangler d1 execute elevator-configurator-db --file seeds/0001_baseline_rules.sql
```

> ⚠ Applying a seed a second time will fail due to UNIQUE constraint on `rules.key`. To re-seed cleanly, truncate first:
> ```bash
> wrangler d1 execute elevator-configurator-db --local --command "DELETE FROM rules"
> ```

## Why generator → SQL file, not direct DB inserts?

- **Single source of truth**: values live in TypeScript, next to the code that will (in Milestone 1b) consume them via `buildEffectiveConfig`.
- **Reviewable diffs**: checked-in SQL file gives clean diffs when baselines change.
- **Reproducibility**: anyone can regenerate and get byte-identical output.
- **Wrangler compatibility**: `wrangler d1 execute --file` is the official apply path; generating SQL works with it directly.
