const SUCCESS = 200;
const AUTH_FAILURE = 401;
const SERVICE_UNAVAILABLE = 503;
const STATE_FILE = "/Temp/darknet-passwords.txt";
const TOPOLOGY_FILE = "/Temp/darknet-topology.txt";
const STASIS_FILE = "stasis.js";
const STORM_FILE = "darknet-storm.js";
const PHISHING_FILE = "darknet-phishing.js";
const STORM_SEED_PROGRAM = "STORM_SEED.exe";
const skippedSpreadForRam = new Set();

const COMMON_PASSWORDS = [
    "123456", "password", "12345678", "qwerty", "123456789", "12345", "1234", "111111", "1234567",
    "dragon", "123123", "baseball", "abc123", "football", "monkey", "letmein", "696969", "shadow",
    "master", "666666", "qwertyuiop", "123321", "mustang", "1234567890", "michael", "654321",
    "superman", "1qaz2wsx", "7777777", "121212", "0", "qazwsx", "123qwe", "trustno1", "jordan",
    "jennifer", "zxcvbnm", "asdfgh", "hunter", "buster", "soccer", "harley", "batman", "andrew",
    "tigger", "sunshine", "iloveyou", "2000", "charlie", "robert", "thomas", "hockey", "ranger",
    "daniel", "starwars", "112233", "george", "computer", "michelle", "jessica", "pepper", "1111",
    "zxcvbn", "555555", "11111111", "131313", "freedom", "777777", "pass", "maggie", "159753",
    "aaaaaa", "ginger", "princess", "joshua", "cheese", "amanda", "summer", "love", "ashley",
    "6969", "nicole", "chelsea", "biteme", "matthew", "access", "yankees", "987654321", "dallas",
    "austin", "thunder", "taylor", "matrix",
];
const EU_COUNTRIES = [
    "Austria", "Belgium", "Bulgaria", "Croatia", "Republic of Cyprus", "Czech Republic", "Denmark",
    "Estonia", "Finland", "France", "Germany", "Greece", "Hungary", "Ireland", "Italy", "Latvia",
    "Lithuania", "Luxembourg", "Malta", "Netherlands", "Poland", "Portugal", "Romania", "Slovakia",
    "Slovenia", "Spain", "Sweden",
];
const LARGE_PRIMES = [
    1069, 1409, 1471, 1567, 1597, 1601, 1697, 1747, 1801, 1889, 1979, 1999, 2063, 2207, 2371, 2503,
    2539, 2693, 2741, 2753, 2801, 2819, 2837, 2909, 2939, 3169, 3389, 3571, 3761, 3881, 4217, 4289,
    4547, 4729, 4789, 4877, 4943, 4951, 4957, 5393, 5417, 5419, 5441, 5519, 5527, 5647, 5779, 5881,
    6007, 6089, 6133, 6389, 6451, 6469, 6547, 6661, 6719, 6841, 7103, 7549, 7559, 7573, 7691, 7753,
    7867, 8053, 8081, 8221, 8329, 8599, 8677, 8761, 8839, 8963, 9103, 9199, 9343, 9467, 9551, 9601,
    9739, 9749, 9859,
];
const SMALL_PRIMES = primesUpTo(100);
const FACTORI_OS_PRIMES = [...SMALL_PRIMES, ...LARGE_PRIMES];

/** @param {NS} ns */
export async function main(ns) {
    const options = parseOptions(ns.args);
    if (options.help) {
        ns.tprint([
            `Usage: run ${ns.getScriptName()} [--origin home] [--interval 15000] [--disable-phishing]`,
            `       [--verbose-terminal] [--self-test]`,
        ].join("\n"));
        return;
    }
    if (options["self-test"]) {
        const result = runSelfTest();
        ns.tprint(`Darknet worker self-test: ${result.passed}/${result.total} passed.`);
        for (const failure of result.failures) ns.tprint(`FAIL: ${failure}`);
        if (result.failures.length) ns.exit();
        return;
    }

    ns.disableLog("sleep");
    const script = ns.getScriptName();
    const interval = Math.max(1000, Number(options.interval) || 15000);
    const maxAttempts = Math.max(1, Number(options["max-attempts-per-host"]) || 160);

    while (true) {
        try {
            await openLocalCaches(ns);
            await syncKnownPasswords(ns, String(options.origin));
            await syncDarknetCacheFile(ns, TOPOLOGY_FILE, String(options.origin));
            await freeLocalBlockedRam(ns);
            const dedicatedPhishing = !options["disable-phishing"] && await launchLocalPhishingWorker(ns);
            if (!options["disable-phishing"] && !dedicatedPhishing) await tryPhishing(ns);
            await crawlNeighbors(ns, script, String(options.origin), interval, maxAttempts, options["verbose-terminal"]);
        } catch (error) {
            ns.print(`WARN: Darknet worker cycle failed on ${ns.getHostname()}: ${formatError(error)}`);
        }
        await ns.sleep(interval);
    }
}

function parseOptions(args) {
    const options = {
        origin: "home",
        interval: 15000,
        "max-attempts-per-host": 160,
        "disable-phishing": false,
        "dedicated-phishing": false,
        "verbose-terminal": false,
        "self-test": false,
        help: false,
    };
    const valueOptions = new Set(["origin", "interval", "max-attempts-per-host"]);
    for (let i = 0; i < args.length; i++) {
        const rawArg = args[i];
        if (typeof rawArg !== "string" || !rawArg.startsWith("--")) continue;
        const name = rawArg.slice(2);
        if (!(name in options)) continue;
        if (!valueOptions.has(name)) {
            options[name] = true;
            continue;
        }
        const next = args[i + 1];
        if (next == null || typeof next === "string" && next.startsWith("--")) continue;
        options[name] = next;
        i++;
    }
    return options;
}

async function crawlNeighbors(ns, script, origin, interval, maxAttempts, verboseTerminal) {
    const host = ns.getHostname();
    const knownPasswords = readKnownPasswords(ns);
    const neighbors = ns.dnet.probe(false).filter(server => server !== origin && server !== host);
    if (recordDarknetTopology(ns, host, neighbors)) await syncDarknetCacheFile(ns, TOPOLOGY_FILE, origin);

    for (const target of neighbors) {
        let details;
        try {
            details = getDarknetServerDetails(ns, target);
        } catch (error) {
            ns.print(`WARN: Cannot inspect ${target}: ${formatError(error)}`);
            continue;
        }
        if (!details.isOnline) continue;

        tryLinkStasisNearLabyrinth(ns, target, details);

        let password = knownPasswords[target];
        if (password != null) {
            const session = ns.dnet.connectToSession(target, password);
            if (!session.success) password = null;
        }

        if (password == null) {
            password = await solveAndAuthenticate(ns, target, details, maxAttempts, verboseTerminal);
            if (password == null) continue;
            knownPasswords[target] = password;
            if (writeKnownPasswords(ns, knownPasswords)) await syncKnownPasswords(ns, origin);
        }

        await spreadToNeighbor(ns, script, target, password, interval, verboseTerminal);
    }
}

function getDarknetServerDetails(ns, target) {
    let details;
    if (typeof ns.dnet.getServerDetails === "function") details = ns.dnet.getServerDetails(target);
    else if (typeof ns.dnet.getServer === "function") details = ns.dnet.getServer(target);
    else if (typeof ns.dnet.getServerAuthDetails === "function") details = ns.dnet.getServerAuthDetails(target);
    else throw new Error("No compatible dnet server details API is available.");
    return normalizeDarknetServerDetails(details);
}

function normalizeDarknetServerDetails(details) {
    if (details == null || typeof details !== "object") throw new Error(`Invalid dnet server details: ${details}`);
    return {
        ...details,
        blockedRam: details.blockedRam ?? 0,
        depth: details.depth ?? -1,
        difficulty: details.difficulty ?? 0,
        hasSession: details.hasSession ?? false,
        isConnectedToCurrentServer: details.isConnectedToCurrentServer ?? false,
        isOnline: details.isOnline ?? true,
        isStationary: details.isStationary ?? false,
        logTrafficInterval: details.logTrafficInterval ?? 0,
        modelId: details.modelId ?? "",
        data: details.data ?? "",
        passwordFormat: details.passwordFormat ?? "ASCII",
        passwordHint: details.passwordHint ?? "",
        passwordLength: details.passwordLength ?? 0,
        requiredCharismaSkill: details.requiredCharismaSkill ?? 0,
    };
}

async function solveAndAuthenticate(ns, target, details, maxAttempts, verboseTerminal) {
    if (details.modelId === "NIL") return await solveYesntAndAuthenticate(ns, target, details, verboseTerminal);
    if (details.modelId === "OpenWebAccessPoint")
        return await solvePacketSnifferAndAuthenticate(ns, target, details, verboseTerminal);
    if (details.modelId === "2G_cellular") return await solveTimingAndAuthenticate(ns, target, details, verboseTerminal);
    if (details.modelId === "RateMyPix.Auth") return await solvePepperAndAuthenticate(ns, target, details, verboseTerminal);
    if (details.modelId === "Factori-Os") return await solveFactoriOsAndAuthenticate(ns, target, details, verboseTerminal);
    if (details.modelId === "DeepGreen") return await solveLogLeakAndAuthenticate(ns, target, details, verboseTerminal);

    const candidates = buildCandidates(details).slice(0, maxAttempts);
    if (candidates.length === 0) {
        ns.print(`INFO: No solver yet for ${target} model=${details.modelId}`);
        return null;
    }

    for (const candidate of unique(candidates)) {
        const result = await ns.dnet.authenticate(target, candidate, 0);
        if (result.code === SUCCESS) {
            terminalLog(ns, verboseTerminal, `SUCCESS: Darknet authenticated ${target} (${details.modelId}).`);
            return candidate;
        }
        if (result.code === SERVICE_UNAVAILABLE) return null;
        if (result.code !== AUTH_FAILURE) ns.print(`INFO: Auth ${target} failed: ${result.message} (${result.code})`);
    }
    ns.print(`INFO: Solver failed for ${target} model=${details.modelId} after ${candidates.length} attempts.`);
    return null;
}

async function solveLogLeakAndAuthenticate(ns, target, details, verboseTerminal) {
    const candidates = await getLogLeakCandidates(ns, target, details);
    for (const candidate of candidates) {
        const result = await ns.dnet.authenticate(target, candidate, 0);
        if (result.code === SUCCESS) {
            terminalLog(ns, verboseTerminal, `SUCCESS: Darknet authenticated ${target} (${details.modelId}, log leak).`);
            return candidate;
        }
        if (result.code === SERVICE_UNAVAILABLE) return null;
        if (result.code !== AUTH_FAILURE) ns.print(`INFO: Auth ${target} failed: ${result.message} (${result.code})`);
    }
    ns.print(`INFO: No usable leaked password found for ${target} model=${details.modelId}; full solver not implemented yet.`);
    return null;
}

async function getLogLeakCandidates(ns, target, details) {
    let result;
    try {
        result = await ns.dnet.heartbleed(target, { peek: true, logsToCapture: 32 });
    } catch (error) {
        ns.print(`WARN: Could not heartbleed log leaks from ${target}: ${formatError(error)}`);
        return [];
    }
    if (!result.success) {
        ns.print(`INFO: Could not heartbleed log leaks from ${target}: ${result.message} (${result.code})`);
        return [];
    }
    const candidates = [];
    for (const log of result.logs ?? []) {
        candidates.push(...parseLeakedPasswordCandidates(target, details, parsePasswordResponseLog(log)));
    }
    return unique(candidates);
}

async function solveFactoriOsAndAuthenticate(ns, target, details, verboseTerminal) {
    const passwordLength = Math.max(0, Number(details.passwordLength) || 0);
    const maxValue = getMaxNumericPasswordValue(passwordLength);
    let factorProduct = 1n;

    for (const prime of FACTORI_OS_PRIMES) {
        const primeBigInt = BigInt(prime);
        if (primeBigInt > maxValue) break;
        let testedPower = primeBigInt;
        let matchedPower = 1n;
        while (testedPower <= maxValue && factorProduct * testedPower <= maxValue) {
            const candidate = testedPower.toString();
            const result = await testFactoriOsDivisor(ns, target, candidate);
            if (result.success) {
                terminalLog(ns, verboseTerminal, `SUCCESS: Darknet authenticated ${target} (Factori-Os).`);
                return candidate;
            }
            if (result.unavailable) return null;
            if (!result.divisible) break;
            matchedPower = testedPower;
            testedPower *= primeBigInt;
        }
        factorProduct *= matchedPower;
    }

    const password = factorProduct.toString();
    const result = await ns.dnet.authenticate(target, password, 0);
    if (result.code === SUCCESS) {
        terminalLog(ns, verboseTerminal, `SUCCESS: Darknet authenticated ${target} (Factori-Os).`);
        return password;
    }
    if (result.code === SERVICE_UNAVAILABLE) return null;
    ns.print(`INFO: Factori-Os solver produced ${password} for ${target}, but auth failed: ${result.message} (${result.code})`);
    return null;
}

async function testFactoriOsDivisor(ns, target, candidate) {
    const result = await ns.dnet.authenticate(target, candidate, 0);
    if (result.code === SUCCESS) return { success: true, divisible: true, unavailable: false };
    if (result.code === SERVICE_UNAVAILABLE) return { success: false, divisible: false, unavailable: true };
    if (result.code !== AUTH_FAILURE) return { success: false, divisible: false, unavailable: false };

    const feedback = await getLatestAuthFeedback(ns, target, candidate, parseFactoriOsFeedback, "Factori-Os");
    return {
        success: false,
        divisible: feedback?.divisible === true,
        unavailable: false,
    };
}

function getMaxNumericPasswordValue(passwordLength) {
    if (passwordLength > 0 && passwordLength <= 15) return BigInt(10 ** passwordLength - 1);
    return BigInt(Number.MAX_SAFE_INTEGER);
}

async function solvePacketSnifferAndAuthenticate(ns, target, details, verboseTerminal) {
    const probe = getProbeCandidate(details);
    const probeResult = await ns.dnet.authenticate(target, probe, 0);
    if (probeResult.code === SUCCESS) {
        terminalLog(ns, verboseTerminal, `SUCCESS: Darknet authenticated ${target} (OpenWebAccessPoint).`);
        return probe;
    }
    if (probeResult.code === SERVICE_UNAVAILABLE) return null;
    if (probeResult.code !== AUTH_FAILURE) {
        ns.print(`INFO: Auth ${target} failed: ${probeResult.message} (${probeResult.code})`);
        return null;
    }

    const candidates = parsePacketSnifferCandidates(target, details, probeResult)
        .filter(candidate => candidate !== probe);
    for (const candidate of await getPacketSnifferCandidatesFromLogs(ns, target, details, probe)) {
        candidates.push(candidate);
    }
    for (const candidate of candidates) {
        const result = await ns.dnet.authenticate(target, candidate, 0);
        if (result.code === SUCCESS) {
            terminalLog(ns, verboseTerminal, `SUCCESS: Darknet authenticated ${target} (OpenWebAccessPoint).`);
            return candidate;
        }
        if (result.code === SERVICE_UNAVAILABLE) return null;
        if (result.code !== AUTH_FAILURE) ns.print(`INFO: Auth ${target} failed: ${result.message} (${result.code})`);
    }

    ns.print(`INFO: OpenWebAccessPoint solver failed for ${target}; packet dump gave ${candidates.length} candidate(s).`);
    return null;
}

async function getPacketSnifferCandidatesFromLogs(ns, target, details, expectedAttempt) {
    let result;
    try {
        result = await ns.dnet.heartbleed(target, { peek: true, logsToCapture: 16 });
    } catch (error) {
        ns.print(`WARN: Could not heartbleed packet dump from ${target}: ${formatError(error)}`);
        return [];
    }
    if (!result.success) {
        ns.print(`INFO: Could not heartbleed packet dump from ${target}: ${result.message} (${result.code})`);
        return [];
    }
    const candidates = [];
    for (const log of result.logs ?? []) {
        const parsed = parsePasswordResponseLog(log);
        if (parsed?.passwordAttempted != null && parsed.passwordAttempted !== expectedAttempt) continue;
        candidates.push(...parsePacketSnifferCandidates(target, details, parsed ?? log));
    }
    return unique(candidates);
}

function getProbeCandidate(details) {
    const passwordLength = Math.max(1, Number(details.passwordLength) || 1);
    if (details.passwordFormat === "numeric") return "0".repeat(passwordLength);
    if (details.passwordFormat === "alphabetic") return "a".repeat(passwordLength);
    if (details.passwordFormat === "alphanumeric") return "0".repeat(passwordLength);
    return "!".repeat(passwordLength);
}

async function solveTimingAndAuthenticate(ns, target, details, verboseTerminal) {
    const passwordLength = Math.max(1, Number(details.passwordLength) || 0);
    const charset = getCharsetForPasswordFormat(details.passwordFormat);
    if (!charset) {
        ns.print(`INFO: No 2G_cellular charset solver for ${target} passwordFormat=${details.passwordFormat}`);
        return null;
    }

    const filler = getNeverInPasswordFiller();
    const solved = [];
    for (let pos = 0; pos < passwordLength; pos++) {
        let found = false;
        for (const char of charset) {
            const candidate = solved.join("") + char + filler.repeat(passwordLength - pos - 1);
            const result = await ns.dnet.authenticate(target, candidate, 0);
            if (result.code === SUCCESS) {
                terminalLog(ns, verboseTerminal, `SUCCESS: Darknet authenticated ${target} (2G_cellular).`);
                return candidate;
            }
            if (result.code === SERVICE_UNAVAILABLE) return null;
            if (result.code !== AUTH_FAILURE) {
                ns.print(`INFO: Auth ${target} failed: ${result.message} (${result.code})`);
                continue;
            }

            const mismatchIndex = await getLatestTimingMismatchIndex(ns, target, candidate);
            if (mismatchIndex == null) continue;
            if (mismatchIndex > pos || mismatchIndex < 0) {
                solved.push(char);
                found = true;
                break;
            }
        }
        if (!found) {
            ns.print(`INFO: 2G_cellular solver could not identify position ${pos} for ${target}.`);
            return null;
        }
    }

    const password = solved.join("");
    const result = await ns.dnet.authenticate(target, password, 0);
    if (result.code === SUCCESS) {
        terminalLog(ns, verboseTerminal, `SUCCESS: Darknet authenticated ${target} (2G_cellular).`);
        return password;
    }
    ns.print(`INFO: 2G_cellular solver produced ${password} for ${target}, but auth failed: ${result.message} (${result.code})`);
    return null;
}

async function solvePepperAndAuthenticate(ns, target, details, verboseTerminal) {
    const passwordLength = Math.max(1, Number(details.passwordLength) || 0);
    const charset = getCharsetForPasswordFormat(details.passwordFormat);
    if (!charset) {
        ns.print(`INFO: No RateMyPix.Auth charset solver for ${target} passwordFormat=${details.passwordFormat}`);
        return null;
    }

    const filler = getNeverInPasswordFiller();
    const solved = [];
    for (let pos = 0; pos < passwordLength; pos++) {
        let found = false;
        for (const char of charset) {
            const candidate = solved.join("") + char + filler.repeat(passwordLength - pos - 1);
            const result = await ns.dnet.authenticate(target, candidate, 0);
            if (result.code === SUCCESS) {
                terminalLog(ns, verboseTerminal, `SUCCESS: Darknet authenticated ${target} (RateMyPix.Auth).`);
                return candidate;
            }
            if (result.code === SERVICE_UNAVAILABLE) return null;
            if (result.code !== AUTH_FAILURE) {
                ns.print(`INFO: Auth ${target} failed: ${result.message} (${result.code})`);
                continue;
            }

            const pepperCount = await getLatestPepperCount(ns, target, candidate);
            if (pepperCount == null) continue;
            if (pepperCount > pos) {
                solved.push(char);
                found = true;
                break;
            }
        }
        if (!found) {
            ns.print(`INFO: RateMyPix.Auth solver could not identify position ${pos} for ${target}.`);
            return null;
        }
    }

    const password = solved.join("");
    const result = await ns.dnet.authenticate(target, password, 0);
    if (result.code === SUCCESS) {
        terminalLog(ns, verboseTerminal, `SUCCESS: Darknet authenticated ${target} (RateMyPix.Auth).`);
        return password;
    }
    ns.print(`INFO: RateMyPix.Auth solver produced ${password} for ${target}, but auth failed: ${result.message} (${result.code})`);
    return null;
}

function getNeverInPasswordFiller() {
    return "_";
}

async function getLatestTimingMismatchIndex(ns, target, expectedAttempt) {
    const parsed = await getLatestAuthFeedback(ns, target, expectedAttempt, parseTimingFeedback, "2G_cellular");
    return parsed?.mismatchIndex ?? null;
}

async function getLatestPepperCount(ns, target, expectedAttempt) {
    const parsed = await getLatestAuthFeedback(ns, target, expectedAttempt, parsePepperFeedback, "RateMyPix.Auth");
    return parsed?.pepperCount ?? null;
}

async function solveYesntAndAuthenticate(ns, target, details, verboseTerminal) {
    const passwordLength = Math.max(1, Number(details.passwordLength) || 0);
    const charset = getCharsetForPasswordFormat(details.passwordFormat);
    if (!charset) {
        ns.print(`INFO: No NIL charset solver for ${target} passwordFormat=${details.passwordFormat}`);
        return null;
    }

    const solved = Array(passwordLength).fill(null);
    for (const char of charset) {
        if (solved.every(value => value != null)) break;
        const candidate = char.repeat(passwordLength);
        const result = await ns.dnet.authenticate(target, candidate, 0);
        if (result.code === SUCCESS) {
            terminalLog(ns, verboseTerminal, `SUCCESS: Darknet authenticated ${target} (NIL).`);
            return candidate;
        }
        if (result.code === SERVICE_UNAVAILABLE) return null;
        if (result.code !== AUTH_FAILURE) {
            ns.print(`INFO: Auth ${target} failed: ${result.message} (${result.code})`);
            continue;
        }

        const feedback = await getLatestYesntFeedback(ns, target, passwordLength, candidate);
        if (!feedback) continue;
        for (let i = 0; i < Math.min(passwordLength, feedback.length); i++) {
            if (feedback[i] === "yes") solved[i] = char;
        }
    }

    if (!solved.every(value => value != null)) {
        ns.print(`INFO: NIL solver did not get enough feedback for ${target}: ${solved.map(value => value ?? "?").join("")}`);
        return null;
    }

    const password = solved.join("");
    const result = await ns.dnet.authenticate(target, password, 0);
    if (result.code === SUCCESS) {
        terminalLog(ns, verboseTerminal, `SUCCESS: Darknet authenticated ${target} (NIL).`);
        return password;
    }
    ns.print(`INFO: NIL solver produced ${password} for ${target}, but auth failed: ${result.message} (${result.code})`);
    return null;
}

async function getLatestYesntFeedback(ns, target, passwordLength, expectedAttempt) {
    const parsed = await getLatestAuthFeedback(ns, target, expectedAttempt, parseYesntFeedback, "NIL");
    if (parsed?.feedback?.length === passwordLength) return parsed.feedback;
    return null;
}

async function getLatestAuthFeedback(ns, target, expectedAttempt, parser, label) {
    let result;
    try {
        result = await ns.dnet.heartbleed(target, { peek: true, logsToCapture: 8 });
    } catch (error) {
        ns.print(`WARN: Could not heartbleed ${label} feedback from ${target}: ${formatError(error)}`);
        return null;
    }
    if (!result.success) {
        ns.print(`INFO: Could not heartbleed ${label} feedback from ${target}: ${result.message} (${result.code})`);
        return null;
    }

    for (const log of result.logs ?? []) {
        const parsed = parser(log);
        if (parsed && (parsed.passwordAttempted == null || parsed.passwordAttempted === expectedAttempt)) return parsed;
    }
    return null;
}

function getCharsetForPasswordFormat(format) {
    if (format === "numeric") return "0123456789";
    if (format === "alphabetic") return "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    if (format === "alphanumeric") return "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
    return null;
}

async function spreadToNeighbor(ns, script, target, password, interval, verboseTerminal) {
    try {
        const session = ns.dnet.connectToSession(target, password);
        if (!session.success) return;
        const requiredRam = ns.getScriptRam(script, ns.getHostname());
        const maxRam = ns.getServerMaxRam(target);
        const freeRam = maxRam - ns.getServerUsedRam(target);
        if (requiredRam <= 0 || maxRam < requiredRam || freeRam < requiredRam) {
            const key = `${target}:${requiredRam}:${maxRam}`;
            if (!skippedSpreadForRam.has(key)) {
                skippedSpreadForRam.add(key);
                ns.print(`INFO: Not spreading ${script} to ${target}; needs ${formatRam(requiredRam)}, ` +
                    `target has ${formatRam(freeRam)} free / ${formatRam(maxRam)} max.`);
            }
            return;
        }
        await ns.scp(script, target, ns.getHostname());
        if (ns.fileExists(PHISHING_FILE, ns.getHostname())) await ns.scp(PHISHING_FILE, target, ns.getHostname());
        if (ns.fileExists(STASIS_FILE, ns.getHostname())) await ns.scp(STASIS_FILE, target, ns.getHostname());
        if (ns.fileExists(STORM_FILE, ns.getHostname())) await ns.scp(STORM_FILE, target, ns.getHostname());
        if (ns.fileExists(STATE_FILE, ns.getHostname())) await ns.scp(STATE_FILE, target, ns.getHostname());
        if (ns.fileExists(TOPOLOGY_FILE, ns.getHostname())) await ns.scp(TOPOLOGY_FILE, target, ns.getHostname());
        await launchStormHelperIfPossible(ns, target, verboseTerminal);
        const args = ["--origin", ns.getHostname(), "--interval", interval, "--dedicated-phishing"];
        if (verboseTerminal) args.push("--verbose-terminal");
        for (const process of ns.ps(target).filter(process =>
            (process.filename === script || process.filename.endsWith(`/${script}`)) && !process.args.includes("--dedicated-phishing")))
            ns.kill(process.pid);
        const pid = ns.exec(script, target, { threads: 1, preventDuplicates: true }, ...args);
        if (pid > 0) ns.print(`INFO: Spread ${script} to ${target} (pid ${pid}).`);
    } catch (error) {
        ns.print(`WARN: Could not spread to ${target}: ${formatError(error)}`);
    }
}

async function launchLocalPhishingWorker(ns) {
    const host = ns.getHostname();
    if (!ns.fileExists(PHISHING_FILE, host)) return false;
    if (isScriptRunning(ns, host, PHISHING_FILE)) return true;
    const workerRam = ns.getScriptRam(PHISHING_FILE, host);
    const freeRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
    const helperReserve = 16;
    const threads = workerRam > 0 ? Math.floor(Math.max(0, freeRam - helperReserve) / workerRam) : 0;
    if (threads < 1) return false;
    const pid = ns.exec(PHISHING_FILE, host, { threads, preventDuplicates: true });
    if (pid > 0) {
        ns.print(`INFO: Started ${PHISHING_FILE} on ${host} with ${threads} threads (pid ${pid}).`);
        return true;
    }
    return false;
}

async function launchStormHelperIfPossible(ns, target, verboseTerminal) {
    if (!ns.fileExists(STORM_FILE, target) || isScriptRunning(ns, target, STORM_FILE)) return;
    if (!ns.fileExists(STORM_SEED_PROGRAM, target)) return;
    const requiredRam = ns.getScriptRam(STORM_FILE, target);
    const freeRam = ns.getServerMaxRam(target) - ns.getServerUsedRam(target);
    if (requiredRam <= 0 || freeRam < requiredRam) return;
    const args = [];
    if (verboseTerminal) args.push("--verbose-terminal");
    ns.exec(STORM_FILE, target, { threads: 1, preventDuplicates: true }, ...args);
}

function isScriptRunning(ns, host, script) {
    return ns.ps(host).some(process => process.filename === script || process.filename.endsWith(`/${script}`));
}

function buildCandidates(details) {
    const model = details.modelId;
    const data = String(details.data ?? "");
    const hint = String(details.passwordHint ?? "");
    const passwordLength = Number(details.passwordLength ?? 0);
    if (model === "ZeroLogon") return [""];
    if (model === "DeskMemo_3.1") return [lastHintToken(hint)];
    if (model === "FreshInstall_1.0") return ["admin", "password", "0000", "12345"];
    if (model === "CloudBlare(tm)") return [data.replace(/\D/g, "")];
    if (model === "Laika4") return ["fido", "spot", "rover", "max"];
    if (model === "TopPass") return COMMON_PASSWORDS;
    if (model === "EuroZone Free") return EU_COUNTRIES;
    if (model === "BellaCuore") return solveRoman(data);
    if (model === "PrimeTime 2") return [String(largestKnownPrimeFactor(Number(data)))];
    if (model === "110100100") return [data.split(/\s+/).map(bits => String.fromCharCode(parseInt(bits, 2))).join("")];
    if (model === "OrdoXenos") return [xorDecode(data)];
    if (model === "OctantVoxel") return [String(Math.round(parseBaseN(data)))];
    if (model === "MathML") return [String(parseArithmeticExpression(data))];
    if (model === "Pr0verFl0") return ["A".repeat(Math.max(1, details.passwordLength * 2))];
    if (model === "PHP 5.4") return permuteString(data.replace(/\D/g, ""));
    if (model === "AccountsManager_4.2") return sequentialNumericPasswords(passwordLength);
    if (model === "Factori-Os") return solveFactoriOs(hint, passwordLength);
    return [];
}

export function __testBuildCandidates(details) {
    return buildCandidates(details);
}

export function __testRunSelfTest() {
    return runSelfTest();
}

export function __testParseYesntFeedback(log) {
    return parseYesntFeedback(log);
}

export function __testParsePacketSnifferCandidates(target, details, authResult) {
    return parsePacketSnifferCandidates(target, details, authResult);
}

export function __testParseLeakedPasswordCandidates(target, details, log) {
    return parseLeakedPasswordCandidates(target, details, log);
}

export function __testParseTimingFeedback(log) {
    return parseTimingFeedback(log);
}

export function __testParsePepperFeedback(log) {
    return parsePepperFeedback(log);
}

export function __testParseFactoriOsFeedback(log) {
    return parseFactoriOsFeedback(log);
}

function runSelfTest() {
    // Delegate test execution to an external file to keep the main code clean.
    const { runTests } = require("./tests/darknet-worker.tests.js");
    return runTests(buildCandidates);
}

// Export runSelfTest for external callers (e.g., CI or manual checks).
export { runSelfTest };

function lastHintToken(hint) {
    return hint.trim().split(/\s+/).at(-1) ?? "";
}

function primesUpTo(limit) {
    return Array.from({ length: Math.max(0, Math.floor(limit) - 1) }, (_, index) => index + 2).filter(isPrime);
}

function isPrime(value) {
    if (value < 2 || !Number.isInteger(value)) return false;
    for (let divisor = 2; divisor * divisor <= value; divisor++) {
        if (value % divisor === 0) return false;
    }
    return true;
}

function sequentialNumericPasswords(passwordLength) {
    if (passwordLength >= 1 && passwordLength <= 4)
        return Array.from({ length: 10 ** passwordLength }, (_, value) => String(value).padStart(passwordLength, "0"));
    return [];
}

function solveFactoriOs(hint, passwordLength) {
    const divisor = Number(String(hint).match(/divisible by\s+(\d+)/i)?.[1] ?? 1);
    const candidates = sequentialNumericPasswords(passwordLength);
    if (!Number.isFinite(divisor) || divisor <= 1) return candidates;
    return candidates.filter(candidate => Number(candidate) % divisor === 0);
}

function permuteString(value) {
    if (value.length <= 1) return [value];
    const results = new Set();
    for (let i = 0; i < value.length; i++) {
        const char = value[i];
        const remaining = value.slice(0, i) + value.slice(i + 1);
        for (const permutation of permuteString(remaining)) results.add(char + permutation);
    }
    return [...results];
}

function parseYesntFeedback(log) {
    const parsed = parsePasswordResponseLog(log);
    const data = parsed?.data ?? parsed?.message?.data;
    if (typeof data !== "string") return null;
    const feedback = data.split(",");
    if (!feedback.every(value => value === "yes" || value === "yesn't")) return null;
    return {
        feedback,
        passwordAttempted: parsed?.passwordAttempted ?? parsed?.message?.passwordAttempted,
    };
}

function parseTimingFeedback(log) {
    const parsed = parsePasswordResponseLog(log);
    const message = String(parsed?.message ?? "");
    const match = message.match(/mismatch while checking each character \((-?\d+)\)/i);
    if (!match) return null;
    return {
        mismatchIndex: Number(match[1]),
        passwordAttempted: parsed?.passwordAttempted,
    };
}

function parsePepperFeedback(log) {
    const parsed = parsePasswordResponseLog(log);
    const data = String(parsed?.data ?? "");
    const match = data.match(/^(0|(?:🌶️)+)\/(\d+)$/u);
    if (!match) return null;
    return {
        pepperCount: match[1] === "0" ? 0 : [...match[1].matchAll(/🌶️/gu)].length,
        passwordAttempted: parsed?.passwordAttempted,
    };
}

function parseFactoriOsFeedback(log) {
    const parsed = parsePasswordResponseLog(log);
    const data = parsed?.data;
    if (data !== true && data !== false && data !== "true" && data !== "false") return null;
    return {
        divisible: data === true || data === "true",
        passwordAttempted: parsed?.passwordAttempted,
    };
}

function parsePacketSnifferCandidates(target, details, authResult) {
    const passwordLength = Math.max(0, Number(details.passwordLength) || 0);
    const pattern = getPasswordPattern(details.passwordFormat, passwordLength);
    if (!pattern) return [];

    const candidates = [];
    const targetPattern = escapeRegExp(target);
    const targetPasswordRegex = new RegExp(`${targetPattern}\\s*:\\s*(${pattern})`, "g");
    const passcodeRegex = new RegExp(`passcode\\s*[:=]\\s*(${pattern})`, "gi");
    const tokenRegex = new RegExp(`(?:^|[^0-9A-Za-z])(${pattern})(?=$|[^0-9A-Za-z])`, "g");
    for (const text of collectPacketSnifferTexts(details, authResult)) {
        collectRegexMatches(candidates, text, targetPasswordRegex);
        collectRegexMatches(candidates, text, passcodeRegex);

        const fallbackText = text
            .split(/\r?\n/)
            .filter(line => !/passwordAttempted/i.test(line))
            .join("\n");
        collectRegexMatches(candidates, fallbackText, tokenRegex);
    }
    return unique(candidates).filter(candidate => isPasswordFormatMatch(candidate, details.passwordFormat, passwordLength)).slice(0, 64);
}

function parseLeakedPasswordCandidates(target, details, log) {
    const passwordLength = Math.max(0, Number(details.passwordLength) || 0);
    const pattern = getPasswordPattern(details.passwordFormat, passwordLength);
    if (!pattern) return [];

    const candidates = [];
    const targetPattern = escapeRegExp(target);
    const targetPasswordRegex = new RegExp(`${targetPattern}\\s*:\\s*(${pattern})`, "g");
    const passcodeRegex = new RegExp(`passcode\\s*[:=]\\s*(${pattern})`, "gi");
    const doubleDashRegex = new RegExp(`--(${pattern})--`, "g");
    for (const text of collectPacketSnifferTexts(null, log)) {
        collectRegexMatches(candidates, text, targetPasswordRegex);
        collectRegexMatches(candidates, text, passcodeRegex);
        collectRegexMatches(candidates, text, doubleDashRegex);
    }
    return unique(candidates).filter(candidate => isPasswordFormatMatch(candidate, details.passwordFormat, passwordLength)).slice(0, 32);
}

function collectPacketSnifferTexts(details, authResult) {
    const texts = [];
    collectStringValues(details?.data, texts);
    collectStringValues(authResult?.data, texts);
    collectStringValues(authResult?.message, texts);
    collectStringValues(authResult?.message?.data, texts);
    return texts;
}

function collectStringValues(value, texts) {
    if (typeof value === "string") {
        if (value) texts.push(value);
        return;
    }
    if (value == null || typeof value !== "object") return;
    for (const child of Object.values(value)) collectStringValues(child, texts);
}

function collectRegexMatches(results, text, regex) {
    regex.lastIndex = 0;
    for (const match of String(text).matchAll(regex)) {
        if (match[1]) results.push(match[1]);
    }
}

function getPasswordPattern(format, passwordLength) {
    const length = passwordLength > 0 ? `{${passwordLength}}` : "+";
    if (format === "numeric") return `\\d${length}`;
    if (format === "alphabetic") return `[A-Za-z]${length}`;
    if (format === "alphanumeric") return `[0-9A-Za-z]${length}`;
    return `\\S${length}`;
}

function isPasswordFormatMatch(candidate, format, passwordLength) {
    if (passwordLength > 0 && candidate.length !== passwordLength) return false;
    if (format === "numeric") return /^\d+$/.test(candidate);
    if (format === "alphabetic") return /^[A-Za-z]+$/.test(candidate);
    if (format === "alphanumeric") return /^[0-9A-Za-z]+$/.test(candidate);
    return candidate.length > 0;
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parsePasswordResponseLog(log) {
    let parsed;
    try {
        parsed = typeof log === "string" ? JSON.parse(log) : log;
    } catch {
        parsed = parseKeyValueLog(log);
    }
    if (parsed?.message && typeof parsed.message === "object") return parsed.message;
    if (parsed?.data != null || parsed?.passwordAttempted != null) return parsed;
    if (typeof parsed?.message === "string") return parsed;
    return parseKeyValueLog(log);
}

function parseKeyValueLog(log) {
    const result = {};
    for (const line of String(log).split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Za-z]+):\s*(.*)\s*$/);
        if (match) result[match[1]] = match[2];
    }
    return result;
}

function tryLinkStasisNearLabyrinth(ns, target, details) {
    if (details.modelId !== "(The Labyrinth)") return;
    const host = ns.getHostname();
    if (!ns.fileExists(STASIS_FILE, host)) return;
    try {
        const freeRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
        const neededRam = ns.getScriptRam(STASIS_FILE, host);
        if (neededRam <= 0 || freeRam < neededRam) return;
        const pid = ns.exec(STASIS_FILE, host, { threads: 1, preventDuplicates: true }, true);
        if (pid > 0) ns.print(`INFO: Started stasis link helper near ${target} (pid ${pid}).`);
    } catch (error) {
        ns.print(`WARN: Cannot start stasis link helper near ${target}: ${formatError(error)}`);
    }
}

function solveRoman(data) {
    const parts = data.split(",");
    if (parts.length === 1) return [String(romanToNumber(parts[0]))];
    const min = romanToNumber(parts[0]);
    const max = romanToNumber(parts[1]);
    if (!Number.isFinite(min) || !Number.isFinite(max) || max < min || max - min > 120) return [];
    return Array.from({ length: max - min + 1 }, (_, offset) => String(min + offset));
}

function romanToNumber(input) {
    if (input.toLowerCase() === "nulla") return 0;
    const values = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
    let total = 0;
    let previous = 0;
    for (let i = input.length - 1; i >= 0; i--) {
        const value = values[input[i]] ?? NaN;
        if (!Number.isFinite(value)) return NaN;
        total += value < previous ? -value : value;
        previous = value;
    }
    return total;
}

function largestKnownPrimeFactor(value) {
    for (const prime of [...LARGE_PRIMES].reverse()) {
        if (value % prime === 0) return prime;
    }
    return NaN;
}

function xorDecode(data) {
    const [masked, maskText] = data.split(";");
    if (!masked || !maskText) return "";
    return masked.split("").map((char, index) => {
        const mask = parseInt(maskText.split(/\s+/)[index], 2);
        return String.fromCharCode(char.charCodeAt(0) ^ mask);
    }).join("");
}

function parseBaseN(data) {
    const [baseText, encoded] = data.split(",");
    const base = Number(baseText);
    const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    let result = 0;
    let digit = encoded.split(".")[0].length - 1;
    for (const char of encoded) {
        if (char === ".") continue;
        result += chars.indexOf(char) * base ** digit;
        digit -= 1;
    }
    return result;
}

function parseArithmeticExpression(expression) {
    const cleaned = expression
        .replaceAll("ҳ", "*")
        .replaceAll("÷", "/")
        .replaceAll("➕", "+")
        .replaceAll("➖", "-")
        .replaceAll("ns.exit(),", "")
        .split(",")[0]
        .replace(/[^0-9+\-*/().\s]/g, "");
    return parseExpression(cleaned.replace(/\s+/g, ""));
}

function parseExpression(input) {
    let index = 0;
    const parseNumber = () => {
        if (input[index] === "(") {
            index += 1;
            const value = parseAddSub();
            if (input[index] === ")") index += 1;
            return value;
        }
        const match = input.slice(index).match(/^-?\d+(?:\.\d+)?/);
        if (!match) return 0;
        index += match[0].length;
        return Number(match[0]);
    };
    const parseMulDiv = () => {
        let value = parseNumber();
        while (input[index] === "*" || input[index] === "/") {
            const op = input[index++];
            const right = parseNumber();
            value = op === "*" ? value * right : value / right;
        }
        return value;
    };
    const parseAddSub = () => {
        let value = parseMulDiv();
        while (input[index] === "+" || input[index] === "-") {
            const op = input[index++];
            const right = parseMulDiv();
            value = op === "+" ? value + right : value - right;
        }
        return value;
    };
    return parseAddSub();
}

async function openLocalCaches(ns) {
    const host = ns.getHostname();
    for (const file of ns.ls(host, ".cache")) {
        try {
            const result = ns.dnet.openCache(file, true);
            if (result.success) ns.print(`SUCCESS: Opened darknet cache ${file} on ${host}: ${result.message}`);
        } catch (error) {
            ns.print(`WARN: Could not open cache ${file}: ${formatError(error)}`);
        }
    }
}

async function freeLocalBlockedRam(ns) {
    for (let i = 0; i < 3; i++) {
        let blocked = 0;
        try {
            blocked = ns.dnet.getBlockedRam();
        } catch {
            return;
        }
        if (blocked <= 0) return;
        const result = await ns.dnet.memoryReallocation();
        if (!result.success) return;
    }
}

async function tryPhishing(ns) {
    const host = ns.getHostname();
    const freeRam = ns.getServerMaxRam(host) - ns.getServerUsedRam(host);
    if (freeRam < 2.5) return;
    try {
        const result = await ns.dnet.phishingAttack();
        if (result.success) ns.print(`SUCCESS: ${result.message}`);
    } catch (error) {
        ns.print(`WARN: Phishing failed: ${formatError(error)}`);
    }
}

function readKnownPasswords(ns) {
    try {
        const text = ns.read(STATE_FILE);
        if (!text) return {};
        return JSON.parse(text);
    } catch {
        return {};
    }
}

function writeKnownPasswords(ns, passwords) {
    try {
        ns.write(STATE_FILE, JSON.stringify(passwords), "w");
        return true;
    } catch {
        // State persistence is best-effort. The crawler can still rediscover passwords.
        return false;
    }
}

async function syncKnownPasswords(ns, origin) {
    await syncDarknetCacheFile(ns, STATE_FILE, origin);
}

async function syncDarknetCacheFile(ns, file, origin) {
    const host = ns.getHostname();
    for (const destination of unique(["home", origin]).filter(server => server && server !== host)) {
        try {
            await ns.scp(file, destination, host);
        } catch {
            // Best-effort visibility cache for scan.js; exploration should not depend on it.
        }
    }
}

function readDarknetTopology(ns) {
    try {
        const text = ns.read(TOPOLOGY_FILE);
        if (!text) return { parents: {}, children: {} };
        const parsed = JSON.parse(text);
        return {
            parents: parsed?.parents && typeof parsed.parents === "object" ? parsed.parents : {},
            children: parsed?.children && typeof parsed.children === "object" ? parsed.children : {},
        };
    } catch {
        return { parents: {}, children: {} };
    }
}

function recordDarknetTopology(ns, host, neighbors) {
    const topology = readDarknetTopology(ns);
    const children = new Set(topology.children[host] ?? []);
    let changed = false;
    for (const neighbor of neighbors) {
        if (!neighbor || neighbor === host) continue;
        if (!children.has(neighbor)) {
            children.add(neighbor);
            changed = true;
        }
        if (topology.parents[neighbor] == null) {
            topology.parents[neighbor] = host;
            changed = true;
        }
    }
    const nextChildren = [...children].sort();
    if (JSON.stringify(topology.children[host] ?? []) !== JSON.stringify(nextChildren)) {
        topology.children[host] = nextChildren;
        changed = true;
    }
    if (!changed) return false;
    try {
        ns.write(TOPOLOGY_FILE, JSON.stringify(topology), "w");
        return true;
    } catch {
        return false;
    }
}

function unique(values) {
    return [...new Set(values.filter(value => value != null).map(value => String(value)))];
}

function terminalLog(ns, verboseTerminal, message) {
    if (verboseTerminal) ns.tprint(message);
    else ns.print(message);
}

function formatError(error) {
    if (typeof error === "string") return error;
    return error?.message ?? JSON.stringify(error);
}

function formatRam(gb) {
    if (!Number.isFinite(gb)) return `${gb}`;
    if (gb >= 1024) return `${(gb / 1024).toFixed(2)}TB`;
    return `${gb.toFixed(2)}GB`;
}
