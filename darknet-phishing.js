/** @param {NS} ns */
export async function main(ns) {
    const options = ns.flags([
        ["retry-delay", 250],
        ["status-interval", 60000],
        ["verbose-terminal", false],
    ]);
    if (!ns.dnet) return;
    ns.disableLog("sleep");

    const retryDelay = Math.max(0, Number(options["retry-delay"]) || 0);
    const statusInterval = Math.max(10000, Number(options["status-interval"]) || 60000);
    let attempts = 0, successes = 0, lastStatus = Date.now();

    while (true) {
        try {
            attempts++;
            const result = await ns.dnet.phishingAttack();
            if (result.success) successes++;
            else if (retryDelay > 0) await ns.sleep(retryDelay);
        } catch (error) {
            ns.print(`WARN: Darknet phishing failed on ${ns.getHostname()}: ${formatError(error)}`);
            if (retryDelay > 0) await ns.sleep(retryDelay);
        }

        if (Date.now() - lastStatus >= statusInterval) {
            const message = `INFO: Darknet phishing on ${ns.getHostname()}: ${successes}/${attempts} successful attempts ` +
                `with ${ns.self().threads} threads.`;
            if (options["verbose-terminal"]) ns.tprint(message);
            else ns.print(message);
            attempts = successes = 0;
            lastStatus = Date.now();
        }
    }
}

function formatError(error) {
    if (typeof error === "string") return error;
    return error?.message ?? JSON.stringify(error);
}
