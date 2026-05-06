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
- Do not use faction donations as an automation shortcut for augmentation reputation. `faction-manager.js` should purchase only augmentations whose reputation is already earned; `work-for-factions.js` should use infiltration/work to close reputation gaps.
- For `Shadows of Anarchy`, only treat `SoA - phyzical WKS harmonizer` as a target augmentation. Ignore the other SoA mini-game augmentations for progression and purchasing.
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
- In BN8, for money-gated faction invites, consider liquidatable stock value before declaring the invite impossible. If cash plus stock value satisfies the requirement, liquidate stocks and retry the invite path. Do not apply this broadly to other BNs without a concrete reason.
- When money-gated faction invites are blocked, throttle repeated per-faction logs and emit a concise waiting status with cash, stock value, and the closest missing net-worth gap.
- In BN8, avoid printing repeated scary per-faction `Cannot join ... insufficient money` lines while waiting on money-gated invites; record the gate internally and rely on the concise aggregate waiting status unless action is actually being taken.
- In BN8, money-gated waiting status should name the strategic Daedalus/TRP target instead of misleadingly reporting intermediate factions such as `The Covenant` as the closest target, and it should be throttled to avoid terminal spam.
- Do not use crimes as generic combat-stat training when a faction invite needs specific strength/defense/dexterity/agility thresholds. Use crimes only for kills/karma, then train deficient combat stats directly at the gym.
- Before gym combat training, estimate per-stat ETA from current exp/multipliers and choose the fastest practical gym/stat. Do not imply gym training can raise all combat stats at once; `gymWorkout` only supports one of `str`, `def`, `dex`, or `agi`.
- `autopilot.js` may launch corporation automation only when corporations are actually available: current BN3 or SF3.3+. Keep the launcher lightweight; do not import `corporation.js` from `run-corporation.js`.
- Keep `casino.js` as a lightweight dispatcher. Shared casino runtime helpers belong outside it, and autopilot RAM checks should target the selected casino game script, not just the dispatcher.
- Do not reference `ns.singularity.*` directly from shared casino helpers; pass optional callbacks from scripts that can afford singularity, otherwise use UI clicks to avoid high no-SF4 RAM costs.
- Keep grafting automation conservative and isolated in `graft-manager.js`. `autopilot.js` may launch it, but should not choose graft targets inline. In BN8, grafting must preserve the Daedalus cash floor and focus on stock/cash acceleration via hacking speed/grow/chance, not broad augmentation collection or pure hack XP.
- In BN8, frequent installs are desirable because each reset can rerun casino and restart stock growth from a stronger baseline. Prefer buying all currently affordable non-NeuroFlux augmentations as a batch, then installing immediately, instead of waiting for large augmentation thresholds.
- In BN8, purchase augmentations cheap-first. Do not let the normal value/priority ordering create a huge unaffordable batch; the purchase planner should build the affordable prefix in actual purchase order with augmentation price multipliers included.
- In BN8, do not buy new `NeuroFlux Governor` levels as part of the frequent-install path, but if NeuroFlux levels were already purchased and are awaiting install, install them rather than idling.
- In BN8, already-purchased awaiting augmentations should override Daedalus-invite waiting heuristics. Leaving purchased augmentations uninstalled creates a price penalty and slows the cash-first loop.
- Do not use global `reserve.txt` to hold cash in BN8; it slows stock/casino-driven progress. Keep only targeted safety checks that prevent going negative on paid actions.
- In BN8, when waiting on money-gated faction invites or other cash-first blockers, keep stockmaster aggressive. Use a very low cash fraction and buy trigger so idle cash is invested instead of sitting below the default `--fracB` threshold.
- In BN8, gang income is hard-capped by `GangSoftcap = 0`, so do not spend cash on gang upgrades for money. If a gang is active, run it as a no-budget money-focus background trickle and keep cash prioritized for stocks/casino/Daedalus.
- In BN8, keep cheap-first frequent installs in the early game. Only switch to Red Pill preservation mode once Daedalus is joined or the installed augmentation and hacking requirements for Daedalus are effectively met; from that point, do not buy or install non-`The Red Pill` augmentations.
- In BN8, `autopilot.js` should keep `/Temp/affordable-augs.txt` fresh before install decisions; stale faction-manager output can incorrectly fall back to normal augmentation thresholds.
- In BN8, do not kill the live `stockmaster.js` trader when liquidating unless explicitly requested. Preserving pre-4S tick history is critical; prefer `stockmaster.js --liquidate` with keep-trader behavior, or `--liquidate --kill-trader` only when a full reset is intentional.
- If `stockmaster.js` detects an impossible mixed long/short position on the same symbol, close both positions and recover instead of only logging an error and leaving one side open.
- Do not trigger installs purely because many augmentations are awaiting install if there is no money for additional purchases and more non-NeuroFlux augmentations remain.
- `autopilot.js` timed `xp-mode` is not useful once hack level is already high; avoid reintroducing aggressive XP-mode relaunching at high hack.
- Keep Bitburner 3.0 Darknet orchestration in `Tasks/darknet-manager.js`. `autopilot.js` should only keep the manager running, and Darknet scripts should avoid `tprint` in normal automation mode so they do not spam the main terminal.
- Darknet worker scripts can be copied and relaunched across remote darknet hosts with imperfect args. Parse worker args defensively; do not let a missing value for propagation metadata such as `--origin` crash the worker at startup.
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
