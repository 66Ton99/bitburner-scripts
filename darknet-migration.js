/** @param {NS} ns */
export async function main(ns) {
    const options = ns.flags([
        ["origin", "home"],
        ["interval", 60000],
        ["verbose-terminal", false],
        ["help", false],
    ]);
    if (options.help) {
        ns.tprint(`Usage: run ${ns.getScriptName()} [--origin home] [--interval 60000] [--verbose-terminal]`);
        return;
    }
    if (!ns.dnet) return;
    ns.disableLog("sleep");

    const interval = Math.max(1000, Number(options.interval) || 60000);
    const origin = String(options.origin);
    while (true) {
        try {
            await induceOneMigration(ns, origin, options["verbose-terminal"]);
        } catch (error) {
            ns.print(`WARN: Darknet migration helper failed on ${ns.getHostname()}: ${formatError(error)}`);
        }
        await ns.sleep(interval);
    }
}

async function induceOneMigration(ns, origin, verboseTerminal) {
    const host = ns.getHostname();
    const neighbors = ns.dnet.probe(false).filter(server => server !== origin && server !== host);
    for (const target of neighbors) {
        const details = getDarknetServerDetails(ns, target);
        if (!details.isOnline || details.isStationary) continue;
        const result = await ns.dnet.induceServerMigration(target);
        if (result.success) terminalLog(ns, verboseTerminal, `INFO: Induced migration pressure on ${target}.`);
        return;
    }
}

function getDarknetServerDetails(ns, target) {
    try {
        if (typeof ns.dnet.getServerDetails === "function") return ns.dnet.getServerDetails(target);
        if (typeof ns.dnet.getServer === "function") return ns.dnet.getServer(target);
        if (typeof ns.dnet.getServerAuthDetails === "function") return ns.dnet.getServerAuthDetails(target);
    } catch {
        return {};
    }
    return {};
}

function terminalLog(ns, verboseTerminal, message) {
    if (verboseTerminal) ns.tprint(message);
    else ns.print(message);
}

function formatError(error) {
    if (typeof error === "string") return error;
    return error?.message ?? JSON.stringify(error);
}
