# AGENTS.md

Project-specific guidance for coding agents working in `bitburner-scripts`.

## Scope

- Prefer minimal, targeted patches.
- Preserve the existing script-oriented architecture and Bitburner conventions.
- Do not rewrite working subsystems just to “clean them up”.

## User Preferences

- Keep responses concise and direct.
- Do not make assumptions. Verify behavior, state, and root cause from code or runtime evidence before changing anything.
- Use `apply_patch` for file edits.
- Favor pragmatic fixes over theoretical refactors.
- Do real runtime verification, not just static checks.
- Add useful dev-console logs when debugging UI automation.
- Keep `infiltrate.js` debug logging optional and disabled by default.
- Do not disable `logError` in infiltration automation; error logging stays on.
- When a runtime incident reveals a durable project rule or user preference, update `AGENTS.md` in the same change unless the user says not to.
- Keep these notes current: remove or amend stale guidance when behavior changes, rather than accumulating contradictory rules.

## Infiltration Rules

- Infiltration orchestration belongs in `work-for-factions.js` and `infiltration-runner.js`.
- If changing infiltration behavior, prefer explicit parameters and small isolated helpers/scripts.
- When debugging repeated infiltration retries, log the concrete failure reason, not just the selected target.
- In the normal faction/money automation flow, handle city travel in `work-for-factions.js` before launching `infiltration-runner.js`, then call the runner with travel disabled.
- Prefer a local infiltration target that can finish the remaining faction reputation in one run over unnecessary travel to a slightly better remote target.
- Use `Departure from ...` and `Arrived from ...` wording for travel logs to avoid duplicate-looking messages.
- Remove dead infiltration helper code from `work-for-factions.js` when that logic has been moved into `infiltration-runner.js`; do not keep parallel stale implementations.
- Keep `Shadows of Anarchy` immediately after `Sector-12` in the default faction queue so it is joined early, but never target it directly for faction work or infiltration rewards. It gains reputation passively from successful infiltration done for other targets.

## Reputation / Augmentation Rules

- `NeuroFlux Governor` must not be treated as a normal target augmentation for faction progression calculations.
- `NeuroFlux Governor` is a low-priority cash sink. Do not let it compete with concrete strategic goals such as BN10 Covenant sleeves/memory, The Red Pill, or other progression blockers.
- Be careful with anything that feeds:
  - `mostExpensiveAugByFaction`
  - `mostExpensiveDesiredAugByFaction`
  - `mostExpensiveDesiredAugCostByFaction`
- `autopilot.js` reads augmentation status from `/Temp/affordable-augs.txt`.
- `faction-manager.js` should leave that file in a valid state even after purchases.
- `faction-manager.js --purchase` must respect `reserve.txt`; otherwise background purchase attempts can consume money reserved by higher-level orchestration.
- `reserve.txt` is a cash-only reserve. When `autopilot.js` is reserving for a concrete target and stock value is available, write only the cash gap not already covered by liquidatable stocks.
- The default stock/bootstrap reserve should not lock early cash before the stock portfolio exists. If stock value is zero and cash is still below the bootstrap target, write `0` to `reserve.txt` and let progression scripts run.

## Work / Install Behavior

- Default automation should avoid company-work grinding unless intentionally enabled.
- Avoid arbitrary crime fallback behavior with no concrete goal.
- `autopilot.js` may launch corporation automation only when corporations are actually available: current BN3 or SF3.3+. Keep the launcher lightweight; do not import `corporation.js` from `run-corporation.js`.
- Keep `casino.js` as a lightweight dispatcher. Shared casino runtime helpers belong outside it, and autopilot RAM checks should target the selected casino game script, not just the dispatcher.
- Do not reference `ns.singularity.*` directly from shared casino helpers; pass optional callbacks from scripts that can afford singularity, otherwise use UI clicks to avoid high no-SF4 RAM costs.
- Do not trigger installs purely because many augmentations are awaiting install if there is no money for additional purchases and more non-NeuroFlux augmentations remain.
- `autopilot.js` timed `xp-mode` is not useful once hack level is already high; avoid reintroducing aggressive XP-mode relaunching at high hack.
- Keep Bitburner 3.0 Darknet orchestration in `Tasks/darknet-manager.js`. `autopilot.js` should only keep the manager running, and Darknet scripts should avoid `tprint` in normal automation mode so they do not spam the main terminal.
- `Netburners` should be skipped in the default early-game autopilot flow while hacknet is intentionally deferred.
- If re-enabling `Netburners`, do it only in a late-game autopilot path that also enables actual hacknet progression; do not merely remove the skip and leave hacknet disabled.
- Company-work grinding, including the `Silhouette`/CEO path, should stay disabled in the default early-game autopilot flow.
- If re-enabling company-work in autopilot, do it only in an explicit late-game path; do not leave `--no-company-work` permanently enabled if late-game company factions are expected to progress.
- After BN10 is complete, if Covenant sleeves or sleeve memory are still incomplete, this becomes the top priority before leaving BN10.
- In BN10 sleeve-completion mode, do not buy NeuroFlux or install augmentations just because NF is available. Other spenders may use surplus cash, but should not spend the cash gap still needed after accounting for liquidatable stock value.
- In BN10 sleeve-completion mode, stocks are still valuable and should not be fully disabled. Do not pass the full sleeve cost as `stockmaster.js --reserve`, because that prevents stockmaster from investing. Prefer an aggressive low cash fraction such as `--fracH 0.001`, protect cash from other spenders with `reserve.txt`, and liquidate only when net worth is sufficient for the Covenant purchase but cash is not.
- Do not stop or skip relaunching `stockmaster.js` just because current cash is enough for the next BN10 Covenant sleeve/memory purchase. Buy the sleeve/memory immediately or let `sleeve.js` buy it, then keep stockmaster trading.
- If using `reserve.txt` to protect BN10 sleeve money, ensure `sleeve.js` itself can still spend that reserve on Covenant sleeve/memory purchases. The reserve is meant to block other spenders, not the intended purchase.

## Bitburner 3.0.0 Notes

- `ns.format.time(...)` should be used instead of legacy `ns.ui.time(...)`.
- Stock API naming changed: prefer `has4SDataTixApi()` instead of `has4SDataTIXAPI()`.
- `ns.singularity.gymWorkout(...)` now expects `GymType` enum values: `str`, `def`, `dex`, `agi`, not `"Strength"`, `"Defense"`, `"Dexterity"`, `"Agility"`.
- Some scripts that build temp helper scripts via `getNsDataThroughFile(...)` can hit much higher RAM costs in DEV 3.0.0 than expected on a fresh save.
- On fresh saves, prefer graceful exits or fallbacks over hard crashes when temp helper scripts cannot run due to RAM.

## Live Testing Workflow

- When the user asks to verify behavior, prefer live runtime validation against `../bitburner-src` over theory.
- Use headless Chromium / Playwright for UI/runtime verification when possible.
- Start the game dev server from `../bitburner-src` with `npm run start:dev`.
- Start the sync bridge from this repo with `node local-sync-server.js --source-root /Volumes/SRC/bitburner-scripts --port 12526`.
- Reuse the headless helpers in `/tmp/pwbb` if they already exist:
  - `run_bb_command.mjs`
  - `run_bb_multi.mjs`
  - `run_bb_suite.mjs`
- Run Bitburner headless validations strictly one at a time against a single Remote API port.
- Do not parallelize headless game sessions against the same Remote API connection.
- A websocket `409` from the Remote API is usually a test harness conflict, not a script bug.
- If a headless run says a script does not exist on `home`, first suspect Remote API/session conflicts before changing code.
- For Node-only helpers and CLI tools, use `node --check` or a direct CLI invocation instead of booting the game.

## Validation Heuristics

- Distinguish real compatibility bugs from normal game-state limitations on a fresh save.
- Common non-bugs during fresh-save validation:
  - Missing SF4 / singularity access
  - Missing SF7 / not being in BN7 for bladeburner automation
  - Missing BN10 access for sleeves
  - Missing TIX / 4S API
  - Not enough travel money
  - Not enough RAM to run temp helper scripts
- If a script is blocked only by game state, record that and do not “fix” it as a DEV compatibility issue.
- If a runtime script depends on UI state, verify it in live headless runtime, not just with `node --check`.

## Validation

- After changing JS files, run `node --check` on each edited script.
- Do not close runtime-affecting changes on theory alone. Verify them in live headless Bitburner runtime before the final response.
- If a behavior depends on runtime UI state, say so explicitly in the final response.
- Keep verifier-only debug enablement isolated to the verifier path; do not globally enable infiltration debug logs for live gameplay.
- If changing `work-for-factions.js`, `autopilot.js`, or other orchestration scripts, prefer at least one live headless run that reaches the touched path.

## Known Fresh-Save Runtime Outcomes

- `casino.js` may fail only because the player lacks the minimum money needed to travel to the casino.
- `ascend.js` is safe to run without `--reset` / `--install-augmentations`; by default it should not perform a reset.
- `crime.js`, `Tasks/ram-manager.js`, `stanek.js`, and `stanek.js.create.js` may encounter temp-helper RAM limits on low-RAM saves.
- If low-RAM temp-helper failures are likely, prefer a controlled `INFO`/`WARNING` exit over a full runtime crash.

## Files of Interest

- `work-for-factions.js`: faction progression, infiltration orchestration, crime/training flow
- `infiltration-runner.js`: one-shot infiltration executor with explicit args
- `faction-manager.js`: augmentation affordability/purchase/status output
- `autopilot.js`: top-level orchestration and install decisions

## Original source code of the game
- `../bitburner-src`: all sources to build/test the scripts and game itself
- `nix develop`: to run and test the game
