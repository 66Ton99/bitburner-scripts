import { instanceCount, getFilePath, getNsDataThroughFile, disableLogs, log } from '../helpers.js'
const scriptSolver = getFilePath("/Tasks/contractor.js.solver.js");
const darknetTopologyFile = "/Temp/darknet-topology.txt";
const darknetPasswordsFile = "/Temp/darknet-passwords.txt";

/** @param {NS} ns **/
export async function main(ns) {
    // Prevent multiple instances of this script from being started
    if (await instanceCount(ns, "home", false, false) > 1)
        return log(ns, 'Another instance is already running. Shutting down...');

    disableLogs(ns, ["scan"]);
    ns.print("Getting server list...");
    const normalServers = await getNsDataThroughFile(ns, 'scanAllServers(ns)');
    const darknetServers = await getKnownDarknetServers(ns);
    const servers = [...new Set([...normalServers, ...darknetServers])];
    ns.print(`Got ${normalServers.length} normal and ${darknetServers.length} known Darknet servers. ` +
        `Searching ${servers.length} servers for contracts...`);
    // Retrieve all contracts and convert them to objects with the required information to solve
    const darknetServerSet = new Set(darknetServers);
    const contractsDb = [];
    for (const hostname of servers) {
        let contractHost = hostname;
        let contracts;
        try {
            contracts = ns.ls(contractHost, '.cct');
        } catch (error) {
            if (darknetServerSet.has(hostname)) {
                const ip = getDarknetServerIp(ns, hostname);
                if (ip) {
                    try {
                        contracts = ns.ls(ip, '.cct');
                        contractHost = ip;
                        ns.print(`INFO: Accessing Darknet server '${hostname}' by IP ${ip}.`);
                    } catch {
                        // Report the original hostname error below; it is more useful for diagnosing a stale cache.
                    }
                }
            }
            if (!contracts) {
                ns.print(`WARN: Skipping inaccessible cached server '${hostname}': ${error?.message ?? error}`);
                continue;
            }
        }
        for (const contract of contracts) contractsDb.push({ contract, hostname: contractHost });
    }
    if (contractsDb.length == 0)
        return ns.print("Found no contracts to solve.");

    // Spawn temporary scripts to gather the remainder of contract data required for solving
    ns.print(`Found ${contractsDb.length} contracts to solve. Gathering contract data via separate scripts..."`);
    const serializedContractDb = JSON.stringify(contractsDb);
    let contractsCommand = async (command, tempName) => await getNsDataThroughFile(ns,
        `JSON.parse(ns.args[0]).map(c => ${command})`, tempName, [serializedContractDb]);
    let contractTypes = await contractsCommand('ns.codingcontract.getContractType(c.contract, c.hostname)', '/Temp/contract-types-by-host-v2.txt');
    let contractDataStrings = await contractsCommand('JSON.stringify(ns.codingcontract.getData(c.contract, c.hostname), jsonReplacer)', '/Temp/contract-data-stringified-by-host-v2.txt');
    contractsDb.forEach((c, i) => c.type = contractTypes[i]);
    contractsDb.forEach((c, i) => c.dataJson = contractDataStrings[i]);

    // Let this script die to free up ram, and start up a new script (after a delay) that will solve all these contracts using the minimum ram footprint of 11.6 GB
    ns.run(getFilePath('/Tasks/run-with-delay.js'), { temporary: true }, scriptSolver, 1, JSON.stringify(contractsDb));
}

/** @param {NS} ns */
async function getKnownDarknetServers(ns) {
    const cacheFiles = [darknetTopologyFile, darknetPasswordsFile];
    const host = ns.getHostname();
    if (host !== "home") {
        for (const file of cacheFiles)
            if (ns.fileExists(file, "home")) await ns.scp(file, host, "home");
    }

    const servers = new Set();
    const topology = readJson(ns, darknetTopologyFile);
    if (topology) {
        for (const server of Object.keys(topology.parents ?? {})) servers.add(server);
        for (const [server, neighbors] of Object.entries(topology.children ?? {})) {
            servers.add(server);
            if (Array.isArray(neighbors)) for (const neighbor of neighbors) servers.add(neighbor);
        }
    }

    const passwords = readJson(ns, darknetPasswordsFile);
    if (passwords) for (const server of Object.keys(passwords)) servers.add(server);
    if (topology || passwords) servers.add("darkweb");
    servers.delete("home");
    return [...servers].filter(Boolean).sort();
}

/** @param {NS} ns */
function readJson(ns, file) {
    try {
        const contents = ns.read(file);
        return contents ? JSON.parse(contents) : null;
    } catch (error) {
        ns.print(`WARN: Ignoring invalid Darknet cache ${file}: ${error?.message ?? error}`);
        return null;
    }
}

/** @param {NS} ns */
function getDarknetServerIp(ns, hostname) {
    try {
        let details;
        if (typeof ns.dnet?.getServerDetails === "function") details = ns.dnet.getServerDetails(hostname);
        else if (typeof ns.dnet?.getServer === "function") details = ns.dnet.getServer(hostname);
        else if (typeof ns.dnet?.getServerAuthDetails === "function") details = ns.dnet.getServerAuthDetails(hostname);
        return typeof details?.ip === "string" && details.ip ? details.ip : null;
    } catch {
        return null;
    }
}
