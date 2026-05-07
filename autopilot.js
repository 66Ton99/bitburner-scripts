import {
    log, getFilePath, getConfiguration, getNsDataThroughFile, runCommand, waitForProcessToComplete,
    getActiveSourceFiles, tryGetBitNodeMultipliers, getStocksValue, unEscapeArrayArgs,
    formatMoney, formatDuration, formatRam, getErrorInfo, tail, jsonReplacer, scanAllServers
} from './helpers.js'

const autopilotVersion = "2026-05-07-daemon-owned-background-launches.1";
const stockValueHelperRam = 3.6;
const ownedAugmentationsHelperRam = 6.6;
const earlyBootstrapHelperRam = 12;
const preCasinoInfiltrationFile = "/Temp/autopilot-pre-casino-infiltration.txt";
const preCasinoInfiltrationResultFile = "/Temp/autopilot-pre-casino-infiltration-result.txt";
const earlyHomeRamTarget = 1024;

const preCasinoBlockedScripts = [
    'daemon.js',
    'work-for-factions.js',
    'stockmaster.js',
    'sleeve.js',
    'run-corporation.js',
    'corporation.js',
    'Tasks/darknet-manager.js',
    'graft-manager.js',
    'gangs.js',
    'go.js',
    'stats.js',
    'hacknet-upgrade-manager.js',
    'spend-hacknet-hashes.js',
    'Tasks/tor-manager.js',
    'Tasks/program-manager.js',
    'Tasks/contractor.js',
    'Tasks/ram-manager.js',
    'Tasks/backdoor-all-servers.js',
    'Tasks/crack-host.js',
    'host-manager.js',
    'faction-manager.js',
    'bladeburner.js',
    'stanek.js',
    'analyze-hack.js',
    '/Remote/weak-target.js',
    '/Remote/grow-target.js',
    '/Remote/hack-target.js',
    '/Remote/manualhack-target.js',
    '/Remote/share.js',
];
const earlyBootstrapBlockedScripts = [
    'daemon.js',
    'hack.js',
    'work-for-factions.js',
    'stockmaster.js',
    'sleeve.js',
    'run-corporation.js',
    'corporation.js',
    'Tasks/darknet-manager.js',
    'graft-manager.js',
    'gangs.js',
    'go.js',
    'stats.js',
    'faction-manager.js',
];

const argsSchema = [ // The set of all command line arguments
    ['next-bn', 0], // If we destroy the current BN, the next BN to start
    ['disable-auto-destroy-bn', false], // Set to true if you do not want to auto destroy this BN when done
    ['install-at-aug-count', 6], // Automatically install when we can afford this many new augmentations (with NF only counting as 1). Note: This number will automatically be increased by 1 for every level of SF11 you have (up to 3)
    ['install-at-aug-plus-nf-count', 10], // or... automatically install when we can afford this many augmentations including additional levels of Neuroflux.  Note: This number will automatically be increased by 1 for every level of SF11 you have (up to 3)
    ['install-for-augs', ["The Red Pill"]], // or... automatically install as soon as we can afford one of these augmentations
    ['install-countdown', 5 * 60 * 1000], // If we're ready to install, wait this long first to see if more augs come online (we might just be gaining momentum)
    ['time-before-boosting-best-hack-server', 15 * 60 * 1000], // Wait this long before picking our best hack-income server and spending hashes on boosting it
    ['reduced-aug-requirement-per-hour', 0.5], // For every hour since the last reset, require this many fewer augs to install.
    ['interval', 2000], // Wake up this often (milliseconds) to check on things
    ['interval-check-scripts', 10000], // Get a listing of all running processes on home this frequently
    ['high-hack-threshold', 8000], // Once hack level reaches this, we start daemon in high-performance hacking mode
    ['enable-bladeburner', null], // (Deprecated) Bladeburner is now always enabled if it's available. Use '--disable-bladeburner' to explicitly turn off
    ['disable-bladeburner', false], // This will instruct daemon.js not to run the bladeburner.js, even if bladeburner is available.
    ['wait-for-4s-threshold', 0.9], // Set to 0 to not reset until we have 4S. If money is above this ratio of the 4S Tix API cost, don't reset until we buy it.
    ['disable-wait-for-4s', false], // If true, will doesn't wait for the 4S Tix API to be acquired under any circumstantes
    ['disable-rush-gangs', false], // Set to true to disable focusing work-for-faction on Karma until gangs are unlocked
    ['disable-casino', false], // Set to true to disable running the casino.js script automatically
    ['disable-corporation', false], // Set to true to disable running corporation automation when BN3/SF3.3 makes it available
    ['disable-darknet', false], // Set to true to disable running Bitburner 3.0 darknet automation
    ['disable-grafting', false], // Set to true to disable conservative augmentation grafting automation
    ['spend-hashes-on-server-hacking-threshold', 0.1], // Threshold for how good hacking multipliers must be to merit spending hashes for boosting hack income. Set to a large number to disable this entirely.
    ['on-completion-script', null], // Spawn this script when we defeat the bitnode
    ['on-completion-script-args', []], // Optional args to pass to the script when we defeat the bitnode
    ['xp-mode-interval-minutes', 55], // Every time this many minutes has elapsed, toggle daemon.js to runing in --xp-only mode, which prioritizes earning hack-exp rather than money
    ['xp-mode-duration-minutes', 5], // The number of minutes to keep daemon.js in --xp-only mode before switching back to normal money-earning mode.
    ['no-tail-windows', false], // Set to true to prevent the default behaviour of opening a tail window for certain launched scripts. (Doesn't affect scripts that open their own tail windows)
];

export function autocomplete(data, args) {
    data.flags(argsSchema);
    const lastFlag = args.length > 1 ? args[args.length - 2] : null;
    if (["--on-completion-script"].includes(lastFlag))
        return data.scripts;
    return [];
}

/** The entire program is now wrapped in the main functino to avoid objects in
 * global shared memory surviving between multiple invocations of this script.
 * @param {NS} ns **/
export async function main(ns) {
    ns.ramOverride(7.8);
    ns.disableLog('disableLog');
    for (const logName of ['scan', 'getServerMaxRam', 'getServerUsedRam', 'getServerMoneyAvailable', 'ps', 'sleep'])
        ns.disableLog(logName);
    const persistentLog = "log.autopilot.txt";
    const factionManagerOutputFile = "/Temp/affordable-augs.txt"; // Temp file produced by faction manager with status information
    const lateGameNetburnersMoneyThreshold = 100e9;
    const lateGameCompanyWorkMoneyThreshold = 100e9;
    const defaultBnOrder = [ // The order in which we intend to play bitnodes
        // 1st Priority: Key new features and/or major stat boosts
        4.3,  // Normal. Need singularity to automate everything, and need the API costs reduced from 16x -> 4x -> 1x reliably do so from the start of each BN
        1.2,  // Easy.   Big boost to all multipliers (16% -> 24%), and no penalties to slow us down. Should go quick.
        5.1,  // Normal. Unlock intelligence stat early to maximize growth, getBitNodeMultipliers + Formulas.exe for more accurate scripts, and +8% hack mults
        1.3,  // Easy.   The last bonus is not as big a jump (24% -> 28%), but it's low-hanging fruit
        2.1,  // Easy.   Unlocks gangs, which reduces the need to grind faction and company rep for getting access to most augmentations, speeding up all BNs

        // 2nd Priority: More new features, from Harder BNs. Things will slow down for a while, but the new features should pay in dividends for all future BNs
        10.1, // Hard.   Unlock Sleeves (which tremendously speed along gangs outside of BN2) and grafting (can speed up slow rep-gain BNs).
        8.2,  // Hard.   8.1 immediately unlocks stocks, 8.2 doubles stock earning rate with shorts. Stocks are never nerfed in any BN (4S can be made too pricey though), and we have a good pre-4S stock script.
        13.1, // Hard.   Unlock Stanek's Gift. We've put a lot of effort into min/maxing the Tetris, so we should try to get it early, even though it's a hard BN. I might change my mind and push this down if it proves too slow.
        7.1,  // Hard.   Unlocks the bladeburner API (and bladeburner outside of BN 6/7). Many recommend it before BN9 since it ends up being a faster win condition in some of the tougher bitnodes ahead.
        9.1,  // Hard.   Unlocks hacknet servers. Hashes can be earned and spent on cash very early in a tough BN to help kick-start things. Hacknet productin/costs improved by 12%
        14.2, // Hard.   Boosts go.js bonuses, but note that we can automate IPvGO from the very start (BN1.1), no need to unlock it. 14.1 doubles all bonuses. 14.2 unlocks the cheat API.

        // 3nd Priority: With most features unlocked, max out SF levels roughly in the order of greatest boost and/or easiest difficulty, to hardest and/or less worthwhile
        2.3,  // Easy.   Boosts to crime success / money / CHA will speed along gangs, training and earning augmentations in the future
        5.3,  // Normal. Diminishing boost to hacking multipliers (8% -> 12% -> 14%), but relatively normal bitnode, especially with other features unlocked
        11.3, // Normal. Decrease augmentation cost scaling in a reset (4% -> 6% -> 7%) (can buy more augs per reset). Also boosts company salary/rep (32% -> 48% -> 56%), which we have little use for with gangs.)
        14.3, // Hard.   Makes go.js cheats slightly more successful, increases max go favour from (100->120) and not too difficult to get out of the way
        13.3, // Hard.   Make stanek's gift bigger to get more/different boosts
        9.2,  // Hard.   Start with 128 GB home ram. Speeds up slow-starting new BNs, but less important with good ram-dodging scripts. Hacknet productin/costs improved by 12% -> 18%.
        9.3,  // Hard.   Start each new BN with an already powerful hacknet server, but *only until the first reset*, which is a bit of a damper. Hacknet productin/costs improved by 18% -> 21%
        10.3, // Hard.   Get the last 2 sleeves (6 => 8) to boost their productivity ~30%. These really help with Bladeburner below.

        // 4th Priority: Play some Bladeburners. Mostly not used to beat other BNs, because for much of the BN this can't be done concurrently with player actions like crime/faction work, and no other BNs are "tuned" to be beaten via Bladeburner win condition
        6.3,  // Normal. The 3 easier bladeburner BNs. Boosts combat stats by 8% -> 12% -> 14%
        7.3,  // Hard.   The remaining 2 hard bladeburner BNs. Boosts all Bladeburner mults by 8% -> 12% -> 14%, so no interaction with other BNs unless trying to win via Bladeburner.

        // Low Priority:
        8.3,  // Hard.   Just gives stock "Limit orders" which we don't use in our scripts,
        3.3,  // Hard.   Corporations. Autopilot can now run corporation automation in BN3/SF3.3+, but this remains lower priority than broader automation unlocks.
        12.9999 // Easy. Keep playing forever. Only stanek scales very well here, there is much work to be done to be able to climb these faster.
    ];
    const augTRP = "The Red Pill";
    const augCashRoot = "CashRoot Starter Kit";
    const augStanek = `Stanek's Gift - Genesis`;
    const portCrackerCosts = {
        "BruteSSH.exe": 500e3,
        "FTPCrack.exe": 1.5e6,
        "relaySMTP.exe": 5e6,
        "HTTPWorm.exe": 30e6,
        "SQLInject.exe": 250e6,
    };
    const portCrackerNames = Object.keys(portCrackerCosts);

    let options; // The options used at construction time
    let playerInGang = false, rushGang = false; // Tells us whether we're should be trying to work towards getting into a gang
    let playerInBladeburner = false; // Whether we've joined bladeburner
    let wdHack = (/**@returns{null|number}*/() => null)(); // If the WD server is available (i.e. TRP is installed), caches the required hack level
    let ranCasino = false; // Flag to indicate whether we've stolen 10b from the casino yet
    let reservedPurchase = 0; // The amount of player money that has been reserved to purchase augmentations
    let alreadyJoinedDaedalus = false, autoJoinDaedalusUnavailable = false, reservingMoneyForDaedalus = false, disableStockmasterForDaedalus = false; // Flags to indicate that we should be keeping 100b cash on hand to earn an invite to Daedalus
    let prioritizeHackForDaedalus = false, prioritizeHackForWd = false;
    let lastScriptsCheck = 0; // Last time we got a listing of all running scripts
    let homeRam = 0; // Amount of RAM on the home server, last we checked
    let killScripts = []; // A list of scripts flagged to be restarted due to changes in priority
    let criticalAutopilotRamReserve = 0; // Home RAM needed for autopilot's own temp-helper scripts.
    let dictOwnedSourceFiles = (/**@returns{{[k: number]: number;}}*/() => [])(); // Player owned source files
    let unlockedSFs = [], nextBn = 0; // Info for the current bitnode
    let resetInfo = (/**@returns{ResetInfo}*/() => undefined)(); // Information about the current bitnode
    let bitNodeMults = (/**@returns{BitNodeMultipliers}*/() => undefined)(); // bitNode multipliers that can be automatically determined after SF-5
    let singularityAvailable = false; // Whether Singularity calls actually work in this runtime.
    let playerInstalledAugCount = (/**@returns{null|number}*/() => null)(); // Number of augs installed, or null if we don't have SF4 and can't tell.
    let installedAugmentations = [];
    let acceptedStanek = false, stanekLaunched = false;
    let daemonStartTime = 0; // The time we personally launched daemon.
    let installCountdown = 0; // Start of a countdown before we install augmentations.
    let installCountdownResets = 0; // Number of times we've reset the countdown because our affordable augs has increased
    let lastFactionManagerRefresh = 0; // Last time autopilot refreshed faction-manager output itself
    let bnCompletionSuppressed = false; // Flag if we've detected that we've won the BN, but are suppressing a restart
    let sleevesMaxedOut = false; // Flag used only when the player is replaying BN 10 with all sleeves but has suppressed auto-destroying the BN, to allow continued auto-installs
    let bn10SleevesIncomplete = false; // Flag used after BN10 is complete to preserve cash for Covenant sleeve purchases
    let bn10SleeveReserve = 0; // Current cash reserve needed for the next Covenant sleeve or memory purchase
    let cachedStocksValue = 0;
    let forceStockLiquidation = false;
    let loggedBnCompletion = false; // Flag set to ensure that if we choose to stay in the BN, we only log the "BN completed" message once per reset.
    let have4STixApi = false; // Whether we have access to the 4S (stockmarket) API. Once confirmed true, we can stop checking.
    let have4SData = false; // Whether we have access to 4S (stockmarket) data. Once confirmed true, we can stop checking.

    // Replacements for player properties deprecated since 2.3.0
    function getTimeInAug() { return Date.now() - resetInfo.lastAugReset; }
    function getTimeInBitnode() { return Date.now() - resetInfo.lastNodeReset; }

    /** @param {NS} ns **/
    async function main_start(ns) {
        const runOptions = getConfiguration(ns, argsSchema);
        if (!runOptions || directInstanceCount(ns) > 1) return; // Prevent multiple instances of this script from being started, even with different args.
        options = runOptions; // We don't set the global "options" until we're sure this is the only running instance

        log(ns, `INFO: Auto-pilot engaged... version ${autopilotVersion}`, true, 'info');
        dismissFactionInvitationModalDirect(ns);
        // The game does not allow boolean flags to be turned "off" via command line, only on. Since this gets saved, notify the user about how they can turn it off.
        const flagsSet = ['disable-auto-destroy-bn', 'disable-bladeburner', 'disable-wait-for-4s', 'disable-rush-gangs', 'disable-corporation', 'disable-darknet', 'disable-grafting'].filter(f => options[f]);
        for (const flag of flagsSet)
            log(ns, `WARNING: You have previously enabled the flag "--${flag}". Because of the way this script saves its run settings, the ` +
                `only way to now turn this back off will be to manually edit or delete the file ${ns.getScriptName()}.config.txt`, true);

        let startUpRan = false, keepRunning = true;
        while (keepRunning) {
            try {
                // Start-up actions, wrapped in error handling in case of temporary failures
                if (!startUpRan) startUpRan = await startUp(ns);
                // Main loop: Monitor progress in the current BN and automatically reset when we can afford TRP, or N augs.
                keepRunning = await mainLoop(ns);
            }
            catch (err) {
                log(ns, `WARNING: autopilot.js Caught (and suppressed) an unexpected error:` +
                    `\n${getErrorInfo(err)}`, false, 'warning');
                keepRunning = shouldWeKeepRunning(ns);
            }
            await ns.sleep(options['interval']);
        }
    }

    /** @param {NS} ns **/
    async function startUp(ns) {
        await persistConfigChanges(ns);

        // Collect and cache some one-time data
        resetInfo = ns.getResetInfo();
        bitNodeMults = await tryGetBitNodeMultipliers(ns);
        dictOwnedSourceFiles = await getActiveSourceFiles(ns, false);
        unlockedSFs = await getActiveSourceFiles(ns, true);
        homeRam = ns.getServerMaxRam("home");
        try {
            ns.singularity.isFocused();
            singularityAvailable = true;
        } catch (err) {
            singularityAvailable = false;
            installedAugmentations = [];
            playerInstalledAugCount = null; // 'null' is treated as 'Unknown'
            log(ns, `WARNING: This script requires Singularity functions to assess purchasable augmentations and ascend automatically. ` +
                `Some functionality will be disabled and you'll have to manage working for factions, purchasing, and installing augmentations yourself.`, true);
        }
        if (singularityAvailable) {
            criticalAutopilotRamReserve = Math.max(criticalAutopilotRamReserve,
                ns.getScriptRam('/Temp/player-augs-installed.txt.js', 'home'));
            const freeRam = getHomeFreeRam(ns);
            if (freeRam >= ownedAugmentationsHelperRam) {
                try {
                    installedAugmentations = await getNsDataThroughFile(ns, 'ns.singularity.getOwnedAugmentations()', '/Temp/player-augs-installed.txt');
                    playerInstalledAugCount = installedAugmentations.length;
                } catch (err) {
                    installedAugmentations = [];
                    playerInstalledAugCount = null;
                    log_once(ns, `WARNING: failed to refresh owned augmentations at startup. ` +
                        `Singularity is still available; continuing with cached/unknown augmentation data until the next successful refresh.`, true, 'warning');
                }
            } else {
                installedAugmentations = [];
                playerInstalledAugCount = null;
                log_once(ns, `INFO: Skipping owned augmentation refresh until home has enough free RAM. ` +
                    `Needs about ${formatRam(ownedAugmentationsHelperRam)}, free ${formatRam(freeRam)}.`);
            }
        }
        const currentBnProgress = `${resetInfo.currentNode}.${(dictOwnedSourceFiles[resetInfo.currentNode] || 0) + 1}`;
        log(ns, `INFO: Runtime capabilities: BN${currentBnProgress}, ` +
            `SF4=${unlockedSFs[4] || 0}, singularityAvailable=${singularityAvailable}.`, true, 'info');
        // We currently no longer have any one-time logic that needs to be run at the start of a new bitnode
        //if (getTimeInBitnode() < 60 * 1000) // Skip initialization if we've been in the bitnode for more than 1 minute
        //    await initializeNewBitnode(ns);

        // Decide what the next-up bitnode should be
        const getSFLevel = bn => Number(bn + "." + ((dictOwnedSourceFiles[bn] || 0) + (resetInfo.currentNode == bn ? 1 : 0)));
        const nextSfEarned = getSFLevel(resetInfo.currentNode);
        const nextRecommendedSf = defaultBnOrder.find(v => v - Math.floor(v) > getSFLevel(Math.floor(v)) - Math.floor(v));
        const nextRecommendedBn = Math.floor(nextRecommendedSf);
        nextBn = options['next-bn'] || nextRecommendedBn;
        log(ns, `INFO: After the current BN (${nextSfEarned}), the next recommended BN is ${nextRecommendedBn} until you have SF ${nextRecommendedSf}.` +
            `\nYou are currently earning SF${nextSfEarned}, and you already own the following source files: ` +
            Object.keys(dictOwnedSourceFiles).map(bn => `${bn}.${dictOwnedSourceFiles[bn]}`).join(", "));
        if (nextBn != nextRecommendedBn)
            log(ns, `WARN: The next recommended BN is ${nextRecommendedBn}, but the --next-bn parameter is set to override this with ${nextBn}.`, true, 'warning');

        return true;
    }

    /** Count current script instances without temp-helper RAM overhead. */
    function directInstanceCount(ns) {
        const scriptName = ns.getScriptName();
        return ns.ps("home").filter(process => process.filename == scriptName).length;
    }

    /** Write any configuration changes to disk so that they will survive resets and new bitnodes
     * @param {NS} ns **/
    async function persistConfigChanges(ns) {
        // Because we cannot pass args to "install" and "destroy" functions, we write them to disk to override defaults
        const changedArgs = argsSchema
            .filter(a => JSON.stringify(options[a[0]], jsonReplacer) != JSON.stringify(a[1]), jsonReplacer)
            .map(a => [a[0], options[a[0]]]);
        // Fix Bug #237 - do not overwrite the config file if one of the arguments provided is of the wrong type
        // This is a copy of new code in helpers.js which generates warnings, but otherwise ignores the errors.
        // We evaluate the same logic here because we want to act on the errors (avoid persisting them)
        for (const [key, finalValue] of changedArgs) {
            const defaultValue = argsSchema.find(kvp => kvp[0] == key)[1];
            const strFinalValue = JSON.stringify(finalValue, jsonReplacer);
            const strDefaultValue = JSON.stringify(defaultValue, jsonReplacer);
            log(ns, `INFO: Default config has been modified: ${key}=${strFinalValue} (type="${typeof finalValue})" ` +
                `does not match default value of ${key}=${strDefaultValue} (type="${typeof defaultValue}").`);
            if ((typeof finalValue) !== (typeof defaultValue) && defaultValue != null) {
                log(ns, `WARNING: A configuration value provided (${key}=${strFinalValue} - ` +
                    `type="${typeof finalValue}") does not match the expected type "${typeof defaultValue}" ` +
                    `based on the default value (${key}=${strDefaultValue}).` +
                    `\nThis configuration will NOT be persisted, and the script may behave unpredictably.`);
                return;
            }
            if (finalValue !== defaultValue && (typeof finalValue == 'number') && Number.isNaN(finalValue)) {
                log(ns, `WARNING: A numeric configuration value (--${key}) got a value of "NaN" (Not a Number), ` +
                    `which likely indicates it was set to a string value that could not be parsed. ` +
                    `Please double-check the script arguments for mistakes or typos.` +
                    `\nThis configuration will NOT be persisted, and the script may behave unpredictably.`);
                return;
            }
        }

        const strConfigChanges = JSON.stringify(changedArgs, jsonReplacer);
        // Only update the config file if it doesn't match the most resent set of run args
        const configPath = `${ns.getScriptName()}.config.txt`
        const currentConfig = ns.read(configPath);
        if ((strConfigChanges.length > 2 || currentConfig) && strConfigChanges != currentConfig) {
            ns.write(configPath, strConfigChanges, "w");
            log(ns, `INFO: Updated "${configPath}" to persist the most recent run args through resets: ${strConfigChanges}`, true, 'info');
        }
    }

    /** Logic run once at the beginning of a new BN
     * @param {NS} ns */
    async function initializeNewBitnode(ns) {
        // Nothing to do here (yet)
    }

    /** Logic run periodically throughout the BN
     * @param {NS} ns */
    async function mainLoop(ns) {
        forceStockLiquidation = false;
        const player = await getPlayerInfo(ns);
        if (handlePreCasinoBootstrap(ns, player))
            return shouldWeKeepRunning(ns);
        await updateCachedData(ns);
        const stocksValue = await getStocksValueIfRamAvailable(ns);
        cachedStocksValue = stocksValue;
        await checkOnDaedalusStatus(ns, player, stocksValue);
        await checkIfBnIsComplete(ns, player);
        if (await maybeBuyWorldDaemonPortCrackers(ns, player, stocksValue))
            return shouldWeKeepRunning(ns);
        manageReservedMoney(ns, player, stocksValue);
        await maybeAcceptStaneksGift(ns, player);
        if (await maybeDoCasino(ns, player))
            return shouldWeKeepRunning(ns);
        await checkOnRunningScripts(ns, player);
        await maybeInstallAugmentations(ns, player);
        return shouldWeKeepRunning(ns); // Return false to shut down autopilot.js if we installed augs, or don't have enough home RAM
    }

    /** On a fresh 8GB reset, do the casino cash bootstrap before any other helper-heavy orchestration.
     * @param {NS} ns
     * @param {Player} player
     * @returns {boolean} true when pre-casino handling should block the normal loop. */
    function handlePreCasinoBootstrap(ns, player) {
        const casinoBootstrapPending = !options['disable-casino'] && !ranCasino &&
            resetInfo.currentNode != 8 && player.money < 300000;
        if (!casinoBootstrapPending)
            return false;

        const runningScripts = getRunningScriptsDirect(ns);
        const findScript = (baseScriptName, filter = null) => findScriptHelper(baseScriptName, runningScripts, filter);
        const runningPreCasinoInfiltration = findScript('infiltration-runner.js',
            s => s.args.includes("--cash") && s.args.includes("--company") && s.args.includes("Joe's Guns"));
        const killedCount = stopPreCasinoAutomationDirect(ns, runningScripts);
        const infiltrationMarker = `${resetInfo.lastAugReset}:Joe's Guns:cash`;
        if (runningPreCasinoInfiltration) {
            if (ns.read(preCasinoInfiltrationFile) != infiltrationMarker)
                ns.write(preCasinoInfiltrationFile, infiltrationMarker, "w");
            log_once(ns, `INFO: Casino bootstrap is below ${formatMoney(300000)}. ` +
                `Waiting for the one direct pre-casino infiltration at Joe's Guns to finish` +
                `${killedCount > 0 ? `; stopped ${killedCount} existing background script${killedCount == 1 ? '' : 's'}` : ''}.`);
            return true;
        }

        const preCasinoResult = parseJsonSafe(ns.read(preCasinoInfiltrationResultFile));
        const preCasinoResultReason = String(preCasinoResult?.reason ?? '');
        const retryStalePreCasinoResult = preCasinoResultReason.startsWith('exception:') &&
            preCasinoResultReason.includes('/Temp/infiltration-');
        const shouldStartPreCasinoInfiltration = ns.read(preCasinoInfiltrationFile) != infiltrationMarker ||
            !preCasinoResult ||
            retryStalePreCasinoResult ||
            !preCasinoResult?.success && ['launching', 'started', 'hospitalized-retrying',
                'infiltrate.js-start-failed', 'start-failed', 'button-not-found'].includes(preCasinoResult?.reason);
        if (shouldStartPreCasinoInfiltration) {
            ns.write(preCasinoInfiltrationFile, infiltrationMarker, "w");
            ns.write(preCasinoInfiltrationResultFile, JSON.stringify({ success: false, reason: 'launching' }), "w");
            log(ns, `INFO: Casino bootstrap is below ${formatMoney(300000)}. ` +
                `Spawning one direct pre-casino infiltration at Joe's Guns for cash.`, true, 'info');
            ns.spawn(getFilePath('infiltration-runner.js'), {
                threads: 1,
                spawnDelay: 100,
            }, '--city', 'Sector-12', '--company', "Joe's Guns", '--cash',
                '--result-file', preCasinoInfiltrationResultFile,
                '--on-completion-script', getFilePath('casino.js'),
                '--on-completion-script-args', JSON.stringify(['--game', 'roulette',
                    '--kill-all-scripts', true, '--on-completion-script', ns.getScriptName()]));
            return true;
        }

        log_once(ns, `INFO: Casino bootstrap is below ${formatMoney(300000)}. ` +
            `The direct pre-casino infiltration at Joe's Guns already ended (${preCasinoResult?.reason ?? 'unknown'}); ` +
            `no other automation will be launched` +
            `${killedCount > 0 ? `; stopped ${killedCount} existing background script${killedCount == 1 ? '' : 's'}` : ''}.`,
            true, 'info');
        return true;
    }

    /** Read player info directly. Temp-helper overhead is too high immediately after roulette on 8GB home.
     * @param {NS} ns
     * @returns {Player} */
    function getPlayerInfo(ns) {
        return ns.getPlayer();
    }

    /** Dismiss faction invite modals that can remain after the casino handoff.
     * @param {NS} ns */
    function dismissFactionInvitationModalDirect(ns) {
        try {
            const doc = eval("document");
            const button = Array.from(doc.querySelectorAll("button"))
                .find(btn => btn.textContent?.trim() == "Decide later");
            if (!button) return false;
            button.click();
            log(ns, `INFO: Dismissed blocking faction invitation modal.`, false, 'info');
            return true;
        } catch {
            return false;
        }
    }

    /** Update some information that can be safely cached for small periods of time
     * @param {NS} ns */
    async function updateCachedData(ns) {
        // Now that grafting is a thing, we need to check if new augmentations have been installed between resets
        if (singularityAvailable) { // Note: Installed augmentations can also be obtained from getResetInfo() (without SF4), but this seems unintended and will probably be removed from the game.
            const freeRam = getHomeFreeRam(ns);
            if (freeRam < ownedAugmentationsHelperRam) {
                log_once(ns, `INFO: Skipping owned augmentation refresh until home has enough free RAM. ` +
                    `Needs about ${formatRam(ownedAugmentationsHelperRam)}, free ${formatRam(freeRam)}.`);
                return;
            }
            try {
                installedAugmentations = await getNsDataThroughFile(ns, 'ns.singularity.getOwnedAugmentations()', '/Temp/player-augs-installed.txt');
                playerInstalledAugCount = installedAugmentations.length;
            } catch (err) {
                log_once(ns, `WARNING: failed to update owned augmentations (low RAM?). ` +
                    `Continuing with cached augmentation data until the next successful refresh.`, true, 'warning');
            }
        }
    }

    async function getStocksValueIfRamAvailable(ns) {
        const freeRam = getHomeFreeRam(ns);
        if (homeRam == 8 || freeRam < stockValueHelperRam) {
            log_once(ns, `INFO: Skipping stock-value refresh until home has enough free RAM. ` +
                `Needs about ${formatRam(stockValueHelperRam)}, free ${formatRam(freeRam)}.`);
            return cachedStocksValue || 0;
        }
        try {
            return await getStocksValue(ns);
        } catch {
            return cachedStocksValue || 0;
        }
    }

    /** Logic run periodically to if there is anything we can do to speed along earning a Daedalus invite
     * @param {NS} ns
     * @param {Player} player **/
    async function checkOnDaedalusStatus(ns, player, stocksValue) {
        // Early exit conditions, if we Daedalus is not (or is no longer) a concern for this reset
        if (alreadyJoinedDaedalus || autoJoinDaedalusUnavailable) {
            prioritizeHackForDaedalus = false;
            return;
        }
        // If we've already installed the red pill we no longer need to try to join this faction.
        // Even without SF4, we can "deduce" whether we've installed TRP by checking whether w0r1d_d43m0n has a non-zero hack level
        if (installedAugmentations.includes(augTRP) || (wdHack != null && Number.isFinite(wdHack) && wdHack > 0)) {
            prioritizeHackForDaedalus = false;
            return alreadyJoinedDaedalus = true; // Set up an early exit condition for future checks
        }
        // See if we even have enough augmentations to attempt to join Daedalus (once we have a count of our augmentations)
        if (playerInstalledAugCount !== null && playerInstalledAugCount < bitNodeMults.DaedalusAugsRequirement) {
            prioritizeHackForDaedalus = false;
            if (!(10 in unlockedSFs))
                autoJoinDaedalusUnavailable = true; // Won't be able to unlock daedalus this ascend if we can't graft augs and have to install for them
            return; // Either way, for now we can't get into Daedalus without more augmentations
        }

        // See if we've already joined this faction
        if (player.factions.includes("Daedalus")) {
            alreadyJoinedDaedalus = true;
            disableStockmasterForDaedalus = false;
            // If we previously took any action to "rush" Daedalus, keep the momentum going by restarting work-for-factions.js
            // so that it immediately re-assesses priorities and sees there's a new priority faction to earn reputation for.
            if (prioritizeHackForDaedalus || reservingMoneyForDaedalus) {
                let reason;
                if (prioritizeHackForDaedalus) {
                    prioritizeHackForDaedalus = false; // Can turn off this flag now so daemon.js can be reverted
                    reason = "by prioritizing hack exp gains";
                }
                if (reservingMoneyForDaedalus) {
                    reservingMoneyForDaedalus = false; // Turn this flag off now so we reset our reserve.txt
                    reason = (reason ? reason + " and" : "by") + " saving up our money";
                }
                log(ns, `SUCCESS: We sped along joining the faction 'Daedalus' ${reason}. ` + // Pat ourselves on the back
                    `Restarting daemon.js so managed faction work immediately re-assesses priorities.`, false, 'success');
                killScripts.push("daemon.js"); // Schedule this to be killed (will be restarted) on the next script loop.
                lastScriptsCheck = 0; // Reset cooldown on checking whether any changes need to be made to running scripts
            }
            return;
        }
        const moneyReq = 100E9;
        // If we've previously set a flag to wait for the daedalus invite and reserve money, try to speed-along joining them
        if (reservingMoneyForDaedalus && player.money >= moneyReq) { // If our cash has dipped below the threshold again, we may need to take action below
            prioritizeHackForDaedalus = false;
            return await getNsDataThroughFile(ns, 'ns.singularity.joinFaction(ns.args[0])', null, ["Daedalus"]); // Note, we should have already checked that we have SF4 access before reserving money
        }

        // Remaining logic below is for rushing a Daedalus invite in the current reset
        const totalWorth = player.money + stocksValue;
        // Check for sufficient hacking level before attempting to reserve money
        if (player.skills.hacking < 2500) {
            prioritizeHackForDaedalus = false;
            // If we happen to already have enough money for daedalus and are only waiting on hack-level,
            // set a flag to switch daemon.js into --xp-only mode, to prioritize earning hack exp over money
            // HEURISTIC (i.e. Hack): Only do this if we naturally get within 75% of the hack stat requirement,
            //    otherwise, assume our hack gain rate is too low in this reset to make it all the way to 2500.
            if (totalWorth >= moneyReq && player.skills.hacking >= (2500 * 0.75))
                prioritizeHackForDaedalus = true;
            //log(ns, `total worth: ${formatMoney(totalWorth)} moneyReq: ${formatMoney(moneyReq)} prioritizeHackForDaedalus: ${prioritizeHackForDaedalus}`)
            return reservingMoneyForDaedalus = false; // Don't reserve money until hack level suffices
        }
        prioritizeHackForDaedalus = false;
        // If we have sufficient augs and hacking, the only requirement left is the money (100b)
        // If our net worth is sufficient, reserve our money and liquidate stocks if necessary until we get the invite
        if (player.money < moneyReq && totalWorth > moneyReq * 1.001 /* slight buffer to account for timing issues */) {
            // Note: Without SF4, we have no way of knowing how many augmentations we own, so we should probably
            //       never reserve money in case this requirement is not met, or we're potentially just wasting money
            if (!singularityAvailable) {
                log(ns, `SUCCESS: ${player.money < moneyReq ? "If you sell your stocks, y" : "Y"}ou should have enough money ` +
                    `(>=${formatMoney(moneyReq)}) and a sufficiently high hack level (>=${2500}) to get an invite from the faction Daedalus. ` +
                    `Before you attempt this though, ensure you have ${bitNodeMults.DaedalusAugsRequirement} ` +
                    `augmentations installed (scripts cannot check this without SF4).`, true, 'success');
                return autoJoinDaedalusUnavailable = true; // We won't show this again.
            }
            reservingMoneyForDaedalus = true; // Flag to pause all spending (set reserve.txt) until we've gotten the Daedalus invite
            if (player.money < moneyReq) { // Only liquidate stocks if we don't have enough cash lying around.
                if (resetInfo.currentNode != 8)
                    disableStockmasterForDaedalus = true; // Flag to keep stockmaster offline until we've gotten a daedalus invite
                log(ns, "INFO: Temporarily liquidating stocks to earn an invite to Daedalus...", true, 'info');
                forceStockLiquidation = true;
            } // else if we don't liquidate stocks, and our money dips below 100E9 again, we can always do it on the next loop
        } else if (resetInfo.currentNode == 8) {
            // In BN8, wait for the $100b Daedalus money requirement without writing a global reserve.
            // Stocks are the money engine here, so reserve.txt must stay clear and stockmaster must keep trading.
            reservingMoneyForDaedalus = true;
        } // Cancel the reserve if our money drops below the threshold before getting an invite (due to other scripts not respecting the reserve?)
        else if (reservingMoneyForDaedalus && totalWorth < moneyReq * 0.999 /* slight buffer to let cash recover */) {
            reservingMoneyForDaedalus = false; // Cancel the hold on funds, and wait for total worth to increase again
            disableStockmasterForDaedalus = false; // Allow stockmaster to be relaunched
            log(ns, `WARN: We previously had sufficient wealth to earn a Daedalus invite (>=${formatMoney(moneyReq)}), ` +
                `but our wealth somehow decreased (to ${formatMoney(totalWorth)}) before the invite was recieved, ` +
                `so we'll need to wait for it to recover and try again later.`, false, 'warning');
        }
    }

    /** Logic run periodically throughout the BN to see if we are ready to complete it.
     * @param {NS} ns
     * @param {Player} player */
    async function checkIfBnIsComplete(ns, player) {
        if (bnCompletionSuppressed) return true;
        if (wdHack === null) { // If we haven't checked yet, see if w0r1d_d43m0n (server) has been unlocked and get its required hack level
            wdHack = ns.scan("The-Cave").includes("w0r1d_d43m0n") ?
                ns.getServerRequiredHackingLevel("w0r1d_d43m0n") : Number.POSITIVE_INFINITY;
        }
        // Detect if a BN win condition has been met
        let bnComplete = player.skills.hacking >= wdHack;

        // We cannot technically destroy WD until we have root. If we recently reset, we may have to wait a bit
        // for daemon.js to get a little money, buy the crack tools, and nuke the server first.
        if (bnComplete) {
            const caveRooted = ns.hasRootAccess("w0r1d_d43m0n");
            if (!caveRooted)
                bnComplete = false;
        }

        // Detect the BB win condition (requires SF7 (bladeburner API) or being in BN6)
        if (7 in unlockedSFs) // No point making this async check if bladeburner API is unavailable
            playerInBladeburner = playerInBladeburner || await getNsDataThroughFile(ns, 'ns.bladeburner.inBladeburner()');
        if (!bnComplete && playerInBladeburner)
            bnComplete = await getNsDataThroughFile(ns,
                `ns.bladeburner.getActionCountRemaining('Black Operations', 'Operation Daedalus') === 0`,
                '/Temp/bladeburner-completed.txt');

        // HEURISTIC: If we naturally get within 75% of the if w0r1d_d43m0n hack stat requirement,
        //    switch daemon.js to prioritize earning hack exp for the remainder of the BN
        if (player.skills.hacking >= (wdHack * 0.75))
            prioritizeHackForWd = !bnComplete;

        if (!bnComplete) return false; // No win conditions met


        if (!loggedBnCompletion) {
            const text = `BN ${resetInfo.currentNode}.${(dictOwnedSourceFiles[resetInfo.currentNode] || 0) + 1} completed at ` +
                `${formatDuration(getTimeInBitnode())} ` +
                `(${(player.skills.hacking >= wdHack ? `hack (${wdHack.toFixed(0)})` : 'bladeburner')} win condition)`;
            persist_log(ns, text);
            log(ns, `SUCCESS: ${text}`, true, 'success');
            loggedBnCompletion = true; // Flag set to ensure that if we choose to stay in the BN, we only log the "BN completed" message once per reset.
        }

        // Run the --on-completion-script if specified
        if (options['on-completion-script']) {
            const pid = launchScriptHelper(ns, options['on-completion-script'], unEscapeArrayArgs(options['on-completion-script-args']), false);
            if (pid) await waitForProcessToComplete(ns, pid);
        }

        // Check if there is some reason not to automatically destroy this BN
        if (resetInfo.currentNode == 10) { // Suggest the user doesn't reset until they buy all sleeves and max memory
            const shouldHaveSleeveCount = Math.min(8, 6 + (dictOwnedSourceFiles[10] || 0));
            const numSleeves = await getNsDataThroughFile(ns, `ns.sleeve.getNumSleeves()`);
            let reasonToStay = null;
            bn10SleevesIncomplete = false;
            bn10SleeveReserve = 0;
            if (numSleeves < shouldHaveSleeveCount) {
                reasonToStay = `Detected that you only have ${numSleeves} sleeves, but you could have ${shouldHaveSleeveCount}.`;
                bn10SleevesIncomplete = true;
                bn10SleeveReserve = await getNsDataThroughFile(ns, `ns.sleeve.getSleeveCost()`);
            } else {
                let sleeveInfo = (/** @returns {SleevePerson[]} */() => [])();
                sleeveInfo = await getNsDataThroughFile(ns, `ns.args.map(i => ns.sleeve.getSleeve(i))`, '/Temp/sleeve-getSleeve-all.txt', [...Array(numSleeves).keys()]);
                if (sleeveInfo.some(s => s.memory < 100)) {
                    reasonToStay = `Detected that you have ${numSleeves}/${shouldHaveSleeveCount} sleeves, but they do not all have the maximum memory of 100:\n  ` +
                        sleeveInfo.map((s, i) => `- Sleeve ${i} has ${s.memory}/100 memory`).join('\n  ');
                    bn10SleevesIncomplete = true;
                    bn10SleeveReserve = Math.max(...await getNsDataThroughFile(ns,
                        `ns.args.map(i => ns.sleeve.getMemoryUpgradeCost(i, 100 - ns.sleeve.getSleeve(i).memory))`,
                        '/Temp/sleeve-memory-costs.txt', [...Array(numSleeves).keys()]));
                } else
                    sleevesMaxedOut = true; // Flag is used elsewhere to allow continued installs
            }
            if (reasonToStay) {
                log_once(ns, `WARNING: ${reasonToStay}\nAutomation should keep buying sleeves and sleeve memory from "The Covenant" while you remain in BN10 and have enough money.` +
                    `\nNOTE: You can ONLY buy sleeves & memory from The Covenant in BN10, so auto-reset will keep waiting until this is done.`, true);
                return true; // Return true, but do not set `bnCompletionSuppressed = true` so we can auto-reset once sleeve automation finishes.
            }
        }
        if (options['disable-auto-destroy-bn']) {
            log(ns, `--disable-auto-destroy-bn is set, you can manually exit the bitnode when ready.`, true);
            return bnCompletionSuppressed = true;
        }
        if (!singularityAvailable) {
            log(ns, `You do not own SF4, so you must manually exit the bitnode (` +
                `${player.skills.hacking >= wdHack ? "by hacking W0r1dD43m0n" : "on the bladeburner BlackOps tab"}).`, true);
            return bnCompletionSuppressed = true;
        }

        // Clean out our temp folder and flags so we don't have any stale data when the next BN starts.
        let pid = launchScriptHelper(ns, 'cleanup.js');
        if (pid) await waitForProcessToComplete(ns, pid);

        // In all likelihood, daemon.js has already nuked this like it does all servers, but in case it hasn't:
        pid = launchScriptHelper(ns, '/Tasks/crack-host.js', ['w0r1d_d43m0n']);
        if (pid) await waitForProcessToComplete(ns, pid);

        // Use the new special singularity function to automate entering a new BN
        pid = await runCommand(ns, `ns.singularity.destroyW0r1dD43m0n(ns.args[0], ns.args[1]` +
            `, { sourceFileOverrides: new Map() }` + // Work around a long-standing bug on bitburner-official.github.io TODO: Remove when no longer needed
            `)`, '/Temp/singularity-destroyW0r1dD43m0n.js', [nextBn, ns.getScriptName()]);
        if (pid) {
            log(ns, `SUCCESS: Initiated process ${pid} to execute 'singularity.destroyW0r1dD43m0n' with args: [${nextBn}, ${ns.getScriptName()}]`, true, 'success')
            await waitForProcessToComplete(ns, pid);
            log(ns, `WARNING: Process is done running, why am I still here? Sleeping 10 seconds...`, true, 'error')
            await ns.sleep(10000);
        }
        persist_log(ns, log(ns, `ERROR: Tried destroy the bitnode (pid=${pid}), but we're still here...`, true, 'error'));
        //return bnCompletionSuppressed = true; // Don't suppress bn Completion, try again on our next loop.
    }

    /** In BN8 the final WD path depends on port crackers, but most cash may be invested in stocks.
     * @param {NS} ns
     * @param {Player} player
     * @param {number} stocksValue */
    async function maybeBuyWorldDaemonPortCrackers(ns, player, stocksValue) {
        if (resetInfo.currentNode != 8 || !installedAugmentations.includes(augTRP))
            return false;
        const missingPrograms = await getNsDataThroughFile(ns,
            `ns.args.filter(program => !ns.fileExists(program, "home"))`,
            '/Temp/bn8-missing-port-crackers.txt', portCrackerNames);
        if (missingPrograms.length == 0)
            return false;
        const needsTor = !await getNsDataThroughFile(ns, `ns.scan("home").includes("darkweb")`, '/Temp/has-tor-router.txt');
        const missingCost = missingPrograms.reduce((total, program) => total + (portCrackerCosts[program] || 0), needsTor ? 200e3 : 0);
        if (player.money < missingCost && stocksValue > 0 && player.money + stocksValue >= missingCost) {
            log(ns, `INFO: BN8 final path needs ${missingPrograms.join(", ")} for w0r1d_d43m0n. ` +
                `Liquidating stocks so programs can be purchased. Need ${formatMoney(missingCost)}, ` +
                `cash ${formatMoney(player.money)}, stock ${formatMoney(stocksValue)}.`, true, 'info');
            forceStockLiquidation = true;
            return false;
        }
        if (player.money < missingCost) {
            log_once(ns, `INFO: BN8 final path is waiting for ${formatMoney(missingCost)} cash to buy port crackers for w0r1d_d43m0n. ` +
                `Missing: ${missingPrograms.join(", ")}. Current cash ${formatMoney(player.money)}, stock ${formatMoney(stocksValue)}.`);
            return false;
        }
        if (needsTor)
            await getNsDataThroughFile(ns, `ns.singularity.purchaseTor()`, '/Temp/bn8-purchase-tor.txt');
        const purchasedPrograms = await getNsDataThroughFile(ns,
            `ns.args.filter(program => ns.singularity.purchaseProgram(program))`,
            '/Temp/bn8-purchase-port-crackers.txt', missingPrograms);
        if (purchasedPrograms.length > 0) {
            log(ns, `SUCCESS: Purchased BN8 final path port crackers: ${purchasedPrograms.join(", ")}.`, true, 'success');
            killScripts.push("daemon.js");
            lastScriptsCheck = 0;
            return true;
        }
        return false;
    }

    /** Helper to get a list of all scripts running across known servers.
     * @param {NS} ns */
    async function getRunningScripts(ns) {
        return getRunningScriptsDirect(ns);
    }

    /** Direct running-script scan for low-RAM paths where temp helpers cannot be used.
     * @param {NS} ns */
    function getRunningScriptsDirect(ns) {
        return scanAllServers(ns).flatMap(server =>
            ns.ps(server).map(process => ({ ...process, server })));
    }

    /** Helper to get the first instance of a running script by name.
     * @param {NS} ns
     * @param {string} baseScriptName The name of a script (before applying getFilePath)
     * @param {ProcessInfo[]} runningScripts - (optional) Cached list of running scripts to avoid repeating this expensive request
     * @param {(value: ProcessInfo, index: number, array: ProcessInfo[]) => unknown} filter - (optional) Filter the list of processes beyond just matching on the script name */
    function findScriptHelper(baseScriptName, runningScripts, filter = null) {
        return runningScripts.filter(s => s.filename == getFilePath(baseScriptName) && (!filter || filter(s)))[0];
    }

    /** Helper to kill a running script instance by name
     * @param {NS} ns
     * @param {ProcessInfo[]} runningScripts - (optional) Cached list of running scripts to avoid repeating this expensive request
     * @param {ProcessInfo} processInfo - (optional) The process to kill, if we've already found it in advance */
    async function killScript(ns, baseScriptName, runningScripts = null, processInfo = null) {
        processInfo = processInfo || findScriptHelper(baseScriptName, runningScripts || (await getRunningScripts(ns)))
        if (processInfo) {
            log(ns, `INFO: Killing script ${baseScriptName} with pid ${processInfo.pid} and args: [${processInfo.args.join(", ")}].`, false, 'info');
            return await getNsDataThroughFile(ns, 'ns.kill(ns.args[0])', null, [processInfo.pid]);
        }
        log(ns, `INFO: Skipping request to kill script ${baseScriptName}, no running instance was found...`, false, 'warning');
        return false;
    }

    /** Stop all autopilot-managed background scripts before the first casino run.
     * @param {NS} ns
     * @param {ProcessInfo[]} runningScripts */
    async function stopPreCasinoAutomation(ns, runningScripts) {
        const blockedScriptNames = new Set(preCasinoBlockedScripts.map(script => getFilePath(script)));
        let killedCount = 0;
        for (const processInfo of runningScripts.filter(process => blockedScriptNames.has(process.filename))) {
            log(ns, `INFO: Pre-casino mode: killing ${processInfo.filename} with pid ${processInfo.pid} and args: [${processInfo.args.join(", ")}].`, false, 'info');
            if (await getNsDataThroughFile(ns, 'ns.kill(ns.args[0])', null, [processInfo.pid]))
                killedCount++;
        }
        return killedCount;
    }

    /** Direct low-RAM variant of stopPreCasinoAutomation.
     * @param {NS} ns
     * @param {ProcessInfo[]} runningScripts */
    function stopPreCasinoAutomationDirect(ns, runningScripts) {
        const blockedScriptNames = new Set(preCasinoBlockedScripts.map(script => getFilePath(script)));
        let killedCount = 0;
        for (const processInfo of runningScripts.filter(process => blockedScriptNames.has(process.filename))) {
            log(ns, `INFO: Pre-casino mode: killing ${processInfo.filename} with pid ${processInfo.pid} and args: [${processInfo.args.join(", ")}].`, false, 'info');
            if (ns.kill(processInfo.pid))
                killedCount++;
        }
        return killedCount;
    }

    /** Stop home-only autopilot-managed workers if they are blocking the permanent RAM bootstrap helper.
     * @param {NS} ns
     * @param {ProcessInfo[]} runningScripts */
    function stopEarlyBootstrapBlockersDirect(ns, runningScripts) {
        const blockedScriptNames = new Set(earlyBootstrapBlockedScripts.map(script => getFilePath(script)));
        let killedCount = 0;
        for (const processInfo of runningScripts.filter(process =>
            process.server == "home" && blockedScriptNames.has(process.filename))) {
            log(ns, `INFO: Early RAM bootstrap: killing ${processInfo.filename} with pid ${processInfo.pid} and args: [${processInfo.args.join(", ")}].`, false, 'info');
            if (ns.kill(processInfo.pid))
                killedCount++;
        }
        return killedCount;
    }

    /** Logic to ensure scripts are running to progress the BN
     * @param {NS} ns
     * @param {Player} player */
    async function checkOnRunningScripts(ns, player) {
        if (lastScriptsCheck > Date.now() - options['interval-check-scripts']) return;
        lastScriptsCheck = Date.now();
        const runningScripts = await getRunningScripts(ns); // Cache the list of running scripts for the duration
        const findScript = /** @param {(value: ProcessInfo, index: number, array: ProcessInfo[]) => unknown} filter @returns {ProcessInfo} */
            (baseScriptName, filter = null) => findScriptHelper(baseScriptName, runningScripts, filter);

        // Kill any scripts that were flagged for restart
        while (killScripts.length > 0)
            await killScript(ns, killScripts.pop(), runningScripts);

        // See if home ram has improved. We hold back on launching certain scripts if we are low on home RAM
        homeRam = ns.getServerMaxRam("home");

        const casinoBootstrapPending = !options['disable-casino'] && !ranCasino &&
            resetInfo.currentNode != 8 && player.money < 300000;
        if (casinoBootstrapPending) {
            const runningPreCasinoInfiltration = findScript('infiltration-runner.js',
                s => s.args.includes("--cash") && s.args.includes("--company") && s.args.includes("Joe's Guns"));
            const killedCount = await stopPreCasinoAutomation(ns, runningScripts);
            const infiltrationMarker = `${resetInfo.lastAugReset}:Joe's Guns:cash`;
            if (runningPreCasinoInfiltration) {
                if (ns.read(preCasinoInfiltrationFile) != infiltrationMarker)
                    ns.write(preCasinoInfiltrationFile, infiltrationMarker, "w");
                log_once(ns, `INFO: Casino bootstrap is below ${formatMoney(300000)}. ` +
                    `Waiting for the one direct pre-casino infiltration at Joe's Guns to finish` +
                    `${killedCount > 0 ? `; stopped ${killedCount} existing background script${killedCount == 1 ? '' : 's'}` : ''}.`);
                return;
            }
            const preCasinoResult = parseJsonSafe(ns.read(preCasinoInfiltrationResultFile));
            const preCasinoResultReason = String(preCasinoResult?.reason ?? '');
            const retryStalePreCasinoResult = preCasinoResultReason.startsWith('exception:') &&
                preCasinoResultReason.includes('/Temp/infiltration-');
            const shouldStartPreCasinoInfiltration = ns.read(preCasinoInfiltrationFile) != infiltrationMarker ||
                !preCasinoResult ||
                retryStalePreCasinoResult ||
                !preCasinoResult?.success && ['launching', 'started', 'hospitalized-retrying',
                    'infiltrate.js-start-failed', 'start-failed', 'button-not-found'].includes(preCasinoResult?.reason);
            if (shouldStartPreCasinoInfiltration) {
                ns.write(preCasinoInfiltrationFile, infiltrationMarker, "w");
                ns.write(preCasinoInfiltrationResultFile, JSON.stringify({ success: false, reason: 'launching' }), "w");
                log(ns, `INFO: Casino bootstrap is below ${formatMoney(300000)}. ` +
                    `Spawning one direct pre-casino infiltration at Joe's Guns for cash.`, true, 'info');
                ns.spawn(getFilePath('infiltration-runner.js'), {
                    threads: 1,
                    spawnDelay: 100,
                }, '--city', 'Sector-12', '--company', "Joe's Guns", '--cash',
                    '--result-file', preCasinoInfiltrationResultFile,
                    '--on-completion-script', getFilePath('casino.js'),
                    '--on-completion-script-args', JSON.stringify(['--game', 'roulette',
                        '--kill-all-scripts', true, '--on-completion-script', ns.getScriptName()]));
                return;
            }
            log_once(ns, `INFO: Casino bootstrap is below ${formatMoney(300000)}. ` +
                `The direct pre-casino infiltration at Joe's Guns already ended (${preCasinoResult?.reason ?? 'unknown'}); ` +
                `no other automation will be launched` +
                `${killedCount > 0 ? `; stopped ${killedCount} existing background script${killedCount == 1 ? '' : 's'}` : ''}.`,
                true, 'info');
            return;
        }

        if (homeRam >= earlyBootstrapHelperRam + getCriticalAutopilotRamReserve() && homeRam < earlyHomeRamTarget) {
            const bootstrapRan = await tryEarlyPermanentBootstrapPurchases(ns);
            if (!bootstrapRan) {
                const killedCount = stopEarlyBootstrapBlockersDirect(ns, runningScripts);
                if (killedCount > 0) {
                    log(ns, `INFO: Stopped ${killedCount} home script${killedCount == 1 ? '' : 's'} so autopilot can buy permanent home RAM before relaunching workers.`, true, 'info');
                    return;
                }
                log_once(ns, `INFO: Waiting to buy permanent home RAM before launching workers. ` +
                    `Needs about ${formatRam(earlyBootstrapHelperRam)} free RAM, free ${formatRam(getHomeFreeRam(ns))}.`);
                return;
            }
        }

        if ((2 in unlockedSFs) && !playerInGang)
            playerInGang = await getNsDataThroughFile(ns, 'ns.gang.inGang()');
        if (bn10SleevesIncomplete && bn10SleeveReserve > 0 && player.money >= bn10SleeveReserve)
            await tryPurchaseBn10SleeveGoal(ns);

        if (!singularityAvailable) {
            const runningWorkForFactions = findScript('work-for-factions.js');
            if (runningWorkForFactions)
                await killScript(ns, 'work-for-factions.js', runningScripts, runningWorkForFactions);
        }

        const existingDaemon = findScript('daemon.js');
        let daemonArgs = []; // The args we currently want deamon to have
        let daemonRelaunchMessage; // Will hold any special messages we want to show the user if relaunching daemon.
        const pursueNetburnersLateGame = player.money >= lateGameNetburnersMoneyThreshold;
        const pursueCompanyFactionsLateGame = player.money >= lateGameCompanyWorkMoneyThreshold;
        const facmanOutput = getFactionManagerOutput(ns);
        const shouldForceSector12 = !installedAugmentations.includes(augCashRoot) &&
            !facmanOutput?.affordable_augs?.includes(augCashRoot) &&
            !facmanOutput?.awaiting_install_augs?.includes(augCashRoot);
        const stockCashFraction = (resetInfo.currentNode == 8 || bn10SleevesIncomplete) ? 0.001 : 0.1;
        const stockBuyFraction = (resetInfo.currentNode == 8 || bn10SleevesIncomplete) ? 0.001 : 0.4;
        if (pursueNetburnersLateGame || pursueCompanyFactionsLateGame) {
            const enabledFeatures = [];
            if (pursueNetburnersLateGame) enabledFeatures.push("hacknet progression for Netburners");
            if (pursueCompanyFactionsLateGame) enabledFeatures.push("company work for company factions");
            log_once(ns, `INFO: Late-game faction mode is active. Enabling ${enabledFeatures.join(" and ")}.`);
        }

        // If daemon.js is already running in --looping-mode, we should not restart it, because
        // TODO: currently daemon.js has no ability to kill it's loops on shutdown (so the next instance will be stuck with no RAM available)
        if (existingDaemon?.args.includes("--looping-mode"))
            daemonArgs = existingDaemon.args;
        else {
            // Determine the arguments we want to run daemon.js with. We will either pass these directly, or through stanek.js if we're running it first.
            const hackThreshold = options['high-hack-threshold']; // If player.skills.hacking level is about 8000, tweak daemon to increase income rates
            // When our hack level gets sufficiently high, hack/grow/weaken go so fast that spawning new scripts for each cycle becomes very
            // expensive / laggy. To help with this, daemon.js supports "looping mode", to just spawn one long-lived script that does H/G/W in a loop.
            if (false /* TODO: LOOPING MODE DISABLED UNTIL WORKING BETTER */ && player.skills.hacking >= hackThreshold) {
                daemonArgs = ["--looping-mode", "--cycle-timing-delay", 40, "--queue-delay", 2000, "--initial-max-targets", 61, "--silent-misfires",
                    "--recovery-thread-padding", Math.min(5.0, player.skills.hacking / hackThreshold)]; // Use more recovery thread padding as our hack level increases
                // Log a special notice if we're going to be relaunching daemon.js for this reason
                if (!existingDaemon || !(existingDaemon.args.includes("--looping-mode")))
                    daemonRelaunchMessage = `Hack level (${player.skills.hacking}) is >= ${hackThreshold} (--high-hack-threshold): Starting daemon.js in high-performance hacking mode.`;
            } else if (player.skills.hacking >= hackThreshold) { // "tight" mode. Tighter batches to increase income rate, at the cost of more frequent misfires
                daemonArgs = ["--cycle-timing-delay", 40, "--queue-delay", 50, "--silent-misfires",
                    "--recovery-thread-padding", Math.min(5.0, player.skills.hacking / hackThreshold)]; // Use more recovery thread padding as our hack level increases
            }
            else if (homeRam < 32) { // If we're in early BN 1.1 (i.e. with < 32GB home RAM), avoid squandering RAM
                daemonArgs.push("--initial-max-targets", 1);
            } else { // XP-ONLY MODE: We can shift daemon.js to this when we want to prioritize earning hack exp rather than money
                // Only do this if we aren't in --looping mode because TODO: currently it does not kill it's loops on shutdown, so they'd be stuck in hack exp mode
                let useXpOnlyMode = prioritizeHackForDaedalus || prioritizeHackForWd ||
                    // In BNs that give no money for hacking, always start daemon.js in this mode (except BN8, because TODO: --xp-only doesn't handle stock manipulation)
                    (bitNodeMults.ScriptHackMoney * bitNodeMults.ScriptHackMoneyGain == 0 && resetInfo.currentNode != 8);
                const timedXpModeHackCap = 2500;
                const allowTimedXpMode = player.skills.hacking < timedXpModeHackCap;
                if (!useXpOnlyMode && allowTimedXpMode) { // Otherwise, respect the configured interval / duration while hack XP still has meaningful near-term value
                    const xpInterval = Number(options['xp-mode-interval-minutes']);
                    const xpDuration = Number(options['xp-mode-duration-minutes']);
                    const minutesInAug = getTimeInAug() / 60.0 / 1000.0;
                    const xpPhase = minutesInAug % (xpInterval + xpDuration);
                    if (xpInterval > 0 && xpDuration > 0 && xpPhase >= xpInterval)
                        useXpOnlyMode = true; // We're in the time window where we should focus hack exp
                    // If daemon.js was previously running in hack exp mode, prepare a message indicating that we 're switching back
                    else if (existingDaemon?.args.includes("--xp-only"))
                        daemonRelaunchMessage = `Time is up for "xp-mode", Relaunching daemon.js normally to focus on earning money for ${xpInterval} minutes (--xp-mode-interval-minutes)`;
                } else if (!useXpOnlyMode && existingDaemon?.args.includes("--xp-only")) {
                    daemonRelaunchMessage = `Hack level (${player.skills.hacking}) is already high enough that timed "xp-mode" is no longer useful. Relaunching daemon.js normally to focus on earning money.`;
                }
                if (useXpOnlyMode) {
                    daemonArgs.push("--xp-only", "--silent-misfires");
                    // If daemon.js isn't already running in hack exp mode, prepare a message to communicate the change
                    if (!existingDaemon?.args.includes("--xp-only"))
                        daemonRelaunchMessage = prioritizeHackForWd ? `We're close to the required hack level destroy the BN.` :
                            prioritizeHackForDaedalus ? `Hack Level is the only missing requirement for Daedalus, so we will run daemon.js in --xp-only mode to try and speed along the invite.` :
                                (bitNodeMults.ScriptHackMoney * bitNodeMults.ScriptHackMoneyGain == 0) ?
                                    `The current BitNode does not give any money from hacking, so we will run daemon.js in --xp-only mode.` :
                                    `Relaunching daemon.js to focus on earning Hack Experience for ${options['xp-mode-duration-minutes']} minutes (--xp-mode-duration-minutes)`;
                }
            }
            if (pursueNetburnersLateGame)
                daemonArgs.push('--enable-hacknet-upgrade-manager');
            // Don't run the script to join and manage bladeburner if it is explicitly disabled
            if (options['disable-bladeburner']) daemonArgs.push('--disable-script', getFilePath('bladeburner.js'));
            if (disableStockmasterForDaedalus) daemonArgs.push('--disable-script', getFilePath('stockmaster.js'));
            // Relay the option to suppress tail windows
            if (options['no-tail-windows']) daemonArgs.push('--no-tail-windows');
            daemonArgs.push('--autopilot-mode');
            if (ranCasino || options['disable-casino']) daemonArgs.push('--casino-complete');
            if (singularityAvailable) daemonArgs.push('--singularity-confirmed');
            if (shouldForceSector12) daemonArgs.push('--cashroot-priority');
            if (options['disable-casino']) daemonArgs.push('--disable-casino');
            if (options['disable-corporation']) daemonArgs.push('--disable-corporation');
            if (options['disable-darknet']) daemonArgs.push('--disable-darknet');
            if (options['disable-grafting']) daemonArgs.push('--disable-grafting');
            if (options['disable-rush-gangs']) daemonArgs.push('--disable-rush-gangs');
            if (options['disable-bladeburner']) daemonArgs.push('--disable-bladeburner');
            if (pursueNetburnersLateGame) daemonArgs.push('--late-netburners');
            if (pursueCompanyFactionsLateGame) daemonArgs.push('--late-company-work');
            if (forceStockLiquidation) daemonArgs.push('--force-stock-liquidate');
            daemonArgs.push('--stock-cash-frac', stockCashFraction, '--stock-buy-frac', stockBuyFraction);
            if (bn10SleeveReserve > 0)
                daemonArgs.push('--bn10-sleeve-reserve', bn10SleeveReserve);
            if (options['time-before-boosting-best-hack-server'] != 900000)
                daemonArgs.push('--time-before-boosting-best-hack-server', options['time-before-boosting-best-hack-server']);
            if (options['spend-hashes-on-server-hacking-threshold'] != 0.1)
                daemonArgs.push('--spend-hashes-on-server-hacking-threshold', options['spend-hashes-on-server-hacking-threshold']);
        }

        // Once stanek's gift is accepted, launch it once per reset before we launch daemon (Note: stanek's gift is auto-purchased by faction-manager.js on your first install)
        let stanekRunning = (13 in unlockedSFs) && findScript('stanek.js') !== undefined;
        if ((13 in unlockedSFs) && !stanekLaunched && !stanekRunning && installedAugmentations.includes(augStanek)) {
            stanekLaunched = true; // Once we've know we've launched stanek once, we never have to again this reset.
            const stanekArgs = ["--on-completion-script", getFilePath('daemon.js')]
            if (options['no-tail-windows']) stanekArgs.push('--no-tail'); // Relay the option to suppress tail windows
            if (daemonArgs.length >= 0) stanekArgs.push("--on-completion-script-args", JSON.stringify(daemonArgs)); // Pass in all the args we wanted to run daemon.js with
            launchScriptHelper(ns, 'stanek.js', stanekArgs);
            stanekRunning = true;
        }
        // If stanek is running, tell daemon to reserve all home RAM for it.
        if (stanekRunning)
            daemonArgs.push("--reserved-ram", 1E100);

        // Launch (or re-launch) daemon if it is not already running with all our desired args.
        // Hack: Ignore numeric arguments in the comparison, since we e.g. tweak --recovery-thread-padding over time
        let launchDaemon = !existingDaemon || daemonArgs.some(arg => !existingDaemon.args.includes(arg) && !Number.isFinite(arg)) ||
            // Special cases: We also must relaunch daemon if it is running with certain flags we wish to remove
            (["--xp-only", "--hack-only"].some(arg => !daemonArgs.includes(arg) && existingDaemon.args.includes(arg))) ||
            (["--force-stock-liquidate", getFilePath('stockmaster.js'), getFilePath('bladeburner.js')]
                .some(script => existingDaemon?.args.includes(script) && !daemonArgs.includes(script)));
        if (launchDaemon) {
            if (existingDaemon) {
                daemonRelaunchMessage ??= `Relaunching daemon.js with new arguments since the current instance doesn't include all the args we want.`;
                log(ns, daemonRelaunchMessage);
            }
            if (homeRam == 8 && !singularityAvailable) {
                log(ns, `INFO: Spawning daemon.js directly and exiting autopilot to free RAM on 8GB home.`, true, 'info');
                ns.spawn(getFilePath('daemon.js'), {
                    threads: 1,
                    spawnDelay: 100,
                }, ...daemonArgs);
                return;
            }
            let daemonPid = launchScriptHelper(ns, 'daemon.js', daemonArgs);
            if (!daemonPid) return;
            daemonStartTime = Date.now();
            // Open the tail window if it's the start of a new BN. Especially useful to new players.
            if (getTimeInBitnode() < 1000 * 60 * 5 || homeRam == 8) // First 5 minutes, or BN1.1 where we have 8GB ram
                tail(ns, daemonPid);
        }

    }

    /** Buy exactly one missing BN10 Covenant sleeve infrastructure item when cash is already available.
     * This prevents autopilot from waiting for sleeve.js while still allowing stockmaster to keep trading.
     * @param {NS} ns */
    async function tryPurchaseBn10SleeveGoal(ns) {
        if (resetInfo.currentNode != 10 || !bn10SleevesIncomplete) return false;
        const shouldHaveSleeveCount = Math.min(8, 6 + (dictOwnedSourceFiles[10] || 0));
        const numSleeves = await getNsDataThroughFile(ns, `ns.sleeve.getNumSleeves()`);
        if (numSleeves < shouldHaveSleeveCount) {
            const cost = await getNsDataThroughFile(ns, `ns.sleeve.getSleeveCost()`);
            if ((await getPlayerInfo(ns)).money < cost) return false;
            const result = await getNsDataThroughFile(ns, `ns.sleeve.purchaseSleeve()`);
            if (result?.success) {
                log(ns, `SUCCESS: Purchased Covenant sleeve ${numSleeves} for ${formatMoney(cost)}.`, true, 'success');
                lastScriptsCheck = 0;
                return true;
            }
            log(ns, `WARNING: Failed to purchase Covenant sleeve: ${result?.message || "unknown error"}`, true, 'warning');
            return false;
        }

        const sleeveInfo = await getNsDataThroughFile(ns, `ns.args.map(i => ns.sleeve.getSleeve(i))`,
            '/Temp/autopilot-sleeve-getSleeve-all.txt', [...Array(numSleeves).keys()]);
        const sleeveToUpgrade = sleeveInfo.findIndex(sleeve => sleeve.memory < 100);
        if (sleeveToUpgrade == -1) {
            bn10SleevesIncomplete = false;
            bn10SleeveReserve = 0;
            return false;
        }
        const amount = 100 - sleeveInfo[sleeveToUpgrade].memory;
        const cost = await getNsDataThroughFile(ns, `ns.sleeve.getMemoryUpgradeCost(ns.args[0], ns.args[1])`, null, [sleeveToUpgrade, amount]);
        if ((await getPlayerInfo(ns)).money < cost) return false;
        const result = await getNsDataThroughFile(ns, `ns.sleeve.upgradeMemory(ns.args[0], ns.args[1])`, null, [sleeveToUpgrade, amount]);
        if (result?.success) {
            log(ns, `SUCCESS: Upgraded Covenant sleeve ${sleeveToUpgrade} memory to 100 for ${formatMoney(cost)}.`, true, 'success');
            lastScriptsCheck = 0;
            return true;
        }
        log(ns, `WARNING: Failed to upgrade Covenant sleeve ${sleeveToUpgrade} memory: ${result?.message || "unknown error"}`, true, 'warning');
        return false;
    }

    /** Get the source of the player's earnings by category.
     * @param {NS} ns
     * @returns {MoneySources} */
    function getPlayerMoneySources(ns) {
        return ns.getMoneySources();
    }

    /** Accept Stanek's gift immediately at the start of the BN (as opposed to just before the first install)
     * if it looks like it will scale well.
     * @param {NS} ns
     * @param {Player} player */
    async function maybeAcceptStaneksGift(ns, player) {
        // Look for any reason not to accept stanek's gift (do the quickest checks first)
        if (acceptedStanek) return;
        // Don't get Stanek's gift too early if its size is reduced in this BN
        if (bitNodeMults.StaneksGiftExtraSize < 0) return;
        // If Stanek's gift size isn't reduced, but is penalized, don't get it too early 
        if (bitNodeMults.StaneksGiftExtraSize == 0 && bitNodeMults.StaneksGiftPowerMultiplier < 1) return;
        // Otherwise, it is not penalized in any way, it's probably safe to get it immediately despite the 10% penalty to all stats
        // If we won't have access to Stanek yet, skip this
        if (!(13 in unlockedSFs)) return;
        // If we've already accepted Stanek's gift (Genesis aug is installed), skip
        if (installedAugmentations.includes(augStanek)) return acceptedStanek = true;
        // If we have more than Neuroflux (aug) installed, we won't be allowed to accept the gift (but we can try)
        if (installedAugmentations.length > 1)
            log(ns, `WARNING: We think it's a good idea to accept Stanek's Gift, but it appears to be too late - other augmentations have been installed. Trying Anyway...`);
        // Use the API to accept Stanek's gift
        if (await getNsDataThroughFile(ns, 'ns.stanek.acceptGift()')) {
            log(ns, `SUCCESS: Accepted Stanek's Gift!`, true, 'success');
            installedAugmentations.push(augStanek); // Manually add Genesis to installed augmentations so checkOnRunningScripts picks up on the change.
        } else
            log(ns, `WARNING: autopilot.js tried to accepted Stanek's Gift, but was denied.`, true, 'warning');
        // Whether we succeded or failed, don't try again - if we're denied entry (due to having an augmentation) we will never be allowed in
        acceptedStanek = true;
    }

    /** Logic to steal 10b from the casino
     * @param {NS} ns
     * @param {Player} player
     * @returns {Promise<boolean>} true when casino handling should block the rest of this autopilot loop. */
    async function maybeDoCasino(ns, player) {
        if (ranCasino || options['disable-casino']) return false;
        // Figure out whether we've already been kicked out of the casino for earning more than 10b there
        const moneySources = await getPlayerMoneySources(ns);
        const casinoEarnings = moneySources.sinceInstall.casino;
        if (casinoEarnings >= 1e10) {
            log(ns, `INFO: Skipping running casino.js, as we've previously earned ${formatMoney(casinoEarnings)} and been kicked out.`);
            ranCasino = true;
            return false;
        }
        // If we already have more than 1t money but hadn't run casino.js yet, don't bother. Another 10b won't move the needle much.
        const playerWealth = player.money + (await getStocksValueIfRamAvailable(ns));
        if (playerWealth >= 1e12) {
            log(ns, `INFO: Skipping running casino.js, since we're already ridiculously wealthy (${formatMoney(playerWealth)} > 1t).`);
            ranCasino = true;
            return false;
        }

        // If we're making more than ~5b / minute from the start of the BN, there's no need to run casino.
        // In BN8 this is impossible, so in that case we don't even check and head straight to the casino.
        if (resetInfo.currentNode != 8 && homeRam > 8) {
            // If we've been in the BN for less than 1 minute, wait a while to establish player's income rate 
            if (getTimeInAug() < 60000) {
                log_once(ns, `INFO: Waiting a minute to establish player income before deciding whether casino.js is needed.`);
                return false;
            }
            // Since it's possible that the CashRoot Startker Kit could give a false income velocity, account for that.
            const cashRootBought = installedAugmentations.includes(`CashRoot Starter Kit`);
            const incomePerMs = (playerWealth - (cashRootBought ? 1e6 : 0)) / getTimeInAug();
            const incomePerMinute = incomePerMs * 60_000;
            if (incomePerMinute >= 5e9) {
                log(ns, `INFO: Skipping running casino.js this augmentation, since our income (${formatMoney(incomePerMinute)}/min) >= 5b/min`);
                ranCasino = true;
                return false;
            }
        }

        // If we aren't in Aevum already, wait until we have the 200K required to travel (plus some extra buffer to actually spend at the casino)
        if (player.city != "Aevum" && player.money < 300000) {
            log_once(ns, `INFO: Waiting until we have ${formatMoney(300000)} to travel to Aevum and run casino.js`);
            return false;
        }

        const casinoGameScript = getFilePath('casino-roulette.js');
        const casinoDispatcherScript = getFilePath('casino.js');
        const casinoRam = ns.getScriptRam(casinoGameScript, 'home');
        if (casinoRam > homeRam)
            return !!log_once(ns, `INFO: Waiting to run casino roulette until home RAM is upgraded. ` +
                `${casinoGameScript} needs ${formatRam(casinoRam)}, but home only has ${formatRam(homeRam)}.`);

        // Spawn the lightweight dispatcher so autopilot's RAM is freed before roulette starts.
        // Make sure conflicting automation is dead first, lest it steal focus before roulette can kill all scripts.
        if (homeRam == 8) {
            stopPreCasinoAutomationDirect(ns, getRunningScriptsDirect(ns));
        } else {
            await killScript(ns, 'work-for-factions.js');
            await killScript(ns, 'daemon.js'); // We also have to kill daemon which can make us study.
        }
        ns.kill('infiltrate.js', 'home', '--quiet');
        // Kill any action, in case we are studying or working out, as it might steal focus or funds before we can bet it at the casino.
        if (singularityAvailable) // No big deal if we can't, casino.js has logic to find the stop button and click it.
            _ = await getNsDataThroughFile(ns, `ns.singularity.stopAction()`);

        log(ns, `INFO: Spawning casino.js for roulette so autopilot frees RAM before roulette starts.`, true, 'info');
        ns.spawn(casinoDispatcherScript, {
            threads: 1,
            spawnDelay: 100,
        }, '--game', 'roulette', '--kill-all-scripts', true, '--on-completion-script', ns.getScriptName());
        return true;
    }

    /** Buy the permanent early-game basics before daemon/host-manager can spend casino cash on temporary servers.
     * @param {NS} ns
     * @returns {Promise<boolean>} true if the helper ran, even if cash was insufficient for more purchases. */
    async function tryEarlyPermanentBootstrapPurchases(ns) {
        if (!singularityAvailable) return true;
        const freeRam = getHomeFreeRam(ns);
        if (freeRam < earlyBootstrapHelperRam) {
            log_once(ns, `INFO: Waiting to buy permanent bootstrap upgrades until home has enough free RAM. ` +
                `Needs about ${formatRam(earlyBootstrapHelperRam)}, free ${formatRam(freeRam)}.`);
            return false;
        }
        let result;
        try {
            result = await getNsDataThroughFile(ns, `(() => {
            const targetHomeRam = Number(ns.args[0]);
            const portCrackerCosts = JSON.parse(ns.args[1]);
            const portCrackerNames = JSON.parse(ns.args[2]);
            const result = { homeRamUpgrades: [], tor: false, programs: [] };
            let cash = ns.getServerMoneyAvailable("home");
            while (ns.getServerMaxRam("home") < targetHomeRam) {
                const cost = ns.singularity.getUpgradeHomeRamCost();
                if (!Number.isFinite(cost) || cash < cost) break;
                const before = ns.getServerMaxRam("home");
                if (!ns.singularity.upgradeHomeRam()) break;
                const after = ns.getServerMaxRam("home");
                result.homeRamUpgrades.push([before, after]);
                cash = ns.getServerMoneyAvailable("home");
            }
            if (!ns.scan("home").includes("darkweb") && cash >= 200000 && ns.singularity.purchaseTor()) {
                result.tor = true;
                cash = ns.getServerMoneyAvailable("home");
            }
            for (const program of portCrackerNames) {
                if (ns.fileExists(program, "home")) continue;
                const cost = portCrackerCosts[program];
                if (cash < cost) continue;
                if (ns.singularity.purchaseProgram(program)) {
                    result.programs.push(program);
                    cash = ns.getServerMoneyAvailable("home");
                }
            }
            result.homeRam = ns.getServerMaxRam("home");
            return result;
        })()`, '/Temp/early-bootstrap-purchases.txt', [
            earlyHomeRamTarget,
            JSON.stringify(portCrackerCosts),
            JSON.stringify(portCrackerNames),
        ]);
        } catch (err) {
            log_once(ns, `INFO: Permanent bootstrap purchase helper could not run yet. ` +
                `Waiting for more free home RAM before buying TOR/programs/home RAM.`);
            return false;
        }
        for (const [before, after] of result.homeRamUpgrades || [])
            log(ns, `SUCCESS: Upgraded home RAM from ${formatRam(before)} to ${formatRam(after)} before launching daemon.js.`, true, 'success');
        if (result.homeRamUpgrades?.length > 0)
            homeRam = result.homeRam || ns.getServerMaxRam("home");
        if (result.tor)
            log(ns, `SUCCESS: Purchased TOR router before launching daemon.js.`, true, 'success');
        if (result.programs?.length > 0)
            log(ns, `SUCCESS: Purchased port crackers before launching daemon.js: ${result.programs.join(", ")}.`, true, 'success');
        return true;
    }

    /** Retrieves the last faction manager output file, parses, and provides type-hints for it.
     * @returns {{ installed_augs: string[], installed_count: number, installed_count_nf: number, installed_count_ex_nf: number,
     *             owned_augs: string[], owned_count: number, owned_count_nf: number, owned_count_ex_nf: number,
     *             purchased_augs: string[], purchased_count: number, purchased_count_nf: number, purchased_count_ex_nf: number,
     *             awaiting_install_augs: string[], awaiting_install_count: number, awaiting_install_count_nf: number, awaiting_install_count_ex_nf: number,
     *             affordable_augs: string[], affordable_count: number, affordable_count_nf: number, affordable_count_ex_nf: number,
     *             total_rep_cost: number, total_aug_cost: number, unowned_count: number }} */
    function getFactionManagerOutput(ns) {
        const facmanOutput = ns.read(factionManagerOutputFile)
        return !facmanOutput ? null : JSON.parse(facmanOutput)
    }

    function getFactionManagerPurchaseArgs({ purchase = false, noNeuroflux = false } = {}) {
        const args = [];
        if (purchase) args.push("--purchase");
        if (noNeuroflux) args.push("--purchase-mode", "no-neuroflux");
        return args;
    }

    async function runFactionManagerForAugmentations(ns, argOptions) {
        ns.write(factionManagerOutputFile, "", "w");
        const pid = launchScriptHelper(ns, 'faction-manager.js', getFactionManagerPurchaseArgs(argOptions));
        if (pid) await waitForProcessToComplete(ns, pid, true);
        return pid;
    }

    /** Logic to detect if it's a good time to install augmentations, and if so, do so
     * @param {NS} ns
     * @param {Player} player */
    async function maybeInstallAugmentations(ns, player) {
        if (!singularityAvailable)  // Cannot automate augmentations or installs without singularity
            return setStatus(ns, `No singularity access, so you're on your own. You should manually work for factions and install augmentations!`);

        if (resetInfo.currentNode == 10 && bn10SleevesIncomplete) {
            setStatus(ns, `Not buying or installing augmentations because BN10 is complete and Covenant sleeves/memory are still missing. ` +
                `Reserving ${formatMoney(bn10SleeveReserve)} for the next sleeve purchase.`);
            return reservedPurchase = 0;
        }

        const bn8FrequentInstall = resetInfo.currentNode == 8;

        if (bn8FrequentInstall && (lastFactionManagerRefresh < resetInfo.lastAugReset || lastFactionManagerRefresh < Date.now() - 30 * 1000)) {
            lastFactionManagerRefresh = Date.now();
            await runFactionManagerForAugmentations(ns, { noNeuroflux: true });
        }

        // If we previously attempted to reserve money for an augmentation purchase order, do a fresh facman run to ensure it's still available
        if (reservedPurchase && installCountdown <= Date.now()) {
            log(ns, "INFO: Manually running faction-manager.js --purchase to lock in the reserved augmentation purchase.");
            await runFactionManagerForAugmentations(ns, { purchase: true, noNeuroflux: bn8FrequentInstall });
        }

        // Grab the latest output from faction manager to see if it's a good time to reset
        const facman = getFactionManagerOutput(ns);
        const bn8PurchasedAugmentations = bn8FrequentInstall ?
            await getNsDataThroughFile(ns, 'ns.singularity.getOwnedAugmentations(true)', '/Temp/player-augs-purchased.txt') : [];
        const bn8TrpPurchased = bn8PurchasedAugmentations.includes(augTRP);
        if (bn8FrequentInstall && player.factions.includes("Daedalus") && !installedAugmentations.includes(augTRP) && !bn8TrpPurchased) {
            log(ns, `INFO: BN8 Red Pill mode: joined Daedalus but "${augTRP}" is not purchased. ` +
                `Forcing a faction-manager purchase attempt.`);
            await runFactionManagerForAugmentations(ns, { purchase: true, noNeuroflux: true });
            return reservedPurchase = 0;
        }
        if (!facman) {
            setStatus(ns, `Faction manager output not available. Will try again later.`);
            return reservedPurchase = 0;
        }
        if (bn8FrequentInstall && bn8TrpPurchased && !installedAugmentations.includes(augTRP) &&
            !facman.awaiting_install_augs.includes(augTRP)) {
            log(ns, `INFO: "${augTRP}" is purchased according to Singularity, but faction-manager output is stale. Treating it as awaiting install.`);
            facman.awaiting_install_augs.push(augTRP);
            facman.awaiting_install_count++;
            facman.awaiting_install_count_ex_nf++;
            facman.purchased_count_ex_nf = Math.max(facman.purchased_count_ex_nf || 0, (facman.installed_count_ex_nf || 0) + facman.awaiting_install_count_ex_nf);
            facman.purchased_count = Math.max(facman.purchased_count || 0, (facman.installed_count || 0) + facman.awaiting_install_count);
        }
        playerInstalledAugCount = facman.installed_count; // Augmentations bought *and installed* by the player (used for Daedalus requirement)

        // If we're in BN9 (where hacknet is most important) and we're still on our first reset (where we have an upgraded hacknet node), resist installing
        const inFirstBn9Aug = resetInfo.currentNode == 9 && Math.abs(resetInfo.lastNodeReset - resetInfo.lastAugReset) < 1000;

        // Reduce the augmentations required to reset over time, except in cetain situations. This is because in most situations,
        // pefoming an ascention in a slow-going BN will let us lock in bonuses that will speed up overall pogression.
        let reducedAugReq = Math.floor(options['reduced-aug-requirement-per-hour'] * getTimeInAug() / 3.6E6);
        // In our first BN9 augmentation, use this mechanic to actually *increase* aug count requirements.
        if (inFirstBn9Aug)
            reducedAugReq = -2; // In our first BN9 augmentation, delay resetting as we'd lose our boosted hacknet server
        // Collect additional information about how many augmentations we need before it's worth resetting, based on the current configuration
        const sf11Level = dictOwnedSourceFiles[11] ?? 0; // SF11 makes augs scale cheaper, so for each level, require +1 augs
        const augsNeeded = Math.max(1, options['install-at-aug-count'] + sf11Level - reducedAugReq);
        const augsNeededInclNf = Math.max(1, options['install-at-aug-plus-nf-count'] + sf11Level - reducedAugReq);

        // Get a count of pending augmentations (augs we plan to buy, plus any we've bought but not yet installed)
        const awaitingInstallNonNfCount = Math.max(facman.awaiting_install_count_ex_nf || 0,
            (facman.purchased_count_ex_nf || 0) - (facman.installed_count_ex_nf || 0));
        const pendingAugCount = facman.affordable_count_ex_nf + awaitingInstallNonNfCount; // Excludes neuroflux levels
        const pendingNfCount = facman.affordable_count_nf + facman.awaiting_install_count_nf; // Only neuroflux levels
        const pendingAugInclNfCount = pendingAugCount + pendingNfCount; // Includes neuroflux levels
        // Create lists of augmentations already bought vs still affordable to buy. Group all NF levels into one entry per category.
        const strNF = "NeuroFlux Governor"
        let awaitingAugs = facman.awaiting_install_augs.filter(aug => aug != strNF);
        if (awaitingAugs.length == 0 && awaitingInstallNonNfCount > 0)
            awaitingAugs.push(`${awaitingInstallNonNfCount} non-NeuroFlux augmentations`);
        let affordableAugs = facman.affordable_augs.filter(aug => aug != strNF);
        if (facman.awaiting_install_count_nf > 0)
            awaitingAugs.push(`${strNF} (x${facman.awaiting_install_count_nf})`)
        if (facman.affordable_count_nf > 0)
            affordableAugs.push(`${strNF} (x${facman.affordable_count_nf})`)
        // Determine whether we can afford enough augmentations to merit a reset
        let totalCost = facman.total_rep_cost + facman.total_aug_cost;
        const augSummary = `${pendingAugCount} of ${facman.unpurchased_count - 1} remaining augmentations` + // Unowned - 1 because we can always buy more Neuroflux
            (pendingNfCount > 0 ? ` + ${pendingNfCount} levels of NeuroFlux.` : '.');
        const augDetailLines = [];
        if (awaitingAugs.length > 0)
            augDetailLines.push(`\n  Awaiting install: [\"${awaitingAugs.join("\", \"")}\"]`);
        if (affordableAugs.length > 0)
            augDetailLines.push(`\n  Affordable now: [\"${affordableAugs.join("\", \"")}\"]`);
        const bn8TrpReady = facman.affordable_augs.includes(augTRP) || facman.awaiting_install_augs.includes(augTRP);
        const bn8DaedalusReady = player.factions.includes("Daedalus") ||
            (playerInstalledAugCount >= bitNodeMults.DaedalusAugsRequirement && player.skills.hacking >= (2500 * 0.9));
        const bn8RedPillMode = bn8FrequentInstall && !installedAugmentations.includes(augTRP) && (bn8DaedalusReady || bn8TrpReady);
        const cashRootReady = !installedAugmentations.includes(augCashRoot) &&
            (facman.affordable_augs.includes(augCashRoot) || facman.awaiting_install_augs.includes(augCashRoot));
        const cashRootGateActive = !installedAugmentations.includes(augCashRoot) && !cashRootReady;

        if (bn8RedPillMode && player.factions.includes("Daedalus") && !bn8TrpReady) {
            log(ns, `INFO: BN8 Red Pill mode: joined Daedalus but "${augTRP}" is not marked affordable/awaiting. ` +
                `Forcing a ${augTRP} purchase attempt before waiting.`);
            await runFactionManagerForAugmentations(ns, { purchase: true, noNeuroflux: true });
            return reservedPurchase = 0;
        }

        if (cashRootGateActive) {
            setStatus(ns, `CashRoot priority mode: not buying or installing non-CashRoot augmentation(s). ` +
                `Working toward "${augCashRoot}" from Sector-12 first.` + augDetailLines.join(""));
            return reservedPurchase = 0;
        }

        if (bn8FrequentInstall && facman.affordable_count_ex_nf > 0 && (!bn8RedPillMode || facman.affordable_augs.includes(augTRP))) {
            log(ns, `INFO: BN8 frequent-install mode: purchasing ${facman.affordable_count_ex_nf} affordable non-NeuroFlux augmentations before installing.`);
            await runFactionManagerForAugmentations(ns, { purchase: true, noNeuroflux: true });
            return reservedPurchase = 0;
        } else if (bn8RedPillMode && facman.affordable_count_ex_nf > 0 && !facman.affordable_augs.includes(augTRP)) {
            setStatus(ns, `BN8 Red Pill mode: not buying ${facman.affordable_count_ex_nf} non-TRP augmentation(s). ` +
                `Preserving this reset and cash for Daedalus and "${augTRP}". Ready now: ${augSummary}` + augDetailLines.join(""));
            return reservedPurchase = 0;
        }
        let resetStatus = `Reserving ${formatMoney(totalCost)} to install ${augSummary}`
        let shouldReset = cashRootReady ||
            options['install-for-augs'].some(a => facman.affordable_augs.includes(a)) ||
            pendingAugCount >= augsNeeded || pendingAugInclNfCount >= augsNeededInclNf;
        if (cashRootReady) {
            resetStatus = `"${augCashRoot}" is ready. Installing early only after ascend.js spends practical available cash on current purchases/upgrades.\n${resetStatus}`;
            options['install-countdown'] = 0;
        }
        if (bn8FrequentInstall && facman.awaiting_install_count > 0 && facman.affordable_count_ex_nf == 0 && (!bn8RedPillMode || bn8TrpReady)) {
            shouldReset = true;
            resetStatus = `BN8 frequent-install mode: installing already-purchased augmentations immediately after buying the current non-NeuroFlux batch.\n${resetStatus}`;
            options['install-countdown'] = 0;
        } else if (bn8RedPillMode && facman.awaiting_install_count > 0 && !bn8TrpReady) {
            shouldReset = false;
            setStatus(ns, `BN8 Red Pill mode: not installing already-purchased non-TRP augmentation(s). ` +
                `Preserving this reset for Daedalus and "${augTRP}". Ready now: ${augSummary}` + augDetailLines.join(""));
            return reservedPurchase = 0;
        }

        // Heuristic: if we can afford 4 or more augs in the first ~20 minutes, it's usually worth doing a "quick install"
        // For example, in BN8, we get a big cash influx on each reset and can buy reputation immediately, so it's worth
        //     doing an few immediate installs to purchase upgrades, then reset for more free cash.
        // When in a gang, require a more augs and don't countdown as quickly, since each reset reduces gang member ascention multipliers
        const quickInstallThreshold = playerInGang ? 6 : 4;
        if (!cashRootGateActive && !inFirstBn9Aug && !bn8FrequentInstall &&
            getTimeInAug() < 20 * 60 * 1000 && pendingAugInclNfCount >= quickInstallThreshold) {
            shouldReset = true;
            resetStatus = `We haven't been in this reset for long. We can do a quick reset immediately for a quick stat boost.\n${resetStatus}`;
            if (options['install-countdown'] > 30 * 1000 && !playerInGang)
                options['install-countdown'] = 30 * 1000; // Install relatively quickly in this scenario (30s)
        }

        // If not ready to reset, but we can already afford some augmentations, buy them now and keep waiting for install timing later.
        if (!shouldReset && bn8RedPillMode && !facman.affordable_augs.includes(augTRP)) {
            setStatus(ns, `BN8 Red Pill mode is preserving this reset and cash until "${augTRP}" is affordable or awaiting install. ` +
                `Ready now: ${augSummary}` + augDetailLines.join("") +
                ` (\`run faction-manager.js --purchase-mode no-neuroflux\` for details)`, augSummary);
            return reservedPurchase = 0;
        }
        if (!shouldReset && !cashRootGateActive && (facman.affordable_count_ex_nf + facman.affordable_count_nf) > 0) {
            log(ns, `INFO: Purchasing currently affordable augmentations now rather than waiting for the install threshold.`);
            await runFactionManagerForAugmentations(ns, { purchase: true, noNeuroflux: bn8FrequentInstall });
            return reservedPurchase = 0;
        }

        // If not ready to reset, set a status with our progress and return
        if (!shouldReset) {
            if (bn8FrequentInstall) {
                setStatus(ns, `BN8 frequent-install mode is waiting for an affordable or purchased non-NeuroFlux augmentation. ` +
                    `Ready now: ${augSummary}` + augDetailLines.join("") +
                    ` (\`run faction-manager.js --purchase-mode no-neuroflux\` for details)`, augSummary);
                return reservedPurchase = 0;
            }
            setStatus(ns, `Currently at ${formatDuration(getTimeInAug())} since last aug. ` +
                `Waiting for ${augsNeeded} new augs (or ${augsNeededInclNf} including NeuroFlux levels) before installing.` +
                `\nReady now: ${augSummary}` + augDetailLines.join("") +
                ((facman.affordable_count_ex_nf + facman.affordable_count_nf) == 0 ? '' : `\n  Total Cost to buy remaining affordable augs: ${formatMoney(totalCost)}`) +
                ` (\`run faction-manager.js\` for details)`, augSummary);
            return reservedPurchase = 0; // If we were previously reserving money for a purchase, reset that flag now
        }
        // If we want to reset, but there is a reason to delay, don't reset
        if (await shouldDelayInstall(ns, player, facman, augsNeeded, augsNeededInclNf)) // If we're currently in a state where we should not be resetting, skip reset logic
            return reservedPurchase = 0;

        // Ensure the money needed for the above augs doesn't get ripped out from under us by reserving it
        if (reservedPurchase < totalCost) {
            // A countdown is displayed to give the user a heads up, and give us time to potentially earn money for more augmentations
            if (reservedPurchase == 0)
                installCountdown = Date.now() + (bn8FrequentInstall ? 0 : options['install-countdown']);
            else { // If we were already reserving for a purchase and the number went up, log a notice of the timer being reset.
                let purchaseChangeLog = `INFO: The augmentation purchase we can afford has increased from ${formatMoney(reservedPurchase)} to ${formatMoney(totalCost)}.`
                // First, check if we're ready to install TRP - if so, don't delay the install for any additional augmentations.
                if (!facman.affordable_augs.includes(augTRP) && !facman.awaiting_install_augs.includes(augTRP)) {
                    // Otherwise, each time we can afford more augs, reset the install delay timer to take advantage of "momentum"
                    // and potentially purchase many more augmentations in this reset. To avoid delaying an install indefinitely,
                    // we reduce the additional time we're willing to wait a little bit each time this happens.
                    installCountdownResets++;
                    const newCountDown = Date.now() + Math.max(10 * 1000, // At a bare minimum, wait 10 more seconds
                        // Heuristic: Linearly reduce the cooldown until we have doubled the aug count needed.
                        options['install-countdown'] * (1 - (installCountdownResets / augsNeededInclNf)));
                    if (newCountDown > installCountdown) { // If the existing countdown remaining was longer than this, leave it be
                        installCountdown = newCountDown;
                        purchaseChangeLog = purchaseChangeLog + ' Resetting the timer before we install augmentations.'
                    }
                }
                log(ns, purchaseChangeLog, true);
            }
            if (!bn8FrequentInstall)
                writeReserveForTarget(ns, totalCost, cachedStocksValue); // Should prevent other scripts from spending money not already covered by stocks
        }
        // We must wait until the configured cooldown elapses before we install augs.
        if (installCountdown > Date.now()) {
            resetStatus += `\n  Waiting for ${formatDuration(options['install-countdown'])} (--install-countdown) ` +
                `to elapse before we install, in case we're close to being able to purchase more augmentations...`;
            setStatus(ns, resetStatus);
            ns.toast(`Heads up: Autopilot plans to reset in ${formatDuration(installCountdown - Date.now())}`, 'info');
            return reservedPurchase = totalCost;
        }

        // Otherwise, we've got the money reserved, we can afford the augs, we should be confident to ascend
        const resetLog = `  Invoking ascend.js at ${formatDuration(getTimeInAug()).padEnd(11)} since last aug to install: ${augSummary}`;
        persist_log(ns, log(ns, resetLog, true, 'info'));

        // Kick off ascend.js
        let errLog;
        const ascendArgs = ['--install-augmentations', true, '--on-reset-script', ns.getScriptName()]
        if (cashRootReady)
            ascendArgs.push('--spend-all-before-install', '--cashroot-only');
        if (pendingAugInclNfCount == 0) // If we know we would install 0 augs, but still wish to reset, we must enable soft resetting
            ascendArgs.push("--allow-soft-reset")
        try {
            const ascendScript = getFilePath('ascend.js');
            log(ns, `INFO: Spawning ascend.js and exiting autopilot so ascend.js can clear RAM before installing.`, true, 'info');
            ns.spawn(ascendScript, {
                threads: 1,
                spawnDelay: 100,
            }, ...ascendArgs);
            return;
        } catch (error) {
            errLog = `ERROR: Failed to spawn ascend.js. Will try again later.\nCaught: ${getErrorInfo(error)}`;
        }
        // If we got this far, something went wrong
        persist_log(ns, log(ns, errLog, true, 'error'));
    }

    /** Logic to detect if we are close to a milestone and should postpone installing augmentations until it is hit
     * @param {NS} ns
     * @param {Player} player
     * @param {{ installed_augs: string[], installed_count: number, installed_count_nf: number, installed_count_ex_nf: number,
     *           owned_augs: string[], owned_count: number, owned_count_nf: number, owned_count_ex_nf: number,
     *           awaiting_install_augs: string[], awaiting_install_count: number, awaiting_install_count_nf: number, awaiting_install_count_ex_nf: number,
     *           affordable_augs: string[], affordable_count: number, affordable_count_nf: number, affordable_count_ex_nf: number,
     *           total_rep_cost: number, total_aug_cost: number, unowned_count: number }} facmanOutput
     * @param {number} augsNeeded
     * @param {number} augsNeededInclNf
    */
    async function shouldDelayInstall(ns, player, facmanOutput, augsNeeded, augsNeededInclNf) {
        // Don't install if we're currently grafting an augmentation
        if (await checkIfGrafting(ns))
            return true;
        const remainingNonNfAugs = Math.max(0, (facmanOutput.unpurchased_count || 0) - 1);
        const affordableNowCount = (facmanOutput.affordable_count_ex_nf || 0) + (facmanOutput.affordable_count_nf || 0);
        const awaitingNonNfCount = Math.max(facmanOutput.awaiting_install_count_ex_nf || 0,
            (facmanOutput.purchased_count_ex_nf || 0) - (facmanOutput.installed_count_ex_nf || 0));
        const awaitingInclNfCount = facmanOutput.awaiting_install_count || 0;
        const alreadyMeetsInstallThreshold = awaitingNonNfCount >= augsNeeded || awaitingInclNfCount >= augsNeededInclNf;
        const bn8DelayForRedPill = player.factions.includes("Daedalus") ||
            (playerInstalledAugCount >= bitNodeMults.DaedalusAugsRequirement && player.skills.hacking >= (2500 * 0.9));
        if (resetInfo.currentNode == 8 && !installedAugmentations.includes(augTRP) && bn8DelayForRedPill &&
            !facmanOutput.affordable_augs.includes(augTRP) && !facmanOutput.awaiting_install_augs.includes(augTRP)) {
            setStatus(ns, `BN8 Red Pill mode: not installing until "${augTRP}" is affordable or awaiting install.`);
            return true;
        }
        if (resetInfo.currentNode == 8 && awaitingInclNfCount > 0)
            return false;
        if (resetInfo.currentNode != 8 && !alreadyMeetsInstallThreshold && awaitingInclNfCount > 0 && affordableNowCount == 0 && remainingNonNfAugs > 0) {
            setStatus(ns, `Not installing yet because only ${awaitingInclNfCount} augmentations are waiting to install, ` +
                `that is still below the current install threshold (${augsNeeded} excluding NeuroFlux / ${augsNeededInclNf} including NeuroFlux), ` +
                `and we cannot afford any additional purchases right now while ${remainingNonNfAugs} non-NeuroFlux augmentations remain.`);
            return true;
        }
        // Are we close to being able to afford 4S TIX data?
        if (!have4STixApi) have4STixApi = await getNsDataThroughFile(ns, `ns.stock.has4SDataTixApi()`);
        if (resetInfo.currentNode != 8 && !options['disable-wait-for-4s'] && !have4STixApi) {
            if (!have4SData) have4SData = await getNsDataThroughFile(ns, `ns.stock.has4SData()`);
            const totalWorth = player.money + await getStocksValueIfRamAvailable(ns);
            const totalCost = 25E9 * bitNodeMults.FourSigmaMarketDataApiCost +
                (have4SData ? 0 : 1E9 * bitNodeMults.FourSigmaMarketDataCost);
            const ratio = totalWorth / totalCost;
            // If we're e.g. 50% of the way there, hold off, regardless of the '--wait-for-4s' setting
            // TODO: If ratio is > 1, we can afford it - but stockmaster won't buy until it has e.g. 20% more than the cost
            //       (so it still has money to invest). It doesn't know we want to restart ASAP. Perhaps we should purchase ourselves?
            if (ratio >= options['wait-for-4s-threshold']) {
                setStatus(ns, `Not installing until scripts purchase the 4SDataTixApi because we have ` +
                    `${(100 * totalWorth / totalCost).toFixed(0)}% of the cost (controlled by --wait-for-4s-threshold)`);
                return true;
            }
        }
        if (resetInfo.currentNode == 8) { // Many special rules for this special Bitnode
            if (player.factions.includes("Daedalus")) { // If we've already joined Daedalus
                // In BN8, large sums of money are hard to accumulate, so if we've made it into Daedalus, but can't purchase TRP yet,
                // remain in the BN until we have enough rep and money to buy TRP.
                if (!installedAugmentations.includes(augTRP) && !facmanOutput.affordable_augs.includes(augTRP) && !facmanOutput.awaiting_install_augs.includes(augTRP)) {
                    setStatus(ns, `We're in Daedalus, so we won't install until we can afford to purchase "${augTRP}".`);
                    return true;
                }
            } else if (playerInstalledAugCount >= bitNodeMults.DaedalusAugsRequirement && player.skills.hacking >= (2500 * 0.9)) {
                // If we meet the Daedalus aug count requirement and at least 90% of the required hack level, wait to earn the invite
                setStatus(ns, `Not installing because we're in BN8 and we have enough augs and ` + (player.skills.hacking < 2500 ? 'nearly ' : '')
                    + 'enough hack level to get invited to Daedalus once we hit $100b.');
                return true;
            }
        }
        // If we're reserving money because we're close to getting an invite to Daedalus don't reset.
        if (reservingMoneyForDaedalus) {
            setStatus(ns, `Not installing since we are close to earning an invite from Daedalus.`);
            return true;
        }

        // In BN10, it takes a while to build up the 100q needed to purchase the last sleeve, so don't reset if we're close
        if (resetInfo.currentNode == 10 && player.money >= 10e15 && !sleevesMaxedOut) { // Heuristic: If we hit 10q (10% the cost of the last sleeve) before an install, we can probably go all the way
            setStatus(ns, `Not installing anymore since we are nearing the 100q needed to purchase the 6th sleeve from the Covenant.`);
            return true;
        }

        // TODO: Bladeburner black-op in progress
        return false;
    }

    let wasGrafting = false;

    /** Checks if we are current grafting. If so, certain actions should not be taken.
     * @param {NS} ns
     * @returns {bool} true if the player is grafting, false otherwise. */
    async function checkIfGrafting(ns) {
        let currentWork = (/**@returns{Task|null}*/() => null)();
        currentWork = await getNsDataThroughFile(ns, 'ns.singularity.getCurrentWork()');
        // Never interrupt grafting
        if (currentWork?.type == "GRAFTING") {
            if (!wasGrafting) // Only log the first time we detect we've started grafting
                log(ns, "Grafting in progress. autopilot.js will make sure to not install augmentations or otherwise interrupt it.");
            return wasGrafting = true;
        }
        else
            return wasGrafting = false
    }

    /** Consolidated logic for all the times we want to reserve money
     * @param {NS} ns
     * @param {Player} player */
    function manageReservedMoney(ns, player, stocksValue) {
        if (resetInfo.currentNode == 8)
            return writeReserveForTarget(ns, 0, 0);
        if (reservedPurchase) return writeReserveForTarget(ns, reservedPurchase, stocksValue);
        if (reservingMoneyForDaedalus) // Reserve 100b to get the daedalus invite
            return writeReserveForTarget(ns, 100E9, stocksValue);
        if (resetInfo.currentNode == 10 && bn10SleevesIncomplete && Number.isFinite(bn10SleeveReserve) && bn10SleeveReserve > 0) {
            return writeReserveForTarget(ns, bn10SleeveReserve, stocksValue);
        }
        // Otherwise, reserve money for stocks for a while, as it's our main source of income early in the BN
        // It also acts as a decent way to save up for augmentations
        const stockBootstrapReserve = 8E9; // Keep early stock bootstrap money only after we have actually built up enough cash.
        const targetReserve = stocksValue > 0 || player.money >= stockBootstrapReserve ?
            stockBootstrapReserve :
            0;
        return writeReserveForTarget(ns, targetReserve, stocksValue); // Reserve only the cash gap not already covered by stocks
        // NOTE: After several iterations, I decided that the above is actually best to keep in all scenarios:
        // - Casino.js ignores the reserve, so the above takes care of ensuring our casino seed money isn't spent
        // - In low-income situations, stockmaster will be our best source of income. We invoke it such that it ignores
        //	 the global reserve, so this 8B is for stocks only. The 2B remaining is plenty to kickstart the rest.
        // - Once high-hack/gang income is achieved, this 8B will not be missed anyway.
        /*
        if(!ranCasino) {
            ns.write("reserve.txt", 300000, "w"); // Prevent other scripts from spending our casino seed money
            return moneyReserved = true;
        }
        // Otherwise, clear any reserve we previously had
        if(moneyReserved) ns.write("reserve.txt", 0, "w"); // Remove the casino reserve we would have placed
        return moneyReserved = false;
        */
    }

    /** Write the cash-only reserve needed for a target reserve after accounting for stock liquidation value.
     * @param {NS} ns
     * @param {number} targetReserve
     * @param {number} stocksValue */
    function writeReserveForTarget(ns, targetReserve, stocksValue = cachedStocksValue) {
        const reserve = Math.max(0, (Number(targetReserve) || 0) - Math.max(0, Number(stocksValue) || 0));
        const currentReserve = Number(ns.read("reserve.txt") || 0);
        return currentReserve == reserve ? true : ns.write("reserve.txt", reserve, "w");
    }

    /** Logic to determine whether we should keep running, or shut down autopilot.js for some reason.
     * @param {NS} ns
     * @returns {boolean} true if we should keep running. False if we should shut down this script. */
    function shouldWeKeepRunning(ns) {
        if (singularityAvailable)
            return true; // If Singularity is available - run always
        // If we've gotten daemon.js launched, but only have 8GB ram, we must shut down for now
        if (homeRam == 8 && daemonStartTime > 0) {
            log(ns, `WARN: (not an actual warning, just trying to make this message stand out.)` +
                `\n` + '-'.repeat(100) +
                `\n\n  Welcome to bitburner and thanks for using my scripts!` +
                `\n\n  Currently, your available RAM on home (8 GB) is too small to keep autopilot.js running.` +
                `\n  The priority should just be to run "daemon.js" for a while until you have enough money to` +
                `\n  purchase some home RAM (which you must do manually at a store like [alpha ent.] in the city),` +
                `\n\n  Once you have more home ram, feel free to 'run ${ns.getScriptName()}' again!` +
                `\n\n` + '-'.repeat(100), true);
            return false; // Daemon.js needs more room to breath
        }
        // Otherwise, keep running
        return true;
    }

    /** Helper to launch a script and log whether if it succeeded or failed
     * @param {NS} ns */
    function launchScriptHelper(ns, baseScriptName, args = [], convertFileName = true) {
        if (!options['no-tail-windows'])
            tail(ns); // If we're going to be launching scripts, show our tail window so that we can easily be killed if the user wants to interrupt.
        const scriptName = convertFileName ? getFilePath(baseScriptName) : baseScriptName;
        let pid, err;
        try { pid = ns.run(scriptName, 1, ...args); }
        catch (e) { err = e; }
        if (pid)
            log(ns, `INFO: Launched ${baseScriptName} (pid: ${pid}) with args: [${args.join(", ")}]`, true);
        else {
            let ramDiagnostic = "";
            try {
                const requiredRam = ns.getScriptRam(scriptName, 'home');
                const homeMaxRam = ns.getServerMaxRam('home');
                const homeUsedRam = ns.getServerUsedRam('home');
                ramDiagnostic = `\nRAM: needs ${formatRam(requiredRam)}, free ${formatRam(homeMaxRam - homeUsedRam)} / max ${formatRam(homeMaxRam)} on home.`;
            } catch { }
            log(ns, `ERROR: Failed to launch ${baseScriptName} with args: [${args.join(", ")}]` +
                ramDiagnostic +
                (err ? `\nCaught: ${getErrorInfo(err)}` : ''), true, 'error');
        }
        return pid;
    }

    function getCriticalAutopilotRamReserve() {
        return singularityAvailable ? Math.max(criticalAutopilotRamReserve, 8) : 0;
    }

    /** @param {NS} ns */
    function getHomeFreeRam(ns) {
        return ns.getServerMaxRam('home') - ns.getServerUsedRam('home');
    }

    function parseJsonSafe(text) {
        if (!text) return null;
        try { return JSON.parse(text); }
        catch { return null; }
    }

    let lastStatusLog = ""; // The current or last-assigned long-term status (what this script is waiting to happen)

    /** Helper to set a global status and print it if it changes
     * @param {NS} ns */
    function setStatus(ns, status, uniquePart = null) {
        uniquePart = uniquePart || status; // Can be used to consider a logs "the same" (not worth re-printing) even if they have some different text
        if (lastStatusLog == uniquePart) return;
        lastStatusLog = uniquePart
        log(ns, status);
    }

    /** Append the specified text (with timestamp) to a persistent log in the home directory
     * @param {NS} ns */
    function persist_log(ns, text) {
        ns.write(persistentLog, `${(new Date()).toISOString().substring(0, 19)} ${text}\n`, "a")
    }

    let logged_once = new Set();
    /** Helper to log a message, but only the first time it is encountered.
     * @param {NS} ns
     * @param {string} message The message to log, only if it hasn't been previously logged. 
     * @param {boolean} alsoPrintToTerminal Set to true to print not only to the current script's tail file, but to the terminal
     * @param {""|"success"|"warning"|"error"|"info"} toastStyle - If specified, your log will will also become a toast notification */
    function log_once(ns, message, alsoPrintToTerminal, toastStyle) {
        if (logged_once.has(message))
            return;
        logged_once.add(log(ns, message, alsoPrintToTerminal, toastStyle));
    }

    // Invoke the main function
    await main_start(ns);
}
