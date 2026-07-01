/** @param {NS} ns
 * Wait until an appointed time and then execute a manual hack. */
export async function main(ns) {
    // Keep the batch-worker argument contract aligned with hack-target.js.
    const [
        /*args[0] target (manualHack acts on the connected server)*/,
        /*args[1]*/ desiredStartTime = 0,
        /*args[2]*/ expectedDuration = 0,
        /*args[3] description*/,
        /*args[4] manipulateStock (not supported by manualHack)*/,
        /*args[5]*/ disableToastWarnings = false,
        /*args[6]*/ loop = false
    ] = ns.args;
    const sleepDuration = desiredStartTime - Date.now();
    let cycleTime = expectedDuration * 4;
    if (cycleTime < 100) cycleTime = Math.max(1, Math.min(5, cycleTime * 2)); // For fast hacking loops, inject a delay on hack in case grow/weaken are running a bit slow.
    if (sleepDuration > 0)
        await ns.sleep(sleepDuration);
    do {
        if (!await ns.singularity.manualHack() && !disableToastWarnings)
            ns.toast(`Warning, hack stole 0 money. Might be a misfire. ${JSON.stringify(ns.args)}`, 'warning');
        if (loop) await ns.sleep(cycleTime - expectedDuration);
    } while (loop);
}
