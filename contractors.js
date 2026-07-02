const contractorScript = "Tasks/contractor.js";

/** Periodically launches the one-shot coding contract solver. @param {NS} ns */
export async function main(ns) {
    const options = ns.flags([
        ["interval", 30000],
        ["help", false],
    ]);
    if (options.help) {
        ns.tprint(`Usage: run ${ns.getScriptName()} [--interval 30000]`);
        return;
    }

    const host = ns.getHostname();
    const interval = Math.max(5000, Number(options.interval) || 30000);
    const ownScript = normalizeScriptName(ns.getScriptName());
    const olderInstance = ns.ps(host).some(process =>
        normalizeScriptName(process.filename) === ownScript && process.pid < ns.pid);
    if (olderInstance) {
        ns.print(`INFO: Another ${ns.getScriptName()} instance is already running on ${host}.`);
        return;
    }

    ns.print(`INFO: Periodically launching ${contractorScript} every ${interval}ms.`);
    let launchFailureLogged = false;
    while (true) {
        const contractorRunning = ns.ps(host).some(process =>
            normalizeScriptName(process.filename) === normalizeScriptName(contractorScript));
        if (!contractorRunning) {
            const pid = ns.run(contractorScript, { threads: 1, preventDuplicates: true, temporary: false });
            if (pid > 0) {
                launchFailureLogged = false;
            } else if (!launchFailureLogged) {
                ns.print(`WARN: Could not launch ${contractorScript}; check that the file exists and enough RAM is free.`);
                launchFailureLogged = true;
            }
        }
        await ns.sleep(interval);
    }
}

function normalizeScriptName(filename) {
    return String(filename).replace(/^\/+/, "");
}
