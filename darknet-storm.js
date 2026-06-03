const STORM_SEED_PROGRAM = "STORM_SEED.exe";

/** @param {NS} ns */
export async function main(ns) {
    const options = ns.flags([
        ["interval", 60000],
        ["verbose-terminal", false],
        ["help", false],
    ]);
    if (options.help) {
        ns.tprint(`Usage: run ${ns.getScriptName()} [--interval 60000] [--verbose-terminal]`);
        return;
    }
    if (!ns.dnet) return;
    ns.disableLog("sleep");

    const host = ns.getHostname();
    if (!ns.fileExists(STORM_SEED_PROGRAM, host)) {
        ns.print(`${STORM_SEED_PROGRAM} not found on ${host}; exiting storm helper.`);
        return;
    }

    const interval = Math.max(1000, Number(options.interval) || 60000);
    while (true) {
        try {
            const result = ns.dnet.unleashStormSeed();
            if (result.success) terminalLog(ns, options["verbose-terminal"], `SUCCESS: Unleashed storm seed on ${ns.getHostname()}.`);
            if (result.success || result.code === 404) return;
        } catch (error) {
            const message = formatError(error);
            if (!message.includes("not found")) ns.print(`WARN: Storm seed helper failed on ${ns.getHostname()}: ${message}`);
        }
        await ns.sleep(interval);
    }
}

function terminalLog(ns, verboseTerminal, message) {
    if (verboseTerminal) ns.tprint(message);
    else ns.print(message);
}

function formatError(error) {
    if (typeof error === "string") return error;
    return error?.message ?? JSON.stringify(error);
}
