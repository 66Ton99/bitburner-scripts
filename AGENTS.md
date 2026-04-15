# AGENTS.md

Project-specific guidance for coding agents working in `/Volumes/SRC/bitburner-scripts`.

## Scope

- Prefer minimal, targeted patches.
- Preserve the existing script-oriented architecture and Bitburner conventions.
- Do not rewrite working subsystems just to “clean them up”.

## User Preferences

- Keep responses concise and direct.
- Use `apply_patch` for file edits.
- Favor pragmatic fixes over theoretical refactors.
- Add useful dev-console logs when debugging UI automation.
- Keep `infiltrate.js` debug logging optional and disabled by default.
- Do not disable `logError` in infiltration automation; error logging stays on.

## Infiltration Rules

- Do not modify `infiltrate.js` unless the user explicitly asks for it.
- Infiltration orchestration belongs in `work-for-factions.js` and `infiltration-runner.js`.
- If changing infiltration behavior, prefer explicit parameters and small isolated helpers/scripts.
- When debugging repeated infiltration retries, log the concrete failure reason, not just the selected target.
- In the normal faction/money automation flow, handle city travel in `work-for-factions.js` before launching `infiltration-runner.js`, then call the runner with travel disabled.
- Prefer a local infiltration target that can finish the remaining faction reputation in one run over unnecessary travel to a slightly better remote target.
- Use `Departure from ...` and `Arrived from ...` wording for travel logs to avoid duplicate-looking messages.
- Remove dead infiltration helper code from `work-for-factions.js` when that logic has been moved into `infiltration-runner.js`; do not keep parallel stale implementations.

## Reputation / Augmentation Rules

- `NeuroFlux Governor` must not be treated as a normal target augmentation for faction progression calculations.
- Be careful with anything that feeds:
  - `mostExpensiveAugByFaction`
  - `mostExpensiveDesiredAugByFaction`
  - `mostExpensiveDesiredAugCostByFaction`
- `autopilot.js` reads augmentation status from `/Temp/affordable-augs.txt`.
- `faction-manager.js` should leave that file in a valid state even after purchases.

## Work / Install Behavior

- Default automation should avoid company-work grinding unless intentionally enabled.
- Avoid arbitrary crime fallback behavior with no concrete goal.
- Do not trigger installs purely because many augmentations are awaiting install if there is no money for additional purchases and more non-NeuroFlux augmentations remain.

## Validation

- After changing JS files, run `node --check` on each edited script.
- If a behavior depends on runtime UI state, say so explicitly in the final response.
- If changing infiltration stage handling, fallback DOM logic, or reward-click UI behavior, run `verify-infiltrate-runtime.js`, not just `node --check`.
- Keep verifier-only debug enablement isolated to the verifier path; do not globally enable infiltration debug logs for live gameplay.

## Files of Interest

- `work-for-factions.js`: faction progression, infiltration orchestration, crime/training flow
- `infiltration-runner.js`: one-shot infiltration executor with explicit args
- `faction-manager.js`: augmentation affordability/purchase/status output
- `autopilot.js`: top-level orchestration and install decisions
