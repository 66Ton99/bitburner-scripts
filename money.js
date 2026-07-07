/**
 * Simple orchestrator that ensures the core money‑generation scripts are running.
 *
 * The script is intentionally lightweight – it does not attempt any fancy scheduling
 * or argument handling beyond what is required for the three target scripts.
 */

/** @param {NS} ns */
export async function main(ns) {
    // Define the scripts we want to keep running and any required arguments.
    const targets = [
        { file: "stats.js", args: [] },
        { file: "corporation.js", args: [] },
        { file: "stockmaster.js", args: [] },
        { file: "darknet.js", args: [""] },
        { file: "contractors.js", args: [""] },
        { file: "gangs.js", args: [""] },
        { file: "hack.js", args: ["--money-focus", "--preserve-hacknet-servers", "--money-focus-spare-xp-utilization", "0.97"] },
    ];

    // Helper to check if a script with the exact argument list is already running.
    const isRunning = (file, args) => ns.ps("home").some(p => {
        if (p.filename !== file) return false;
        // ns.ps returns args as an array; compare shallowly.
        const runningArgs = p.args || [];
        if (runningArgs.length !== args.length) return false;
        for (let i = 0; i < args.length; i++) if (runningArgs[i] !== args[i]) return false;
        return true;
    });

    for (const { file, args } of targets) {
        if (!isRunning(file, args)) {
            // Use ns.run to start the script with a single thread.
            ns.run(file, 1, ...args);
        }
    }
}

