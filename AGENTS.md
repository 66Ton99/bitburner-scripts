# AGENTS.md

Project guidance for coding agents in `bitburner-scripts`.

## Core Rules

- Reply to the user in Ukrainian. Keep responses concise and direct.
- Prefer minimal, targeted patches; preserve the script-oriented Bitburner architecture and do not rewrite working subsystems for cleanup alone.
- Verify behavior, state, and root cause from code or runtime evidence before changing anything. Favor pragmatic fixes over theoretical refactors.
    - Use `apply_patch` for file edits. After JS edits, run `node --check` on each edited script.
    - Update this file when a durable runtime incident or user preference creates a reusable rule; remove stale or contradictory guidance.
    - Add compatibility wrappers for Bitburner API changes. For dnet server details, probe `dnet.getServerDetails()` / `dnet.getServer()` before older `dnet.getServerAuthDetails()`.
- `getConfiguration()` must preserve explicit booleans: `--flag false` stays false.
- Dev-console logs are for debugging only: emit while DevTools is detected open, default gap threshold `800`, configurable via `window.bbDevConsoleGapThreshold`. `run dev-console.js --status` must show version marker, outer/inner sizes, gaps, threshold, and active state.
- Browser console helpers write to `window.console` first, then `globalThis.console`. Keep infiltration diagnostics behind explicit flags, keep `infiltrate.js` debug off by default, and never disable infiltration `logError`.
- Use Bitburner 3.0 APIs: `ns.format.time(...)`, `has4SDataTixApi()`, gym enum values `str`/`def`/`dex`/`agi`. Avoid enumerating full `ns.getServer()` objects because deprecated properties can warn.

## Architecture And RAM

- Ownership boundaries: `autopilot.js` orchestrates handoffs; `daemon.js` owns RAM-gated managed launches; `hack.js` owns hacking/rooting/port-cracker state; `faction-manager.js` owns augmentation purchase/install policy; `work-for-factions.js` owns faction work/training/infiltration orchestration; `infiltration-runner.js` executes one explicit infiltration run.
- `autopilot.js` must not own augmentation decisions or directly launch long-running background systems after casino/pre-casino handoffs. It launches/relaunches `daemon.js` with explicit intent.
- `daemon.js` manages stockmaster, sleeves, corporation, darknet, grafting, gangs, faction work, hash spending, and hacking. It preserves home RAM for temp-helper bursts and passes the same reserve to `hack.js`.
- `hack.js` stays a dedicated hacking runner. Do not keep stock manipulation, hacknet-server mode, share scheduling, daemon orchestration flags, or broad helper launches there.
- Leaf scripts should not duplicate daemon RAM policy with local low-free-RAM fallbacks unless there is a concrete runtime reason.
- Daemon logs stay concise; verbose helper chatter belongs behind `--verbose`. Daemon tail windows are opt-in with `--tail-windows`; broad helper tails stay off. `work-for-factions.js` may keep its work/focus tail, and daemon-launched `bladeburner.js` should show its tail with work-tail placement.
- Version temp-helper output filenames whenever generated inline commands change, especially in `autopilot.js` and `Tasks/contractor.js`.
- On fresh 8GB starts, avoid temp helpers for cheap reads. Use direct `ns.getResetInfo`, `getServerMaxRam`, `getServerUsedRam`, `getPlayer`, `getMoneySources`, `scan`, `ps`, `hasRootAccess`, and world-daemon checks when cheaper.
- `autopilot.js` has low `ramOverride`; avoid direct expensive Singularity purchase APIs after worker orchestration. Use guarded helpers or early spawn handoffs. `spawn-handoff.js` needs about 3.6GB in DEV 3.0.
- Gate Singularity on actual cheap call availability, not Source-File metadata or optional helper success. Pass `--singularity-confirmed` to children when known; faction work exits quietly if Singularity is unavailable.
- `autopilot.js` discovers managed children across all servers via direct `ns.ps(server)`, throttles short-lived dispatcher relaunches, and prints a startup version/sync marker. `work-for-factions.js` should print one when diagnosing launch behavior.
- After casino and before workers, when Singularity is available, buy bootstrap items: home RAM target, TOR, and port crackers. Confirm TOR with `ns.hasTorRouter()`, not `purchaseTor()` return.

## Infiltration And Casino

- Infiltration code belongs only in `work-for-factions.js` and `infiltration-runner.js`; use explicit parameters and remove stale parallel helpers.
- Retry logs include concrete failure reasons. Short faction target logs include ETA, remaining rep, rep/run, and run count. ETA prefers observed successful durations per location over static difficulty.
- Hospitalization is retryable for the same target. `go-to-location-failed` is navigation failure, not hospitalization.
- Sticky failures for the selected company include `start-failed`, `infiltrate.js-start-failed`, `direct-go-to-location-failed`, `grafting-active`, `missing-result`, and runner launch failures. Do not switch companies while the sticky target is reachable.
- For faction reputation, never downgrade to lower `tradeRep` because the best target had travel/start/location trouble. Cooldowns may apply only to money fallback.
- Normal Singularity flow handles city travel in `work-for-factions.js`, then launches `infiltration-runner.js` with travel disabled. Do not pass `--allow-travel`; if city is wrong, rerun direct travel and return `direct-travel-failed` on failure.
- If `GRAFTING` is active, pause faction infiltration instead of opening locations or starting gym training, except BN3 TRP/faction progression may treat grafting as background. Log one concise paused status for the sticky target.
- After normal infiltration attempts, hospitalize if HP is below max and the estimated cost is affordable.
- Prefer a local target that can finish remaining faction rep in one run. Among sufficient one-run targets, choose fastest/simplest, not maximum rep/run. Use `Departure from ...` and `Arrived from ...` for travel logs.
- Keep `Shadows of Anarchy` immediately after `Sector-12` in the default faction queue, but never target it directly for work/rewards. For SoA progression, only `SoA - phyzical WKS harmonizer` is a target augmentation.
- Before the first casino run, if cash is below travel/seed threshold, `autopilot.js` may launch exactly one direct `Joe's Guns` cash `infiltration-runner.js`. Do not start daemon, faction work, grafting, stockmaster, or other fallbacks first.
- Pre-casino runner path is 8GB-safe and standalone: no `helpers.js`, no `ns.getPlayer()`, no `ns.singularity.*`, no temp helpers for DOM/UI/infiltrate control. Retry stale/failed results, stop `infiltrate.js`, clear modals, repeatedly dismiss `Decide later`, then `ns.spawn(...)` completion scripts. For Joe's Guns, hand off directly to `casino.js --game roulette`.
- `casino.js` stays a lightweight dispatcher and `ns.spawn(...)`s the selected game. `casino-roulette.js` also uses `ns.spawn(...)` for completion handoff.
- Decide casino vs workers immediately from cash, casino history, net worth, and launch constraints; do not wait for an arbitrary income baseline.
- Casino automation must not intentionally exceed `$10b` from `sinceInstall.casino`; skip once that cap or current cash/net worth makes casino useless. Casino games, including roulette/blackjack, cap per-round bets so a likely win does not cross it.
- On low-RAM first casino runs, spawn `casino.js --game roulette`, not roulette directly. `autopilot.js` cleans RAM before casino; `casino.js` does not.
- Casino scripts close faction invite modals before timeout/kickout handling and completion handoff. Completion state survives `ns.spawn(autopilot.js)`. Shared casino helpers must not directly reference `ns.singularity.*`.

## Augmentations, Reserves, And Stocks

- `NeuroFlux Governor` is not a normal target. Buy NF only as leftover spend after concrete non-NF goals are in the final order; drop it first if budget shrinks. NF rep top-ups are capped final cleanup only, around 25k rep, and must not delay useful early resets.
- Donations are not a general reputation shortcut. Donate only for `The Red Pill` once it is the active path and post-pill cash is no longer strategic.
- Purchase/top-up affordability must recompute the full normalized final order with prerequisites and price multipliers; never rely on stale marginal estimates.
- Outside BN8, protect higher-rep or more expensive concrete non-NF targets before lower fillers. Active/recent faction rep targets that are budget-plausible, including small near-budget gaps, delay lower purchases until a fresh faction-work idle/no-action signal.
- `work-for-factions.js` keeps recent target history and publishes active infiltration ETA/run count in `/Temp/work-for-factions-rep-target.txt`; `faction-manager.js --manage-installs` uses it to decide wait vs early useful install.
- If no concrete target is practical or ETA is long, `faction-manager.js --manage-installs` may early-install a useful non-NF batch instead of idling behind huge reputation walls.
- `faction-manager.js` preflights final augmentation prerequisites before buying and aborts invalid orders. Display/summary simulations must not mutate global joined/owned state.
- Model hidden/runtime prereqs for `Cranial Signal Processors`, `Embedded Netburner Module Core`, and `BLADE-51b Tesla Armor`.
- `/Temp/affordable-augs.txt` is read by `autopilot.js`; `faction-manager.js` must keep it valid/fresh after purchases and before install decisions.
- Purchase profiles belong in `faction-manager.js --purchase-mode`; other scripts should call short modes, not duplicate long arg bundles or call `purchaseAugmentation` directly.
- `work-for-factions.js` never launches `faction-manager.js --purchase`. When `faction-manager.js --manage-installs` hands off to `ascend.js`, pass `--spend-all-before-install` and `--skip-faction-manager-purchase` so augmentation selection stays in `faction-manager.js`. `ascend.js` must not reset without explicit reset/install flags.
- While faction reputation is being ground, Hacknet hashes prioritize `Generate Coding Contract` before server money/security boosts.
- `reserve.txt` is cash-only for concrete near-term actions, not long-term savings. If no concrete action is near-term, write `0`.
- Affordability gates include liquidatable stock value unless there is a specific reason not to. Reserve only the cash gap not covered by stocks; liquidate or hand off when net worth can fund an action but cash cannot.
- `faction-manager.js --purchase` respects `reserve.txt`; if liquidating stocks for a positive-cost aug order, write the planned reserve, pause/kill stockmaster as appropriate, and abort partial purchases if liquidation fails. Do not liquidate stocks for empty or zero-cost orders.
- `faction-manager.js --manage-installs` status shows planned cost, cash, stocks, existing reserve, cash+stocks budget, cash still needed, and concise blocker. Label affordable install-time top-ups as top-ups, not blockers.
- `daemon.js` omits `--reserve 0` for stockmaster in autopilot mode so stockmaster reads `reserve.txt`. If stockmaster sees impossible mixed long/short positions, close both and recover.

## BitNode Routes And Faction Work

- BN3 first-install mode installs exactly one non-NF augmentation; if none is purchasable, it may install affordable NF fallback. It ends after the first augmentation reset (`lastAugReset` vs `lastNodeReset`), even if only NF was installed.
- During BN3 first-install mode, daemon launches `work-for-factions.js` before hacking/stat helpers and may bypass normal home RAM reserve. `work-for-factions.js` prioritizes `Sector-12` even under crime-focus and does not train for Slum Snakes first.
- In BN3 after the first non-NF install, prioritize `Sector-12` for `CashRoot Starter Kit` until installed. Keep Sector-12 relevant while CashRoot is awaiting install or gang duplicate filtering sees the same aug elsewhere. Default automation must not buy unrelated augs before CashRoot unless explicit desired flags are passed.
- In BN3, immediately after 4TB RAM bootstrap, buy/install `SoA - phyzical WKS harmonizer` via `faction-manager.js --purchase-mode soa-only` before CashRoot/Sector-12 work.
- BN3 Daedalus/TRP: do not let TRP donation, purchase, or `--install-for-augs` cause early reset while higher-rep or more expensive desired Daedalus augs remain outside the batch. Joined Daedalus non-NF augs are targets even if stat filters omit them.
- BN3 RAM bootstrap after casino targets 4TB, not 8TB. Keep stockmaster active, avoid full global cash reserves, liquidate only when net worth can immediately fund the next RAM upgrade, then let `ram-manager.js --budget 1 --reserve 0` buy.
- BN3 automatically runs the 4TB RAM bootstrap even without user-facing `--money-focus`. Explicit `autopilot.js --money-focus` suppresses non-money side activities until 4TB and corporation automation are running, or until 4TB if corporation is disabled.
- BN3 money-focus prioritizes corporation automation and may bypass the normal 4TB gate for `run-corporation.js`, while still requiring corporation availability and free RAM. Do not auto-launch `graft-manager.js` in BN3. Complete `SF3.3` before BN8/corp reliance outside BN3 if corporation APIs are missing.
- BN8 uses cheap-first frequent installs: buy affordable non-NF augs in actual purchase order, install immediately, avoid large thresholds, and never buy new NF.
- BN8 avoids global `reserve.txt`; keep stockmaster aggressive, use low cash fractions, preserve the live trader during liquidation unless full reset is intentional, and consider stock value for money-gated invites/travel/training with a larger reserve.
- BN8 gang income is hard-capped; do not spend cash on gang upgrades for money. Run only as a no-budget background trickle if active.
- BN8 switches to Red Pill preservation once Daedalus is joined or requirements are effectively met: stop other money-gated invites, buy/install only `The Red Pill`, treat TRP as purchasable despite stat filters and as a valid zero-cost order, throttle forced purchases, and buy needed port crackers after TRP install. Purchased-awaiting augs override Daedalus-invite waits.
- After BN10 is complete, incomplete Covenant sleeves/memory become top priority before leaving BN10. Do not buy NF or install because NF is available; keep stockmaster trading, protect only the needed cash gap, liquidate when net worth can fund the purchase, and ensure `sleeve.js` can spend the reserve.
- Default automation avoids company-work grinding and skips `Netburners` early while hacknet is deferred. Re-enable company/Netburners only in explicit late-game paths.
- Hacking study for invites is focused when focus penalties matter. Crime fallback needs a concrete kills/karma goal; use practical homicide thresholds and safer crimes when needed.
- For combat-stat invites, train deficient stats directly at gym, estimate per-stat ETA, and defer/log clearly if sequential ETA exceeds about 2 hours. Gym training may continue across travel only when cash covers gym plus travel/buffer; do not `stopAction()` current `CLASS` work after setup.
- Optional combat training for harder infiltration targets is ETA-gated. For hacking-or-combat invites such as Daedalus, prefer the hacking route when combat ETA is impractical and continue lower-priority work before idling.
- `work-for-factions.js` exits and writes reset-scoped idle/no-progress status when nothing is actionable or when yielding to Bladeburner, so daemon owns retry cadence and `faction-manager.js` can install available batches.
- BN3 `--crime-focus` keeps Slum Snakes as the practical early path but skips long crime-faction rep grinds unless explicit. BN13 must not enable automatic rush-gang crime focus by default.
- Money-focused `gangs.js` must not idle the whole gang for random training; keep only mandatory rebuild training for new/ascended members.
- BN6/BN7 or active Bladeburner defaults `faction-manager.js` to broad `*` augmentation desirability. Bladeburner rank counts as faction rep only after joining. Let `bladeburner.js` run when Bladeburner rep is the next blocker; outside BN6/BN7 do not wait merely for initial 100 combat stats unless already in Bladeburner.
- `work-for-factions.js` yields to Bladeburner only for active BlackOps unless a gang supplies most augs. Long rank grinds must not block faction work forever.
- Keep grafting isolated in `graft-manager.js`. In BN8, preserve Daedalus cash floor and focus on stock/cash acceleration. Support `violet Congruity Implant` and legacy `Congruity Implant`. `--min-net-worth null` means automatic threshold; explicit `0` disables it.

## Money, Hacking, Darknet, Corporation

- `daemon.js --hack-only` optimizes hack-only jobs, never full HWGW batches, and never tunes a hackable target below one hack thread.
- XP farming suppresses remote misfire toasts by description and args. Scheduled `Batch ...` weaken workers should not toast on zero reduction; keep late-start warnings.
- In `hack.js --money-focus`, money pipelines win. Spare RAM may run weaken-only XP only after every money target is active and top-ups are healthy; stop/back off immediately if money pipelines lose RAM. Never reduce a money batch to zero hack threads or use unbatched hack/grow XP against active money targets.
- In money-focus, skip targets where one hack thread exceeds `max-steal-percentage`; enforce steal ceilings with integer hack-thread counts.
- `autopilot.js --money-focus` allowed spenders are only money-path items: hacking infrastructure, home RAM, stock trading, TOR/port crackers, corporation, cash-only infiltration, Darknet phishing/caches, and ROI-gated hacknet/hash spending. `stats.js` may run. Do not manage `work-for-factions.js`, do not kill a user-started instance, and do not force-disable `Tasks/darknet-manager.js` unless the user explicitly disabled Darknet.
- Money infiltration uses `money-infiltration.js`, long-running by default; daemon launches it with `--run-once`.
- Pass `--money-focus` through daemon to `hack.js`; skip startup study/hack-XP kickstarts, ignore `--xp-only`, disable opportunistic low-util XP, and honor explicit overrides.
- Money-focus batching uses rolling continuous pipelines: refill before horizon drains, bound depth by weaken-time multiplier, default around 400 cycles, at least 5000ms queue headroom, capped initial/refill bursts, and realized-income validation via `getMoneySources().sinceInstall.hacking` plus `getTotalScriptIncome()`.
- Before scheduling, clear stale remote batch workers in chunks, rescan after first pass, and sync current worker files to rooted RAM hosts.
- Distribute money-focus batch jobs by host RAM-utilization percentage. Include Hacknet servers as execution hosts by default, with `--preserve-hacknet-servers` opt-out; never pass Hacknet hosts to target-only server APIs. Keep `Remote/manualhack-target.js` arg positions compatible.
- Launch hash spenders only when SF9/hash spending is available, hacknet is not disabled, at least one node/server exists, and capacity is positive. If none exist, exit after one clear status.
- Keep Bitburner 3.0 Darknet orchestration in `Tasks/darknet-manager.js`; autopilot should keep it running only after later progression, currently at least 8TB home RAM. Avoid normal-mode Darknet `tprint` spam.
- `darknet-worker.js` is the low-RAM crawler; expensive migration/stock-promotion APIs stay in helpers. Parse args defensively, check max/free RAM before `scp`/`exec`, cache authenticated passwords even on RAM skip, log skips once, and sync password/topology caches back to `home`.
- Darknet solvers use authenticate plus heartbleed/log feedback, not small fixed brute-force caps: `NIL`/`Yesn_t` per-position feedback, `Factori-Os` divisibility oracle, `OpenWebAccessPoint` packet dumps via `heartbleed(..., { peek: true })`, and `DeepGreen` leaked passwords first.
- Darknet phishing is valid money-focus income: keep crawler single-threaded and run `dnet.phishingAttack()` in a dedicated multi-thread worker on spare authenticated Darknet RAM. `darknet-storm.js` handles `STORM_SEED.exe` only on hosts with the file; migration/promotion helpers stay throttled.
- `Tasks/contractor.js` merges `ns.scan()` with Darknet caches, treats cached hosts as stale/untrusted, resolves malformed names through compatible dnet details APIs, and versions helper outputs.
- Corporation automation is available only in BN3 or SF3.3+. Keep `run-corporation.js` lightweight; delay launch until about 4TB home RAM and enough free RAM for `corporation.js`. Outside BN3, require cash+stocks for the $150b self-funded corporation unless one exists.
- `run-corporation.js` preflights cheaply and exits if unaffordable. `corporation.js` startup logs BN, SF3 level, and corporation existence, and enters management only after `getCorporation()` succeeds.
- Corporation expansion that is temporarily unaffordable is a wait state. Manage existing material divisions, restore office energy/morale with tea/parties until AutoBrew/AutoPartyManager, spend hashes before product division only on `Hi-Tech R&D Laboratory`, `AutoBrew`, and `AutoPartyManager`, and save for `Tobacco` as first product division including first product budget. Public corporations with too few divisions remain eligible for product-division expansion even if private funding rounds are no longer available.

## Validation And Files

- Do not close runtime-affecting changes on theory alone. Verify them in live runtime against `../bitburner-src` before the final response; use headless Chromium/Playwright for UI/runtime behavior when possible.
- Start game dev server from `../bitburner-src` with `npm run start:dev`. Start a separate sync bridge from this repo with `node local-sync-server.js --source-root /Volumes/SRC/bitburner-scripts --port 12526`.
- Never kill or reuse the user-owned `ws://127.0.0.1:12525` Remote API bridge. Use another port such as `12526`.
- Bitburner Remote API is file-only; `local-sync-server.js` must not pretend it can run scripts through that WebSocket. Script-free execution needs a separate CDP endpoint such as `--devtools-port ... --terminal-command ...`. A running `local-sync-server.js` does not pick up code changes.
- Reuse `/tmp/pwbb` helpers if present: `run_bb_command.mjs`, `run_bb_multi.mjs`, `run_bb_suite.mjs`.
- Run headless validations one at a time per Remote API port. A websocket `409` usually means harness conflict; "script does not exist on home" often means Remote API/session conflict before code bug.
- Distinguish compatibility bugs from fresh-save limits: missing SF4/Singularity, SF7/BN7 Bladeburner, BN10 sleeves, TIX/4S API, travel money, or helper RAM. `casino.js` may fail only because travel money is missing; `crime.js`, `stanek.js`, and `stanek.js.create.js` may hit helper RAM limits.
- For orchestration/runtime changes, always include a separate final fresh 8GB home live check, even if the main regression uses a later-game save. If behavior depends on UI state, say so and verify in live headless runtime.
- Keep verifier-only debug isolated. Infiltration diagnostics remain opt-in via `work-for-factions.js --infiltration-debug`, `infiltration-runner.js --debug`, or `infiltrate.js --debug`; normal automation launches `infiltrate.js --quiet`.
    - Files of interest: `work-for-factions.js` (faction/infiltration/training), `infiltration-runner.js` (one-shot executor), `faction-manager.js` (augs/purchase/install/status), `autopilot.js` (top-level handoff), `daemon.js` (managed launcher), `hack.js` (hacking runner), `../bitburner-src` (game source; use `nix develop` as needed).

## Test Execution

The tests for `darknet-worker` are now located in a separate file `tests/darknet-worker.tests.js`.

To run them, use the following command from the project root:

```bash
node -e "console.log(require('./darknet-worker.js').runSelfTest())"
```

The command will output an object in the format `{ total, passed, failures }`. If the `failures` array is empty, all tests passed successfully.
