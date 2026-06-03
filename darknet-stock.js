const STOCK_SYMBOLS_FILE = "/Temp/stock-symbols.txt";

/** @param {NS} ns */
export async function main(ns) {
    const options = ns.flags([
        ["origin", "home"],
        ["interval", 60000],
        ["promote-stock", ""],
        ["verbose-terminal", false],
        ["help", false],
    ]);
    if (options.help) {
        ns.tprint(`Usage: run ${ns.getScriptName()} [--origin home] [--interval 60000] [--promote-stock SYM[,SYM...]] [--verbose-terminal]`);
        return;
    }
    if (!ns.dnet) return;
    ns.disableLog("sleep");

    const interval = Math.max(1000, Number(options.interval) || 60000);
    let nextSymbolIndex = 0;
    let loggedNoSymbols = false;
    while (true) {
        try {
            await syncStockSymbolsFromHome(ns);
            const symbols = getPromotionSymbols(ns, String(options["promote-stock"] ?? ""));
            if (symbols.length === 0) {
                if (!loggedNoSymbols) ns.print(`INFO: No stock symbols available for darknet stock promotion.`);
                loggedNoSymbols = true;
            } else {
                loggedNoSymbols = false;
                const symbol = symbols[nextSymbolIndex++ % symbols.length];
                const result = await ns.dnet.promoteStock(symbol);
                if (result.success) terminalLog(ns, options["verbose-terminal"], `INFO: Promoted stock volatility for ${symbol}.`);
            }
        } catch (error) {
            ns.print(`WARN: Darknet stock promotion helper failed on ${ns.getHostname()}: ${formatError(error)}`);
        }
        await ns.sleep(interval);
    }
}

async function syncStockSymbolsFromHome(ns) {
    if (ns.getHostname() === "home") return;
    try {
        await ns.scp(STOCK_SYMBOLS_FILE, ns.getHostname(), "home");
    } catch {
        // Optional stockmaster cache. Explicit --promote-stock symbols still work without it.
    }
}

function getPromotionSymbols(ns, explicitSymbols) {
    const explicit = parseStockSymbols(explicitSymbols);
    if (explicit.length > 0) return explicit;
    return parseStockSymbols(ns.read(STOCK_SYMBOLS_FILE));
}

function parseStockSymbols(value) {
    const text = String(value ?? "").trim();
    if (!text) return [];
    try {
        const parsed = JSON.parse(text);
        if (Array.isArray(parsed)) return unique(parsed.map(symbol => String(symbol).trim()).filter(Boolean));
    } catch {
        // Fall back to a simple CLI/cache text parser.
    }
    return unique(text.split(/[\s,]+/).map(symbol => symbol.trim()).filter(Boolean));
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
