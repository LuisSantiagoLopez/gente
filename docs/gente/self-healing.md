# Gente support and self-healing

How Gente finds problems on people's computers, fixes what it can there, and ships a tested fix for the rest. Everything a person sees is in [help](help/en/06-support.md).

## The pieces

| Piece | Where | What it does |
| --- | --- | --- |
| Help articles | `docs/gente/help/{en,es,pt}` | Setup, features, troubleshooting, billing, privacy, support. Shown in the app and on the site. Prices and hours are filled from Gente Cloud's `GET /v1/billing/plans` (`scripts/gente-plans.mjs` saves `plans.json`; the gates fail if it drifts). |
| Support window | `apps/desktop/src/main/support`, `src/support-renderer` | Help → Gente Support. Local model answers from the articles; one-tap fixes; a person only when stuck. |
| Health checks | `support/health.ts`, `support/probes.ts` | Model server, model files, disk, ports, app files, workspace, Telegram. Every 5 minutes and after errors. |
| Self-heal | `support/monitor.ts` | Runs the safe automatic fixes (restart services) once per 30 minutes per problem. |
| Error catcher | `support/diagnostics.ts` | Main-process crashes, window and child-process crashes, problems the checks find. Saved redacted in `logs/errors.jsonl`. |
| Reports | `support/diagnostics.ts`, `support/redact.ts` | Version, OS, codes, stacks, log tails. Chat lines and personal data removed. Sent only with the person's yes ("Ask each time" by default). |
| Intake | Gente Cloud: `cloud/db/migrations/010_self_heal.sql`, `cloud/supabase/functions/gente-selfheal` | Receives reports and health counts; serves the update feed. |
| Pipeline | `scripts/self-heal` | Group → reproduce → fix → PR → gates → canary → 5% → 25% → 100%, rollback. |
| Workflows | `.github/workflows/gente-*.yml` | The pipeline on GitHub Actions. |

## The pipeline

```
 Gente on a person's computer
   health checks ──► self-heal (restart services)            fixed: nothing leaves the computer
        │ still broken
        ▼
   redacted report ──► person says yes? ──no──► nothing is sent
        │ yes
        ▼
 Gente Cloud gente-selfheal ──► gente.diag_reports
        │  every 6 h (gente-self-heal.yml)
        ▼
 group by signature ──► one job per group and OS (macos-15, windows-2025)
        ▼
 agent writes a failing test ── check: only one new test file, and it fails
        ▼
 agent writes the fix ───────── check: the test is untouched, and it passes
        ▼
 PR to canary (label self-heal)
        ▼
 gates (gente-gates.yml): full tests + repo checks + typecheck
                          + packaged-app smoke (Windows and Mac)
                          + chaos subset (5 real faults, Mac and Windows)
        │ all pass (a skipped gate is a fail)
        ▼
 auto-merge to canary ──► gente-canary-release.yml: gates again, build, sign if certs exist
        ▼
 feed: canary channel 100%, everyone else 5%
        │ hourly (gente-rollout.yml): crash-free rate and setup success vs the version before
        ├── healthy for 24 h and 200+ launches ──► 25% ──► 100%
        └── worse ──► feed back to the last good version + revert on canary (rebuilt through the gates)
```

Rollout rules (`scripts/self-heal/rollout.ts`, `DEFAULT_POLICY`): crash-free rate never under 99% and never more than 0.5 points under the previous version; setup success never more than 2 points under it (with at least 20 setups); a stage needs 200 launches and 24 hours. Counts are distinct installs, so one broken computer cannot decide alone.

## Try it

```bash
pnpm exec tsx scripts/self-heal/chaos.ts          # five real faults against the real checks
pnpm exec tsx scripts/self-heal/dry-run.ts /tmp/heal   # five errors end to end + a rollback drill
open /tmp/heal/status.html
pnpm exec tsx scripts/gente-help-site.ts /tmp/site/help   # the help website
```

## Where it runs

- **Intake and update feed:** Gente Cloud owns them (branch `cloud`): migration `cloud/db/migrations/010_self_heal.sql` (private `gente` schema, RLS forced) and the edge function `cloud/supabase/functions/gente-selfheal`. Installers go to GitHub releases (2 GB per file). Only the update feed (`latest.yml`, `latest-mac.yml`, `rollout.json`) lives in the public `gente-updates` storage bucket; it points at the release files.
- **Settings in this repository:** `vars.GENTE_SELFHEAL_URL` (the function), `vars.GENTE_UPDATE_URL` (the bucket's public address), `secrets.SELF_HEAL_CLOUD_TOKEN` (CI token; only its sha256 is stored in `gente.selfheal_tokens`). The desktop build reads `GENTE_SELFHEAL_URL`; a build without it sends no reports.
- **Branches and labels:** fixes merge into `canary`; labels `self-heal` and `blocked-on-owner`.
- **Pages:** help at `/gente/help/`, status at `/gente/self-heal/` (`gente-pages.yml`).

### Blocked on owner

- **Repair agent:** set `vars.SELF_HEAL_AGENT`, `vars.SELF_HEAL_AGENT_SETUP` and its key. Until then each failure group becomes an issue labeled `blocked-on-owner`, with the redacted evidence, and the pipeline stops there.
- **Schedules:** GitHub runs `schedule` only from the default branch (`main`). Until these workflows are there, a push to `canary` runs them.
- **Signing:** see below. Builds are unsigned and say so in the run summary; that never fails a run.

## Code signing

No signing certificates exist on this Mac (`security find-identity -v -p codesigning`: 0 valid identities) and none are in the repository secrets. Builds are unsigned until these are added; the workflows sign automatically once they are:

- **Mac:** an Apple Developer Program membership, a "Developer ID Application" certificate exported as .p12 → `CSC_LINK` (base64 or URL) and `CSC_KEY_PASSWORD`; for notarization `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`. Unsigned Mac apps cannot update themselves with Squirrel.Mac, so Mac auto-update needs this.
- **Windows:** an OV or EV code-signing certificate (or Azure Trusted Signing) → `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`. Without it, SmartScreen warns on install and `verifyUpdateCodeSignature` has to stay off.
