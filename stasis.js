/** @param {NS} ns */
export async function main(ns) {
    const enabled = parseBooleanArg(ns.args[0] ?? true);
    if (enabled == null) {
        ns.tprint(`Usage: run ${ns.getScriptName()} [true|false]`);
        return;
    }
    await ns.dnet.setStasisLink(enabled);
}

function parseBooleanArg(value) {
    if (typeof value === "boolean") return value;
    const text = String(value).trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(text)) return true;
    if (["false", "0", "no", "off"].includes(text)) return false;
    return null;
}
