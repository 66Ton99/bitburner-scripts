/**
 * Set up and run a corporation. Note that access to the corporation API costs tons of RAM.
 *
 * TODO: Make daemon.js reserve memory for a corporate script to run someplace if we have enough RAM.
 */

import { argsSchema } from './corporation-options.js';
import { formatMoney, formatNumberShort, getActiveSourceFiles, getStocksValue, getFilePath } from './helpers.js';

// Formatting for money and big numbers.
const mf = (n) => formatMoney(n, 6, 2);
const nf = (n) => formatNumberShort(n, 3);
const _ = globalThis._; // lodash
/** @typedef {import('./index.js').NS} NS */
/** @typedef {import('./index.js').Division} Division */
/** @typedef {import('./index.js').CorporationInfo} CorporationInfo */

// Global constants
const version = '2026-07-16-funding-warehouse-guard.1';
const initialProductDivisionCount = 2; // One material division to bootstrap, then one product division to scale funding.
const minimumProductInvestment = 2e9;

const bonusMaterials = ['Hardware', 'Robots', 'AI Cores', 'Real Estate'];
const materialSizes = { Water: 0.05, Ore: 0.01, Minerals: 0.04, Food: 0.03, Plants: 0.05, Metal: 0.1, Hardware: 0.06, Chemicals: 0.05, Drugs: 0.02, Robots: 0.5, 'AI Cores': 0.1, 'Real Estate': 0.005 };
const allMaterials = ['Water', 'Ore', 'Minerals', 'Food', 'Plants', 'Metal', 'Hardware', 'Chemicals', 'Drugs', 'Robots', 'AI Cores', 'Real Estate'];
// Map of material (by name) to their sizes (how much space it takes in warehouse)
const unlocks = ['Export', 'Smart Supply', 'Market Research - Demand', 'Market Data - Competition', 'Shady Accounting', 'Government Partnership', 'Warehouse API', 'Office API'];
const upgrades = ['Smart Factories', 'Smart Storage', 'Wilson Analytics', 'Nuoptimal Nootropic Injector Implants', 'Speech Processor Implants', 'Neural Accelerators', 'FocusWires', 'ABC SalesBots', 'Project Insight'];
const cities = ['Aevum', 'Chongqing', 'Sector-12', 'New Tokyo', 'Ishima', 'Volhaven'];
const hqCity = 'Aevum'; // Our production industries will need a headquarters. It doesn't matter which city we use, AFAICT.
const jobs = ['Operations', 'Engineer', 'Research & Development', 'Management', 'Business']; // Interns are deliberately excluded from production assignments.
const clearableJobs = ['Intern', ...jobs];
const industryAliases = { Agriculture: 'Agriculture', RealEstate: 'Real Estate', Computer: 'Computer Hardware', Food: 'Restaurant', Utilities: 'Water Utilities' };
const employeeWellnessThreshold = 0.9995;
const revenueGrowthSoftcap = 1e21;
const lateGameCatchUpOfficeSize = 180;
const lateGameBaseOfficeSizeLimit = 1000;
const lateGameMaxOfficeSizeLimit = 10000;
const historyLogFile = '/Temp/corporation-history.txt';
const corporationDivisionMultipliers = [1, 0.9, 1, 1, 0.75, 0.8, 0.8, 0, 0.8, 0.9, 0.9, 0.5, 0.4, 0.8];
const startupIndustryOrder = ['Refinery', 'Chemical', 'Agriculture', 'Fishing', 'Water Utilities', 'Mining'];
const preferredIndustryOrder = ['Tobacco', 'Software', 'Restaurant', 'Pharmaceutical', 'Computer Hardware', 'Real Estate', 'Robotics', 'Healthcare', 'Agriculture', 'Chemical', 'Refinery', 'Fishing', 'Water Utilities', 'Mining'];
const commonResearchPlan = [
    'Hi-Tech R&D Laboratory',
    'AutoBrew',
    'AutoPartyManager',
    'Market-TA.I',
    'Market-TA.II',
];
const growthResearchPlan = [
    'Drones',
    'Drones - Assembly',
    'Self-Correcting Assemblers',
    'Overclock',
    'Automatic Drug Administration',
    'CPH4 Injections',
    'Drones - Transport',
    'Go-Juice',
    'Sti.mu',
];

// Classes here, since we want to use Industry shortly.
class Industry {
    constructor(name = '', robFac = 0.0, aiFac = 0.0, advFac = 0.0, sciFac = 0.0, hwFac = 0.0, reFac = 0.0, reqMats = {}, prodMats = [], makesProducts = false, startupCost = 0) {
        this.name = name;
        this.factors = {
            Hardware: hwFac,
            Robots: robFac,
            'AI Cores': aiFac,
            'Real Estate': reFac,
            Science: sciFac,
            Advertising: advFac,
        };
        this.reqMats = reqMats;
        this.prodMats = prodMats;
        this.makesProducts = makesProducts;
        this.startupCost = startupCost;
        this.materialBonusPerSqMeter = {};
        for (const material of bonusMaterials) {
            this.materialBonusPerSqMeter[material] = this.factors[material] / materialSizes[material];
        }
        let scaleFactor = Object.values(this.materialBonusPerSqMeter).reduce((sum, prod) => sum + prod, 0);
        this.scaledMaterialBonus = {};
        for (const material of bonusMaterials) {
            this.scaledMaterialBonus[material] = this.materialBonusPerSqMeter[material] / scaleFactor;
        }
    }
    static fromObject(obj) {
        return new Industry(obj.name, obj.robFac, obj.aiFac, obj.advFac, obj.sciFac, obj.hwFac, obj.reFac, obj.reqMats, obj.prodMats, obj.makesProducts, obj.startupCost);
    }
}
class Task {
    /**
     * A Task that we will try to run later.
     * @param {string} name Human readable name of the task to be run.
     * @param {function} run callback to run the task.
     * @param {number} cost allocated budget for this task
     * @param {number} priority priority, higher number is a higher priority
     */
    constructor(name, run, cost = 0, priority = 0) {
        this.name = name;
        this.run = run;
        this.cost = cost;
        this.priority = priority; // Higher will be done sooner.
    }
}

// Industry and Material data copied from Bitburner's code on February 10, 2022. (https://github.com/danielyxie/bitburner/blob/dev/src/Corporation/Industry.ts) with startupCost added manually.
/** @type {Industry[]} */
const industries = [
    Industry.fromObject({ name: 'Agriculture', reFac: 0.72, sciFac: 0.5, hwFac: 0.2, robFac: 0.3, aiFac: 0.3, advFac: 0.04, reqMats: { Water: 0.5, Chemicals: 0.2 }, prodMats: ['Plants', 'Food'], startupCost: 40e9 }),
    Industry.fromObject({ name: 'Refinery', reFac: 0.3, sciFac: 0.5, hwFac: 0.5, robFac: 0.4, aiFac: 0.3, advFac: 0.04, reqMats: { Ore: 1 }, prodMats: ['Metal'], startupCost: 50e9 }),
    Industry.fromObject({ name: 'Chemical', reFac: 0.25, sciFac: 0.75, hwFac: 0.2, robFac: 0.25, aiFac: 0.2, advFac: 0.07, reqMats: { Plants: 1, Water: 0.5 }, prodMats: ['Chemicals'], startupCost: 70e9 }),
    Industry.fromObject({ name: 'Fishing', reFac: 0.15, sciFac: 0.35, hwFac: 0.35, robFac: 0.5, aiFac: 0.2, advFac: 0.08, reqMats: { Plants: 0.5 }, prodMats: ['Food'], startupCost: 80e9 }),
    Industry.fromObject({ name: 'Water Utilities', reFac: 0.5, sciFac: 0.6, robFac: 0.4, aiFac: 0.4, advFac: 0.08, reqMats: { Hardware: 0.1 }, prodMats: ['Water'], startupCost: 150e9 }),
    Industry.fromObject({ name: 'Mining', reFac: 0.3, sciFac: 0.26, hwFac: 0.4, robFac: 0.45, aiFac: 0.45, advFac: 0.06, reqMats: { Hardware: 0.1 }, prodMats: ['Ore', 'Minerals'], startupCost: 300e9 }),
    //reFac is unique for 'Food' bc it diminishes greatly per city. Handle this separately in code?
    Industry.fromObject({ name: 'Restaurant', sciFac: 0.12, hwFac: 0.15, robFac: 0.3, aiFac: 0.25, advFac: 0.25, reFac: 0.05, reqMats: { Food: 0.5, Water: 0.5 }, makesProducts: true, startupCost: 10e9 }),
    Industry.fromObject({ name: 'Tobacco', reFac: 0.15, sciFac: 0.75, hwFac: 0.15, robFac: 0.2, aiFac: 0.15, advFac: 0.2, reqMats: { Plants: 1 }, makesProducts: true, startupCost: 20e9 }),
    Industry.fromObject({ name: 'Software', sciFac: 0.62, advFac: 0.16, hwFac: 0.25, reFac: 0.15, aiFac: 0.18, robFac: 0.05, reqMats: { Hardware: 0.5 }, prodMats: ['AI Cores'], makesProducts: true, startupCost: 25e9 }),
    Industry.fromObject({ name: 'Pharmaceutical', reFac: 0.05, sciFac: 0.8, hwFac: 0.15, robFac: 0.25, aiFac: 0.2, advFac: 0.16, reqMats: { Chemicals: 2, Water: 0.5 }, prodMats: ['Drugs'], makesProducts: true, startupCost: 200e9 }),
    Industry.fromObject({ name: 'Computer Hardware', reFac: 0.2, sciFac: 0.62, robFac: 0.36, aiFac: 0.19, advFac: 0.17, reqMats: { Metal: 2 }, prodMats: ['Hardware'], makesProducts: true, startupCost: 500e9 }),
    Industry.fromObject({ name: 'Real Estate', robFac: 0.6, aiFac: 0.6, advFac: 0.25, sciFac: 0.05, hwFac: 0.05, reqMats: { Metal: 5, Plants: 1, Water: 2, Hardware: 4 }, prodMats: ['Real Estate'], makesProducts: true, startupCost: 600e9 }),
    Industry.fromObject({ name: 'Healthcare', reFac: 0.1, sciFac: 0.75, advFac: 0.11, hwFac: 0.1, robFac: 0.1, aiFac: 0.1, reqMats: { Robots: 10, 'AI Cores': 5, Drugs: 5, Food: 5 }, makesProducts: true, startupCost: 750e9 }),
    Industry.fromObject({ name: 'Robotics', reFac: 0.32, sciFac: 0.65, aiFac: 0.36, advFac: 0.18, hwFac: 0.19, reqMats: { Hardware: 5, 'AI Cores': 3 }, prodMats: ['Robots'], makesProducts: true, startupCost: 1e12 }),
];

// Global state
let dictSourceFiles;
/** @type {CorporationInfo} */
let myCorporation;
let options;
let verbose;
let raisingCapital = 0; // Used to flag that we are trying to raise private funding
let extraReserve = 0; // Used when we're saving to fund a new product.
let fillSpaceQueue = []; // Flag these offices as needing workers assigned to roles.
let lateGameGrowthLimited = false;
let currentNode = 1;
let loggedMessages = new Set();

function getCorpDivisions(ns) {
    return myCorporation.divisions.map((division) => (typeof division === 'string' ? ns.corporation.getDivision(division) : division));
}

function getCorporationDivisionLimit() {
    const multiplier = corporationDivisionMultipliers[currentNode - 1] ?? 1;
    return Math.max(0, Math.floor(20 * multiplier));
}

function getDesiredDivisionCount() {
    return Math.min(industries.length, getCorporationDivisionLimit());
}

function getExistingIndustryNames(ns) {
    return new Set(getCorpDivisions(ns).map((division) => getDivisionIndustryName(division)));
}

function corporationHasDivision(ns, divisionName) {
    try {
        ns.corporation.getDivision(divisionName);
        return true;
    } catch {
        return false;
    }
}

function getDivisionIndustryName(division) {
    const industryName = division.industry;
    return industryAliases[industryName] || industryName;
}

function getProductNamePrefix(division) {
    return getDivisionIndustryName(division).replace(/[^A-Za-z0-9]/g, '');
}

function getIndustry(division) {
    const industryName = getDivisionIndustryName(division);
    const industry = industries.find((industry) => industry.name === industryName);
    if (!industry) throw new Error(`Unsupported corporation industry "${industryName}" for division "${division.name}".`);
    return industry;
}

function getDivisionResearch(division) {
    return division.researchPoints;
}

function getDivisionProductionMult(division) {
    return division.productionMult;
}

function getDivisionProfit(division) {
    return Math.max(0, (division.lastCycleRevenue || 0) - (division.lastCycleExpenses || 0));
}

function getCorpState(corporation = myCorporation) {
    return corporation.nextState;
}

function getDivisionProductCity(division) {
    return division.cities.includes(hqCity) ? hqCity : division.cities[0];
}

function hasUnlock(ns, unlockName) {
    return ns.corporation.hasUnlock(unlockName);
}

function getUnlockCost(ns, unlockName) {
    return ns.corporation.getUnlockCost(unlockName);
}

function purchaseUnlock(ns, unlockName) {
    return ns.corporation.purchaseUnlock(unlockName);
}

function getCorpConstants(ns) {
    return ns.corporation.getConstants();
}

function getProduct(ns, divisionName, productName, city = hqCity) {
    return ns.corporation.getProduct(divisionName, city, productName);
}

function tryGetProduct(ns, divisionName, productName, city = hqCity) {
    try {
        return getProduct(ns, divisionName, productName, city);
    } catch (err) {
        logOnce(ns, `WARNING: Skipping unreadable product '${divisionName}/${productName}' in ${city}: ${err}`);
        return null;
    }
}

function getProductCityStats(ns, divisionName, productName, city) {
    const product = tryGetProduct(ns, divisionName, productName, city);
    if (!product) return { product: null, qty: 0, produced: 0, sold: 0 };
    return {
        product,
        qty: product.stored,
        produced: product.productionAmount,
        sold: product.actualSellAmount,
        desiredSellPrice: product.desiredSellPrice,
    };
}

export function autocomplete(data, _) {
    data.flags(argsSchema);
    return [];
}

/** @param {NS} ns **/
export async function main(ns) {
    // Pull in any information we only need at startup.
    await ns.write(historyLogFile, '', 'w');
    log(ns, `corporation.js version ${version}`);
    options = ns.flags(argsSchema);
    verbose = options.verbose;
    if (!options['no-tail-windows'])
        ns.ui.openTail(ns.pid);
    dictSourceFiles = await getActiveSourceFiles(ns);
    currentNode = ns.getResetInfo().currentNode;
    const sf3Level = dictSourceFiles[3] || 0;
    let runOnce = options.once;
    let shouldManage = !options['price-discovery-only'];
    const loopInterval = Math.max(0, Number(options.interval) || 0);

    // If we haven't unlocked corporations, just give up now.
    if (sf3Level <= 0 && currentNode !== 3) {
        log(ns, `ERROR: Corporation API is unavailable. Current BN${currentNode}, SF3.${sf3Level}. Exiting.`, undefined, true);
        ns.exit();
    }

    // See if we've already created a corporation.
    myCorporation = tryGetCorporation(ns);
    let hasCorporation = !!myCorporation;
    log(ns, `Corporation startup: BN${currentNode}, SF3.${sf3Level}, hasCorporation=${hasCorporation}.`);
    // In BN3 itself, creating a seed-funded corporation grants Warehouse and Office APIs.
    // Outside BN3, we need SF3.3 for the same bootstrap path.
    if ((currentNode === 3 || dictSourceFiles[3] >= 3) && !hasCorporation) {
        await doInitialCorporateSetup(ns);
        myCorporation = tryGetCorporation(ns);
        hasCorporation = !!myCorporation;
        if (!hasCorporation) {
            log(ns, `ERROR: Corporation bootstrap finished but no corporation exists. ` +
                `Current BN${currentNode}, SF3.${sf3Level}. Aborting before management loop.`, undefined, true);
            ns.exit();
        }
    } else if (dictSourceFiles[3] < 3 && !hasCorporation) {
        log(ns, `Missing SF3.3 and no existing corporation. Current BN${currentNode}, SF3.${sf3Level}.`, undefined, true);
        log(ns, `You must found the corporation manually, or wait until BN3/SF3.3 before this script can bootstrap it.`, undefined, true);
        ns.exit();
    }

    // If we already have a corporation, make sure we didn't leave any workers waiting for assignment.
    if (hasCorporation) {
        for (const division of getCorpDivisions(ns)) {
            for (const city of division.cities) {
                fillSpaceQueue.push(`${division.name}/${city}`);
            }
        }
    }

    // We've set up the initial corporation, now run it over time.
    while (true) {
        // Do all our spending and expanding.
        if (shouldManage) await doManageCorporation(ns);

        // Try to manage sale prices for products.
        await doPriceDiscovery(ns);

        // While we wait for the next tick, process any open office positions
        await fillOpenPositionsFromQueue(ns);

        if (runOnce) {
            log(ns, 'Ran once through the corporation loop. Exiting.');
            ns.exit();
        }

        if (loopInterval > 0) {
            if (verbose) log(ns, `Sleeping ${ns.format.time(loopInterval)} before next corporation loop.`);
            await ns.sleep(loopInterval);
        } else {
            // Sleep until the next time we go into the 'START' phase
            await sleepWhileNotInStartState(ns, true);
        }

        if (verbose) log(ns, ``);
    }
}

function tryGetCorporation(ns) {
    try {
        return ns.corporation.getCorporation();
    } catch {
        return null;
    }
}

/**
 * This function is called in our main loop. Assess the current state of the corporation, and improve it as best we can.
 * @param {NS} ns
 **/
async function doManageCorporation(ns) {
    // Assess the current state of the corporation, and figure out our budget.
    myCorporation = ns.corporation.getCorporation();
    let netIncome = myCorporation.revenue - myCorporation.expenses;
    let now = new Date().toLocaleString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });

    if (verbose) log(ns, `----- [ ${myCorporation.name} Quarterly Report ${now} ] -----`);
    log(ns, `Corporate cash on hand: ${mf(myCorporation.funds)} (Gross: ${mf(myCorporation.revenue)}/s, Net: ${mf(netIncome)}/s)`);

    // Before the product division exists, spend only enough hashes to automate energy and morale.
    // Saving every hash for two divisions can otherwise strand an unhealthy first division indefinitely.
    if (options['can-spend-hashes'] && myCorporation.divisions.length < initialProductDivisionCount)
        bootstrapEmployeeAutomationWithHashes(ns);
    myCorporation = ns.corporation.getCorporation();

    if (extraReserve > 0 && corporationHasDevelopmentBacklog(ns)) {
        log(ns, `Clearing product reserve ${mf(extraReserve)} while existing divisions still need city, warehouse, or office catch-up.`);
        extraReserve = 0;
    }

    // Morale and energy directly multiply employee productivity. Restore them before discretionary spending,
    // otherwise an unhealthy corporation can stay unprofitable and never qualify for its next funding round.
    const wellnessBudget = Math.max(0, myCorporation.funds - options['reserve-amount'] - extraReserve);
    const wellnessSpent = maintainEmployeeWellness(ns, wellnessBudget);
    if (wellnessSpent > 0) myCorporation = ns.corporation.getCorporation();

    // See if we can raise more money.
    await tryRaiseCapital(ns);

    myCorporation = ns.corporation.getCorporation();
    let budget = myCorporation.funds - options['reserve-amount'] - extraReserve;
    // Past this point the game can slow down if we keep growing every office forever.
    // Keep a real budget so existing divisions can still catch up in every city, but
    // gate unbounded office growth inside doManageDivision().
    lateGameGrowthLimited = myCorporation.revenue > revenueGrowthSoftcap;
    budget = Math.max(0, budget);
    if (verbose) log(ns, ``);
    if (verbose) log(ns, `Working with a corporate budget of ${mf(budget)}`);
    if (verbose && lateGameGrowthLimited)
        log(ns, `Late-game growth limit active: catching up underdeveloped city offices without unbounded office growth.`);

    // Let's figure out all of the things we'd like to do, before we commit to anything.
    let tasks = [];
    /**
     * What sort of corporation-wide stuff would we like to do?
     * Buy Unlocks? Buy upgrades?
     */
    let availableUnlocks = [],
        purchasedUnlocks = [];
    for (const unlockable of unlocks) {
        if (hasUnlock(ns, unlockable)) purchasedUnlocks.push(unlockable);
        else availableUnlocks.push(unlockable);
    }
    for (const unlockable of availableUnlocks) {
        let cost = getUnlockCost(ns, unlockable);
        if (cost > budget) continue;
        // If we can afford it, and we don't have it yet, consider buying it.
        let shouldBuy = false;
        if (unlockable === 'Smart Supply' && cost < budget * 0.8) {
            // Push this one to the top of the list. Doing it in code is annoying.
            tasks.push(new Task('Unlock ' + unlockable, () => purchaseUnlock(ns, unlockable), cost, 110));
        }
        // Unlocks that have a strong long‑term ROI should be bought more aggressively.
        // The original thresholds were very conservative (25 % of the remaining budget for
        // Warehouse / Office API). Empirical testing shows that early investment in these
        // APIs yields higher profit per RAM spent, because they unlock bulk material buying
        // and automated staffing. We therefore raise the threshold to 50 % of the budget.
        else if (unlockable === 'Warehouse API' && cost < budget * 0.5) shouldBuy = true;
        else if (unlockable === 'Office API' && cost < budget * 0.5) shouldBuy = true;
        // Shady Accounting and Government Partnership are still valuable, keep the original
        // 50 % threshold but give them a modest priority boost later.
        else if (unlockable === 'Shady Accounting' && cost < budget * 0.5) shouldBuy = true;
        else if (unlockable === 'Government Partnership' && cost < budget * 0.5) shouldBuy = true;
        // Export was previously commented out – it expands market reach and improves sales
        // margins for all divisions. It is relatively cheap, so we enable it when it costs
        // less than 10 % of the current budget.
        else if (unlockable === 'Export' && cost < budget * 0.1) shouldBuy = true;

        // Put the task on our to-do list. Put all unlocks at priority 0 as "nice-to-haves".
        if (shouldBuy) tasks.push(new Task('Unlock ' + unlockable, () => purchaseUnlock(ns, unlockable), cost, 0));
    }

    let hasProductionDivision = false;
    for (const division of getCorpDivisions(ns)) {
        let industry = getIndustry(division);
        if (industry.makesProducts) hasProductionDivision = true;
    }
    // Can we afford to level any upgrades?
    for (const upgrade of upgrades) {
        let cost = ns.corporation.getUpgradeLevelCost(upgrade);
        let nextLevel = ns.corporation.getUpgradeLevel(upgrade) + 1;
        if (cost > budget) continue;
        if (upgrade === 'Wilson Analytics' && cost < budget * 0.9 && hasProductionDivision) {
            // Analytics fuels advertising, which drives up the price of products, which generates profits.
            // Scale the priority based on how cheap this is (cheaper is higher priority [0-100]).
            let priority = Math.round((1 - cost / budget) * 100);
            tasks.push(new Task(`Upgrading '${upgrade}' to level ${nextLevel}`, () => ns.corporation.levelUpgrade(upgrade), cost, priority));
        } else if (['Smart Factories', 'Smart Storage'].includes(upgrade) && cost < budget * 0.1) {
            // More storage means more materials, which drives more production. More production means more sales.
            tasks.push(new Task(`Upgrading '${upgrade}' to level ${nextLevel}`, () => ns.corporation.levelUpgrade(upgrade), cost, 10));
        } else if (cost < budget * 0.01) {
            // Upgrade other stuff too, as long as it's cheap compared to our budget.
            tasks.push(new Task(`Upgrading '${upgrade}' to level ${nextLevel}`, () => ns.corporation.levelUpgrade(upgrade), cost, 1));
        }
    }

    if (options['can-sell-divisions']) {
        const soldDivisionValue = trySellWeakDivisionForBetterIndustry(ns, budget);
        if (soldDivisionValue > 0) {
            myCorporation = ns.corporation.getCorporation();
            budget = Math.max(0, myCorporation.funds - options['reserve-amount'] - extraReserve);
        }
    }

    // ---------------------------------------------------------------------
    // Expansion of existing divisions – prioritize long‑term profit.
    // ---------------------------------------------------------------------
    // For each division we already own, evaluate missing cities.  Expanding
    // to a new city costs the same amount (officeInitialCost) regardless of
    // division, but the profit impact varies.  We approximate long‑term profit
    // by the division's current revenue – divisions that already generate
    // more money are likely to benefit most from a new market.
    //
    // We create tasks for each affordable city expansion, giving a higher
    // priority to divisions with larger revenue.  The priority is scaled to the
    // proportion of the division's revenue relative to the highest‑earning
    // division, then multiplied by 100 (so priority is in the range 0‑100).
    // This keeps the existing task ordering logic intact while ensuring that
    // expansion decisions are driven by long‑term profit potential.
    const divisionRevenues = getCorpDivisions(ns).map(d => d.revenue || 0);
    const maxRevenue = Math.max(...divisionRevenues, 1); // avoid division by zero
    const expansionCost = getCorpConstants(ns).officeInitialCost;

    for (const division of getCorpDivisions(ns)) {
        // Determine which cities we don't have yet.
        const missing = cities.filter(city => !division.cities.includes(city));
        if (!missing.length) continue;
        // Only consider expansion if we can afford at least one city.  The
        // threshold is more generous than the per‑division heuristic earlier –
        // we allow up to 40 % of the remaining budget for a single city if it
        // promises high profit.
        if (expansionCost > budget * 0.4) continue;
        // Compute a priority based on revenue share.
        const revenueShare = (division.revenue || 0) / maxRevenue;
        const basePriority = Math.round(revenueShare * 100);
        // Create a task for each missing city (usually only a few).
        for (const city of missing) {
            tasks.push(new Task(
                `Expand ${division.name} to ${city}`,
                () => doExpandCity(ns, division.name, city),
                expansionCost,
                basePriority + 50 // boost above generic upgrades
            ));
        }
    }
    /**
     * Let's take a look at our divisions for big problems. Do we need to expand to a new industry? Are any
     * of our existing industries showing a loss? What else might we need to consider here? We'll be looking
     * at every division at the end of the loop to do maintence, so this is just high level stuff.
     */
    if (myCorporation.divisions.length === 0) {
        // We definitely need a new division!
        // Use up to 80% of our budget to start this first division.
        let newDivisionBudget = budget * 0.9;
        // Just consider the basic materials-producing industries for our first division. Products take a long time to come online.
        let possibleIndustries = industries.filter((ind) => !ind.makesProducts);
        // And only the ones where we'll be able to spend at least half our budget setting up shop.
        possibleIndustries = possibleIndustries.filter((ind) => ind.startupCost < newDivisionBudget * 0.5);
        possibleIndustries.sort((a, b) => getStartupIndustryRank(a.name) - getStartupIndustryRank(b.name) || a.startupCost - b.startupCost);
        let firstIndustry = industryAliases[options['first']] || options['first'];
        let newIndustry = possibleIndustries.find((ind) => ind.name === firstIndustry) || possibleIndustries[0];
        if (newIndustry) {
            tasks.push(new Task(`Add the first division, '${newIndustry.name}'`, () => doCreateNewDivision(ns, newIndustry, newDivisionBudget), newDivisionBudget, 120));
        } else {
            // If we can't afford to create our first industry, something has gone very wrong. Quit now.
            log(ns, `ERROR: Could not afford to create our first industry!`, 'error', 'true');
            ns.exit();
        }
    }
    // Expand into every industry we can afford, cheapest first. Earlier versions gated this
    // behind product-division funding readiness, which made later material divisions look stuck.
    let offer = ns.corporation.getInvestmentOffer();
    const readyForProductDivision = isReadyForProductDivision(myCorporation, offer);
    const desiredDivisionCount = getDesiredDivisionCount();
    if (!options['no-expansion'] && myCorporation.divisions.length > 0 && myCorporation.divisions.length >= desiredDivisionCount) {
        logOnce(ns, `INFO: Corporation division limit reached in BN${currentNode}: ` +
            `${myCorporation.divisions.length}/${desiredDivisionCount}. Skipping new industry expansion.`);
    }
    if (!options['no-expansion'] && myCorporation.divisions.length > 0 && myCorporation.divisions.length < desiredDivisionCount) {
        let newDivisionBudget = budget * 0.9;
        const existingIndustryNames = getExistingIndustryNames(ns);
        let possibleIndustries = industries.filter((ind) => !existingIndustryNames.has(ind.name));
        if (!readyForProductDivision)
            possibleIndustries = possibleIndustries.filter((ind) => !ind.makesProducts);
        // Keep enough money after product-industry expansion to start its first product immediately.
        possibleIndustries = possibleIndustries.filter((ind) => ind.startupCost + (ind.makesProducts ? minimumProductInvestment : 0) <= newDivisionBudget);
        possibleIndustries.sort((a, b) => getIndustryPreferenceRank(a.name) - getIndustryPreferenceRank(b.name) || a.startupCost - b.startupCost);
        if (verbose && possibleIndustries.length) {
            log(ns, `We would like to expand into a new industry. Possibilities:`);
            for (const industry of possibleIndustries) {
                log(ns, `  ${mf(industry.startupCost)} - ${industry.name}`);
            }
        } else if (verbose) log(ns, `INFO: We would like to create a new division but none are currently eligible. Willing to spend ${mf(budget)}.`);

        const newIndustry = possibleIndustries[0];
        if (newIndustry) {
            tasks.push(new Task(`Add cheapest available division, '${newIndustry.name}'`, () => doCreateNewDivision(ns, newIndustry, newDivisionBudget), newDivisionBudget, 100));
        } else {
            const targetIndustry = industries.filter((ind) => !existingIndustryNames.has(ind.name)).sort((a, b) => getIndustryPreferenceRank(a.name) - getIndustryPreferenceRank(b.name) || a.startupCost - b.startupCost)[0];
            if (targetIndustry) log(ns, `INFO: Waiting to afford the next cheapest division '${targetIndustry.name}' ` +
                `at ${mf(targetIndustry.startupCost + (targetIndustry.makesProducts ? minimumProductInvestment : 0))} including its first product if needed; ` +
                `expansion budget is ${mf(newDivisionBudget)}.`);
        }
    }

    // If we have all of our divisions bought, it's worth spending hashes on research.
    if (myCorporation.divisions.length >= initialProductDivisionCount) {
        if (options['can-spend-hashes'])
            await doSpendHashes(ns, 'Exchange for Corporation Research');
    }

    /**
     * We've looked at the at the corporation, and come up with a list of tasks we'd like to do. Now, figure out
     * which ones we can actually accomplish on our budget.
     */
    tasks.sort((a, b) => a.cost - b.cost).reverse();
    tasks.sort((a, b) => a.priority - b.priority).reverse();
    /**
     * Finally, run each task in priority order. If we run out of money, should we buy lower priority stuff, or
     * wait? If we wait, the money might get spent expanding a division instead. This may all take some
     * adjustments over time.
     */
    let spent = await runTasks(ns, tasks, budget);
    if (spent) budget -= spent;
    if (spent > 0 && verbose) log(ns, `Spent ${mf(spent)} of our budget of ${mf(budget)}.`);

    /**
     * Even though we've done all of our desired high level tasks, we still need to tend to each division individually.
     * If we don't have all the automation bits, we may need to adjust pricing. If we have room in warehouses, we can buy
     * more materials. If we have products, we may be able to start on a new product. We may have research to spend.
     */
    const divisionsToManage = getCorpDivisions(ns)
        .sort((a, b) => getDivisionManagementPriority(ns, b) - getDivisionManagementPriority(ns, a));
    for (const division of divisionsToManage) {
        // If we have multiple divisions, hold the lion's share of the budget for production industries.
        let industry = getIndustry(division);
        let divisionalBudget = budget;
        if (myCorporation.divisions.length > 1 && !industry.makesProducts) {
            divisionalBudget *= 0.05;
        }
        let spent = await doManageDivision(ns, division, divisionalBudget);
        if (spent) budget -= spent;
    }
}

function getDivisionManagementPriority(ns, division) {
    const industry = getIndustry(division);
    const revenue = division.lastCycleRevenue || division.revenue || 0;
    if (industry.makesProducts && revenue <= 0) return 300;
    if (industry.makesProducts && division.products.length === 0) return 280;
    if (!hasUnlock(ns, 'Office API')) return industry.makesProducts ? 150 : 0;
    if (industry.makesProducts && getOfficeCatchUpCities(ns, division).length > 0) return 220;
    if (getOfficeCatchUpCities(ns, division).length > 0) return 120;
    return Math.min(100, Math.log10(Math.max(1, revenue)));
}

/**
 * Try to raise money.
 * Advances through the funding rounds, eventually going public. Potentially spends hacknet hashes for money.
 * @param {NS} ns
 */
async function tryRaiseCapital(ns) {
    // First, spend hacknet hashes.
    if (options['can-spend-hashes'] && myCorporation.funds < 10e9) 
        await doSpendHashes(ns, 'Sell for Corporation Funds');
    // If we're not public, then raise private funding.
    if (!myCorporation.public) {
        let offer = ns.corporation.getInvestmentOffer();
        // If we've finished round 4, clear our raising capital flag.
        if (offer.round > 4) raisingCapital = 0;
        let willAccept = true;
        if (offer && offer.round <= 4) {
            log(ns, `Considering raising private capital round ${offer.round}. Offered ${mf(offer.funds)} for ${nf(offer.shares)} shares.`);

            // Make sure all employees are happy.
            let satisfied = allEmployeesSatisfied(ns);
            if (!satisfied) {
                let prefix = '    *';
                if (!willAccept) prefix = '     ';
                log(ns, `${prefix}  Round ${offer.round} financing waiting on employee stats to stabilize.`);
                willAccept = false;
            }

            // Make sure we have filled a reasonable amount of our warehouses with materials.
            for (const division of getCorpDivisions(ns)) {
                let industry = getIndustry(division);
                for (const city of division.cities) {
                    if (!ns.corporation.hasWarehouse(division.name, city)) {
                        let prefix = '    *';
                        if (!willAccept) prefix = '     ';
                        logOnce(ns, `${prefix}  Round ${offer.round} financing waiting on ${division.name}/${city} warehouse.`);
                        willAccept = false;
                        continue;
                    }
                    let warehouse = ns.corporation.getWarehouse(division.name, city);
                    let warehouseSpaceRequiredForCycle = getReservedWarehouseSpace(ns, industry, division, city);
                    let warehouseSpaceAvailable = warehouse.size - warehouseSpaceRequiredForCycle - warehouse.sizeUsed;
                    if (warehouseSpaceAvailable > warehouseSpaceRequiredForCycle * 0.2) {
                        let prefix = '    *';
                        if (!willAccept) prefix = '     ';
                        log(ns, `${prefix}  Round ${offer.round} financing waiting on ${division.name} warehouses to gain materials.`);
                        willAccept = false;
                        break;
                    }
                }
            }
            // If we have a product division, make sure it has a maximum number of products before we accept the offer.
            for (const division of getCorpDivisions(ns)) {
                const maxProducts = getMaxProducts(ns, division.name);
                let industry = getIndustry(division);
                if (industry.makesProducts && division.products.length < maxProducts) {
                    let prefix = '    *';
                    if (!willAccept) prefix = '     ';
                    log(ns, `${prefix}  Round ${offer.round} financing waiting on ${division.name} division to create products (${division.products.length}/${maxProducts})`);
                    willAccept = false;
                }
                if (offer.round >= 4 && industry.makesProducts) {
                    // Wait for the last product to finish researching
                    let completeProducts = division.products
                        .map((prodName) => tryGetProduct(ns, division.name, prodName, getDivisionProductCity(division)))
                        .filter((prod) => prod && prod.developmentProgress >= 100);
                    if (completeProducts.length < maxProducts) {
                        let prefix = '    *';
                        if (!willAccept) prefix = '     ';
                        log(ns, `${prefix}  Round ${offer.round} financing waiting on ${division.name} division to complete products (${completeProducts.length}/${maxProducts})`);
                        willAccept = false;
                    }
                }
            }
            // TODO: Funding is proportional to revenue. We can cook the books so that revenue looks higher than it should by stockpiling goods, then selling them all at once.

            // Make sure we aren't spending money on materials when we get funding. Each time we come through the loop and would purchase, increment the counter. After 4 times, purchase.
            if (willAccept) raisingCapital++;
            else raisingCapital = 0;

            // If we've passed all the checks, then accept the next round of funding.
            if (options['can-accept-funding'] && raisingCapital > 4 && !options.mock) {
                let success = ns.corporation.acceptInvestmentOffer();
                raisingCapital = 0;
                if (success) log(ns, `WARNING: Accepted round ${offer.round} funding. Took ${mf(offer.funds)} for ${nf(offer.shares)} shares.`);
                else log(ns, `ERROR: Tried to accept round ${offer.round} funding, but something went wrong.`);
            } else if (options['can-accept-funding'] && raisingCapital > 0) {
                log(ns, `SUCCESS: Raising capital in ${5 - raisingCapital} cycles.`);
            }
        } else {
            // We're public, so we can't be raising capital.
            raisingCapital = 0;
        }
        // Finally, if we're out of private funding, we may as well go public
        offer = ns.corporation.getInvestmentOffer();
        if (options['can-go-public'] && !options.mock && offer.round > 4) {
            // Looks like we're out of private funding. Time to go public.
            log(ns, `SUCCESS: Private funding complete. Time to IPO. Selling ${options['issue-shares']} shares.`);
            ns.corporation.goPublic(options['issue-shares']);
            // and set our dividend to 10%
            ns.corporation.issueDividends(0.1);
        }
    } else {
        // We're public, so we can't be raising capital.
        raisingCapital = 0;
        const issuedFunds = tryIssueNewSharesForGrowth(ns);
        if (issuedFunds > 0) myCorporation = ns.corporation.getCorporation();
        tryBuyBackShares(ns);
    }
}

function tryIssueNewSharesForGrowth(ns) {
    if (!options['can-issue-new-shares']) return 0;
    if (!myCorporation.public) return 0;
    if ((myCorporation.issueNewSharesCooldown || 0) > 0) {
        if (verbose)
            logOnce(ns, `INFO: Issue New Shares is on cooldown for ${nf(myCorporation.issueNewSharesCooldown)} game cycles.`);
        return 0;
    }
    if (!Number.isFinite(myCorporation.sharePrice) || myCorporation.sharePrice <= 0) return 0;

    const availableBudget = Math.max(0, myCorporation.funds - options['reserve-amount'] - extraReserve);
    const developmentNeed = estimateDevelopmentFundingNeed(ns);
    if (developmentNeed <= availableBudget) return 0;

    const fundingGap = developmentNeed - availableBudget;
    const amount = getNewShareIssueAmount(myCorporation, fundingGap, options['issue-new-shares-min-ownership']);
    if (amount <= 0) {
        logOnce(ns, `INFO: Skipping Issue New Shares: funding gap ${mf(fundingGap)}, ` +
            `ownership ${(myCorporation.numShares / myCorporation.totalShares * 100).toFixed(1)}%, ` +
            `min ${(options['issue-new-shares-min-ownership'] * 100).toFixed(1)}%.`);
        return 0;
    }

    try {
        const raised = ns.corporation.issueNewShares(amount);
        log(ns, `SUCCESS: Issued ${nf(amount)} new shares for ${mf(raised)} to fund corporation growth.`, 'success', true);
        return raised;
    } catch (e) {
        logOnce(ns, `WARNING: Failed to issue new shares: ${e}`);
        return 0;
    }
}

function tryBuyBackShares(ns) {
    if (!options['can-buy-back-shares']) return 0;
    if (!myCorporation.public) return 0;
    if (!Number.isFinite(myCorporation.sharePrice) || myCorporation.sharePrice <= 0) return 0;
    if ((myCorporation.issuedShares || 0) <= 0) return 0;

    const targetOwnership = clamp(Number(options['buyback-shares-target-ownership']), 0, 1);
    const currentOwnership = myCorporation.numShares / myCorporation.totalShares;
    if (!Number.isFinite(targetOwnership) || targetOwnership <= 0 || currentOwnership >= targetOwnership) return 0;

    const playerMoney = ns.getPlayer().money;
    const budgetFraction = clamp(Number(options['buyback-shares-budget-fraction']), 0, 1);
    const playerBudget = playerMoney * budgetFraction;
    if (!Number.isFinite(playerBudget) || playerBudget <= 0) return 0;

    const amount = getShareBuybackAmount(myCorporation, targetOwnership, playerBudget);
    if (amount <= 0) {
        if (verbose)
            logOnce(ns, `INFO: Skipping Buyback Shares: ownership ${(currentOwnership * 100).toFixed(1)}%, ` +
                `target ${(targetOwnership * 100).toFixed(1)}%, player budget ${mf(playerBudget)}.`);
        return 0;
    }

    const estimatedCost = estimateShareBuybackCost(myCorporation, amount);
    try {
        if (ns.corporation.buyBackShares(amount)) {
            log(ns, `SUCCESS: Bought back ${nf(amount)} shares for about ${mf(estimatedCost)}. ` +
                `Ownership ${(currentOwnership * 100).toFixed(1)}% -> ${((myCorporation.numShares + amount) / myCorporation.totalShares * 100).toFixed(1)}%.`, 'success', true);
            return estimatedCost;
        }
    } catch (e) {
        logOnce(ns, `WARNING: Failed to buy back shares: ${e}`);
    }
    return 0;
}

function estimateDevelopmentFundingNeed(ns) {
    let need = 0;
    const desiredDivisionCount = getDesiredDivisionCount();
    const existingIndustryNames = getExistingIndustryNames(ns);
    const missingIndustries = industries.filter((ind) => !existingIndustryNames.has(ind.name));
    missingIndustries.sort((a, b) => a.startupCost - b.startupCost);
    const missingDivisionSlots = Math.max(0, desiredDivisionCount - myCorporation.divisions.length);
    for (const industry of missingIndustries.slice(0, missingDivisionSlots))
        need += industry.startupCost + (industry.makesProducts ? minimumProductInvestment : 0);

    for (const division of getCorpDivisions(ns)) {
        for (const city of cities) {
            if (!division.cities.includes(city)) {
                need += getCorpConstants(ns).officeInitialCost;
                need += getCorpConstants(ns).warehouseInitialCost;
                continue;
            }
            if (!ns.corporation.hasWarehouse(division.name, city))
                need += getCorpConstants(ns).warehouseInitialCost;
            const office = ns.corporation.getOffice(division.name, city);
            const catchUpOfficeSize = getDivisionCatchUpOfficeSize(ns, division);
            const seats = Math.min(15, office.size, Math.max(0, catchUpOfficeSize - office.size));
            if (seats > 0)
                need += ns.corporation.getOfficeSizeUpgradeCost(division.name, city, seats);
            if (ns.corporation.hasWarehouse(division.name, city)) {
                const warehouse = ns.corporation.getWarehouse(division.name, city);
                if (warehouse.sizeUsed / warehouse.size > 0.85)
                    need += ns.corporation.getUpgradeWarehouseCost(division.name, city);
            }
        }
    }
    return need;
}

function trySellWeakDivisionForBetterIndustry(ns, budget) {
    if (options['no-expansion']) return 0;
    const desiredDivisionCount = getDesiredDivisionCount();
    if (myCorporation.divisions.length < desiredDivisionCount) return 0;
    if (myCorporation.divisions.length <= 1) return 0;

    const offer = ns.corporation.getInvestmentOffer();
    const readyForProductDivision = isReadyForProductDivision(myCorporation, offer);
    const existingIndustryNames = getExistingIndustryNames(ns);
    const missingIndustries = industries
        .filter((industry) => !existingIndustryNames.has(industry.name))
        .filter((industry) => readyForProductDivision || !industry.makesProducts)
        .sort((a, b) => getIndustryPreferenceRank(a.name) - getIndustryPreferenceRank(b.name) || a.startupCost - b.startupCost);
    if (missingIndustries.length === 0) return 0;

    const ownedDivisions = getCorpDivisions(ns)
        .map((division) => ({
            division,
            industry: getIndustry(division),
            rank: getIndustryPreferenceRank(getDivisionIndustryName(division)),
            profit: getDivisionProfit(division),
            saleValue: estimateDivisionSaleValue(ns, division),
        }))
        .filter((entry) => entry.rank >= desiredDivisionCount)
        .filter((entry) => isDivisionSafeToSell(ns, entry.division, entry.industry, entry.profit))
        .sort((a, b) => b.rank - a.rank || a.profit - b.profit);
    if (ownedDivisions.length === 0) {
        logOnce(ns, `INFO: Division selling enabled, but no undeveloped weak division is safe to sell.`);
        return 0;
    }

    for (const replacement of missingIndustries) {
        const replacementRank = getIndustryPreferenceRank(replacement.name);
        for (const saleCandidate of ownedDivisions) {
            if (replacementRank >= saleCandidate.rank) continue;
            const replacementCost = replacement.startupCost + (replacement.makesProducts ? minimumProductInvestment : 0);
            if (replacementCost > (budget + saleCandidate.saleValue) * 0.9) continue;
            try {
                ns.corporation.sellDivision(saleCandidate.division.name);
                fillSpaceQueue = fillSpaceQueue.filter((office) => !office.startsWith(`${saleCandidate.division.name}/`));
                log(ns, `SUCCESS: Sold weak division '${saleCandidate.division.name}' (${saleCandidate.industry.name}) ` +
                    `for about ${mf(saleCandidate.saleValue)} to free a slot for '${replacement.name}'.`, 'success', true);
                return saleCandidate.saleValue;
            } catch (e) {
                logOnce(ns, `WARNING: Failed to sell division '${saleCandidate.division.name}': ${e}`);
                return 0;
            }
        }
    }
    return 0;
}

function getIndustryPreferenceRank(industryName) {
    const rank = preferredIndustryOrder.indexOf(industryName);
    return rank >= 0 ? rank : preferredIndustryOrder.length;
}

function getStartupIndustryRank(industryName) {
    const rank = startupIndustryOrder.indexOf(industryName);
    return rank >= 0 ? rank : startupIndustryOrder.length;
}

function isDivisionSafeToSell(ns, division, industry, profit) {
    if (industry.makesProducts && division.products.length > 0) return false;
    if (getDivisionResearch(division) > 250) return false;
    const corporationProfit = Math.max(0, myCorporation.revenue - myCorporation.expenses);
    if (profit > 0 && profit > corporationProfit * 0.01) return false;

    for (const city of division.cities) {
        const office = ns.corporation.getOffice(division.name, city);
        if (office.size > 30 || office.numEmployees > 30) return false;
        if (ns.corporation.hasWarehouse(division.name, city)) {
            const warehouse = ns.corporation.getWarehouse(division.name, city);
            if (warehouse.size > 500) return false;
        }
    }
    return true;
}

function estimateDivisionSaleValue(ns, division) {
    const industry = getIndustry(division);
    let price = industry.startupCost;
    for (const city of division.cities) {
        if (city === 'Sector-12') continue;
        price += getCorpConstants(ns).officeInitialCost;
        if (ns.corporation.hasWarehouse(division.name, city))
            price += getCorpConstants(ns).warehouseInitialCost;
    }
    return price / 2;
}

function getNewShareIssueAmount(corporation, fundingGap, minOwnership) {
    const shareLotSize = 10e6;
    const maxGameShares = roundSharesDown(corporation.totalShares * 0.2, shareLotSize);
    const maxOwnershipShares = roundSharesDown(corporation.numShares / minOwnership - corporation.totalShares, shareLotSize);
    const maxShares = Math.min(maxGameShares, maxOwnershipShares);
    if (maxShares <= 0) return 0;

    // The game lowers share price during issuance, so use a conservative average proceeds estimate.
    const estimatedProceedsPerShare = corporation.sharePrice * 0.75;
    const neededShares = roundSharesUp(fundingGap / estimatedProceedsPerShare, shareLotSize);
    return Math.min(maxShares, neededShares);
}

function getShareBuybackAmount(corporation, targetOwnership, playerBudget) {
    const neededShares = Math.ceil(Math.max(0, corporation.totalShares * targetOwnership - corporation.numShares));
    const availableShares = Math.floor(Math.max(0, corporation.issuedShares || 0));
    const affordableShares = Math.floor(Math.max(0, playerBudget / estimateShareBuybackCostPerShare(corporation)));
    return Math.min(neededShares, availableShares, affordableShares, 1e14);
}

function estimateShareBuybackCost(corporation, shares) {
    return shares * estimateShareBuybackCostPerShare(corporation);
}

function estimateShareBuybackCostPerShare(corporation) {
    // The game charges a 10% premium and raises price while buying. Keep a small safety margin.
    return corporation.sharePrice * 1.15;
}

function roundSharesDown(shares, lotSize) {
    return Math.floor(Math.max(0, shares) / lotSize) * lotSize;
}

function roundSharesUp(shares, lotSize) {
    return Math.ceil(Math.max(0, shares) / lotSize) * lotSize;
}

function clamp(value, min, max) {
    if (!Number.isFinite(value)) return min;
    return Math.min(max, Math.max(min, value));
}

/**
 * Do all employees have enough happiness, energy, and morale?
 * @param {NS} ns
 * @param {number} lowerLimit - minimum for all stats [0,1]
 * @returns {boolean}
 */
function allEmployeesSatisfied(ns, lowerLimit = 0.9995) {
    let allSatisfied = true;
    for (const division of getCorpDivisions(ns)) {
        for (const city of division.cities) {
            let office = ns.corporation.getOffice(division.name, city);
            if (office.numEmployees === 0) continue;
            if (office.avgEnergy < office.maxEnergy * lowerLimit || office.avgMorale < office.maxMorale * lowerLimit) {
                allSatisfied = false;
                break;
            }
        }
    }
    return allSatisfied;
}

/**
 * Given a list of tasks, execute them in order.
 * @param {NS} ns
 * @param {Task[]} tasks
 * @param {number} budget
 * @param {boolean} keepSpending Should we keep spending money on items further down the list after hitting an item we can't afford?
 * @returns {number} the amount spent.
 */
async function runTasks(ns, tasks, budget, keepSpending = true) {
    const startingBudget = budget;
    for (const task of tasks) {
        let success = false;
        if (budget - task.cost > 0) {
            log(ns, `  Spending ${mf(task.cost)} on ${task.name}`);
            // Some of the ns.corporation calls we use are void functions, so treat a return value of undefined with no exception as a success.
            if (!options.mock)
                try {
                    success = await task.run();
                    if (success == undefined) success = true;
                } catch (e) {
                    log(ns, `WARNING: Failed to execute ${task.name} - ${task.run}`);
                    log(ns, `WARNING: ${e}`);
                }
            if (success) budget -= task.cost;
        }
        if (!success && !keepSpending) break;
    }
    return startingBudget - budget;
}

/** @param {NS} ns **/
async function doInitialCorporateSetup(ns) {
    // No corporation yet, so create one. Try for a publicly funded corporation first (Only works in BN 3).
    if (options.mock) {
        log(ns, `Would like to create a corporation, but cannot because we are in mock mode. Nothing else to do.`);
        ns.exit();
    }
    let created = false;
    try {
        created = ns.corporation.createCorporation(options['corporation-name'], false);
        if (created)
            log(ns, `Founded seed-funded corporation ${options['corporation-name']}!`, 'info', true);
    } catch (err) {
        if (verbose) log(ns, `Seed-funded corporation creation unavailable: ${err}`);
    }
    if (!created) {
        let playerMoney = ns.getPlayer().money;
        let stockValue = await getStocksValue(ns);
        if (playerMoney < 150e9 && playerMoney + stockValue >= 150e9) {
            const pid = ns.run(getFilePath('stockmaster.js'), 1, '--liquidate');
            if (!pid) {
                log(ns, `ERROR: Could not launch stockmaster.js --liquidate to fund corporation. ` +
                    `Need ${mf(150e9)}, cash ${mf(playerMoney)}, stocks ${mf(stockValue)}.`, undefined, true);
                ns.exit();
            }
            log(ns, `Liquidating stocks to found self-funded corporation. Need ${mf(150e9)}, cash ${mf(playerMoney)}, stocks ${mf(stockValue)}.`, 'info', true);
            while (ns.isRunning(pid))
                await ns.sleep(100);
            playerMoney = ns.getPlayer().money;
            stockValue = await getStocksValue(ns);
        }
        if (playerMoney >= 150e9) {
            created = ns.corporation.createCorporation(options['corporation-name'], true);
            if (created)
                log(ns, `Founded self-funded corporation ${options['corporation-name']} for ${mf(150e9)}!`, 'info', true);
        } else {
            log(ns, `No corporation exists and self-funding is not affordable. Need ${mf(150e9)}, ` +
                `have cash ${mf(playerMoney)}, stocks ${mf(stockValue)}, net ${mf(playerMoney + stockValue)}.`, undefined, true);
            log(ns, `Exiting to free corporation API RAM; rerun when funding is available.`, undefined, true);
            ns.exit();
        }
    }
    if (!created) {
        log(ns, `ERROR: Failed to create corporation even though bootstrap appeared available. Exiting.`, undefined, true);
        ns.exit();
    }
}

/**
 * Create a bare bones new division, then use any remaining money to set it up.
 * @param {NS} ns
 * @param {*} newIndustry
 * @param {number} newDivisionBudget
 * @returns {boolean} true if we created the new division, false if not.
 */
async function doCreateNewDivision(ns, newIndustry, newDivisionBudget) {
    if (options['no-expansion'] || options['mock']) return false;
    myCorporation = ns.corporation.getCorporation();
    let numDivisions = myCorporation.divisions.length;

    ns.corporation.expandIndustry(newIndustry.name, newIndustry.name);

    myCorporation = ns.corporation.getCorporation();
    if (numDivisions === myCorporation.divisions.length) {
        log(ns, `ERROR: Failed to create new division! Expected to create '${newIndustry.name}'.`, 'error', true);
        ns.exit();
    }
    newDivisionBudget -= newIndustry.startupCost;
    log(ns, `Created division '${newIndustry.name}' for ${mf(newIndustry.startupCost)}.`);
    let newDivision = ns.corporation.getDivision(newIndustry.name);

    // Hire the first three employees in Sector-12
    fillSpaceQueue.push(`${newDivision.name}/Sector-12`);

    // Do the first round of purchasing now.
    await doManageDivision(ns, newDivision, newDivisionBudget);
    if (newDivision) return true;
    else return false;
}

/**
 * Given an existing division, try to allocate our budget to growing the business.
 * @param {NS} ns
 * @param {Division} division division from ns.corporation.getDivision()
 * @param {number} budget amount we can spend
 * @returns {number} the amount we spent while managing this division.
 */
async function doManageDivision(ns, division, budget) {
    myCorporation = ns.corporation.getCorporation();
    const industry = getIndustry(division);
    budget = Math.max(0, budget);
    const totalBudget = budget;

    // We can't do much here without both the office and warehouse api.
    for (const api of ['Warehouse API', 'Office API']) {
        if (!hasUnlock(ns, api)) {
            if (verbose) log(ns, `Cannot manage division ${division.name} without unlocking '${api}'`);
            return 0;
        }
    }
    /**
     * Take stock of the current state of this division. Just like at the corporate level,
     * collect some tasks that we'd like to do, then see what we can execute. Don't worry too
     * much about spending the whole budget. Anything we don't spend now will get passed on
     * to other divisions, or recycled in the next pass.
     */
    if (verbose) log(ns, '');
    if (verbose) log(ns, `Managing ${division.name} division with a budget of ${mf(budget)}.`);
    let spent = 0;
    let tasks = [];

    // Can we expand to new cities?
    if (division.cities.length < cities.length) {
        // We aren't in all cities yet, so we want to expand.
        for (const city of cities) {
            if (!division.cities.includes(city)) {
                let cost = getCorpConstants(ns).officeInitialCost;
                if (cost < budget * 0.25) {
                    if (verbose) log(ns, `Want to open new offices in ${city}.`);
                    tasks.push(new Task(`Expand ${division.name} to ${city}`, () => doExpandCity(ns, division.name, city), cost, 80));
                } else if (verbose) log(ns, `WARNING: We would like to expand to ${city}, but it would cost ${mf(cost)} on our budget of ${mf(budget)}.`);
            }
        }
    }
    // Go ahead and expand immediately, so we can buy other stuff for any new locations on this cycle.
    if (tasks.length > 0) {
        spent = await runTasks(ns, tasks, budget);
        budget -= spent;
        tasks = [];
    }
    // Update our status
    myCorporation = ns.corporation.getCorporation();
    division = ns.corporation.getDivision(division.name);
    let hasMarketTA2 = ns.corporation.hasResearched(division.name, 'Market-TA.II');

    // Warehouses are foundational for both material and product divisions. Buy
    // missing warehouses before products or ads can consume the whole budget.
    const warehouseBootstrapSpent = await buyMissingDivisionWarehouses(ns, division, budget);
    if (warehouseBootstrapSpent > 0) {
        spent += warehouseBootstrapSpent;
        budget -= warehouseBootstrapSpent;
        myCorporation = ns.corporation.getCorporation();
        division = ns.corporation.getDivision(division.name);
    }

    // Division wide tasks
    const officeCatchUpCities = getOfficeCatchUpCities(ns, division);
    const productRevenueBlocked = industry.makesProducts && (division.lastCycleRevenue || division.revenue || 0) <= 0;
    const productFoundationBlocked = productRevenueBlocked &&
        (division.products.length === 0 || officeCatchUpCities.length > 0);
    // Can we buy advertising? This is how we go exponential in our production industry.
    let adCount = ns.corporation.getHireAdVertCount(division.name);
    let adPrice = ns.corporation.getHireAdVertCost(division.name);
    if (productFoundationBlocked) {
        logOnce(ns, `INFO: Pausing advertising for ${division.name} until product foundation is funded.`);
    } else if (industry.makesProducts && adPrice < budget * 0.9) {
        tasks.push(new Task(`Buy advertising campaign #${adCount + 1} for ${division.name}`, () => ns.corporation.hireAdVert(division.name), adPrice, 60));
    }
    // Buy the first advertising campaign for non-product industries
    else if (adCount == 0 && adPrice < budget * 0.9) {
        // Buy one advertising campaign in material markets
        tasks.push(new Task(`Buy advertising campaign #${adCount + 1} for ${division.name}`, () => ns.corporation.hireAdVert(division.name), adPrice, 60));
    }
    // Consider buying more advertising. All industires with MarketTA2, or a second one for production industries.
    else if (hasMarketTA2 && adPrice < budget * 0.5) {
        tasks.push(new Task(`Buy advertising campaign #${adCount + 1} for ${division.name}`, () => ns.corporation.hireAdVert(division.name), adPrice, 20));
    }

    // Should we spend any research?
    const productResearchPlan = industry.makesProducts
        ? ['uPgrade: Fulcrum', 'uPgrade: Capacity.I', 'uPgrade: Capacity.II']
        : [];
    const researchTypes = [...commonResearchPlan, ...productResearchPlan, ...growthResearchPlan];
    purchaseResearchPlan(ns, division, researchTypes);

    // If this is a production industry, see if we should be researching a new product.
    if (industry.makesProducts) {
        const maxProducts = getMaxProducts(ns, division.name);
        if (division.products.length === 0) {
            const foundationSpent = await bootstrapFirstProductFoundation(ns, division, budget);
            if (foundationSpent > 0) {
                spent += foundationSpent;
                budget -= foundationSpent;
                myCorporation = ns.corporation.getCorporation();
                division = ns.corporation.getDivision(division.name);
            }
        }
        let products = division.products
            .map((p) => tryGetProduct(ns, division.name, p, getDivisionProductCity(division)))
            .filter(Boolean);
        const developmentBacklog = getProductCreationBacklog(ns, division);
        if (developmentBacklog.length > 0) {
            logOnce(ns, `INFO: Skipping product creation for ${division.name}; development backlog: ${developmentBacklog.slice(0, 4).join('; ')}.`);
        } else {
            let progress = products.map((p) => p.developmentProgress).filter((cmp) => cmp < 100)[0];
            if (progress == undefined) progress = 100;
            if (verbose) log(ns, `Projects: ${products.length}/${maxProducts}. Current project: ${nf(progress)}% complete.`);
            if (progress === 100) {
                // No product being researched. Consider creating a new one.
                if (division.products.length < maxProducts) {
                    // We're not full, so go ahead.
                    const productSpend = createNewProduct(ns, division, budget);
                    spent += productSpend;
                    budget -= productSpend;
                } // Discontinue an existing product for a new one if we're not raising capital.
                else {
                    // log(ns, `Considering creating a new product. rC: ${raisingCapital} eR: ${mf(extraReserve)}`);
                    if (raisingCapital === 0) {
                        if (extraReserve > 0 && myCorporation.funds > extraReserve) {
                            // We have enough money saved up. Time to ditch the product with the lowest budget.
                            products.sort((a, b) => budgetFromProductName(a.name) - budgetFromProductName(b.name));
                            let lowBudgetProduct = products[0];
                            ns.corporation.discontinueProduct(division.name, lowBudgetProduct.name);
                            myCorporation = ns.corporation.getCorporation();
                        }
                        // Try to create the Product. If it fails, it will set a reserve for us.
                        const productSpend = createNewProduct(ns, division, budget);
                        spent += productSpend;
                        budget -= productSpend;
                    }
                }
            }
        }
    }

    // Per city tasks.
    const catchUpOfficeSize = getDivisionCatchUpOfficeSize(ns, division);
    for (const city of division.cities) {
        // Can we expand any of our offices for more employees?
        let officeSize = ns.corporation.getOffice(division.name, city).size;
        let seats = 15; // Grow by officeSize when small, then by 15
        seats = Math.min(seats, officeSize);
        if (lateGameGrowthLimited) seats = Math.min(seats, catchUpOfficeSize - officeSize);
        let cost;
        if (seats <= 0) {
            // This city is already caught up enough for late-game maintenance.
        } else {
            cost = ns.corporation.getOfficeSizeUpgradeCost(division.name, city, seats);
            const officeBudgetShare = getOfficeBudgetShare(ns, industry, division, city);
            if (cost < budget * officeBudgetShare) {
                tasks.push(new Task(`Buy space for ${seats} more employees of ${division.name}/${city}`, () => upgradeOfficeSize(ns, division.name, city, seats), cost, getOfficeGrowthPriority(ns, industry, division, city)));
            } else {
                logOnce(ns, `INFO: Office catch-up waiting for budget: ${division.name}/${city} needs ${mf(cost)} ` +
                    `for ${seats} seats; division budget is ${mf(budget)}.`);
            }
        }

        // Can we expand our warehouse space?
        if (!ns.corporation.hasWarehouse(division.name, city)) {
            // We don't have a warehouse here. We should try to buy one in this city.
            cost = getCorpConstants(ns).warehouseInitialCost;
            if (cost < budget * 0.5) {
                tasks.push(new Task(`Buy warehouse ${division.name}/${city}`, () => ns.corporation.purchaseWarehouse(division.name, city), cost, 80));
            }
            // Anything else we want to do with a city requires a warehouse, so just skip to the next city.
            continue;
        }

        // We have a warehouse. Can we expand it?
        let warehouse = ns.corporation.getWarehouse(division.name, city);
        // TODO: How much do we care about expanding the warehouse? We should base it on how much of an impact more materials would have.
        cost = ns.corporation.getUpgradeWarehouseCost(division.name, city);
        const warehouseBudgetShare = getWarehouseBudgetShare(ns, division, city, warehouse);
        if (cost < budget * warehouseBudgetShare) {
            tasks.push(new Task(`Buy warehouse space for ${division.name}/${city}`, () => ns.corporation.upgradeWarehouse(division.name, city), cost, 20));
        }

        // Turn on Smart Supply if we have it
        if (hasUnlock(ns, 'Smart Supply') && !warehouse.smartSupplyEnabled) {
            try {
                if (verbose) log(ns, `Turning on Smart Supply for ${division.name}/${city}.`);
                ns.corporation.setSmartSupply(division.name, city, true);
            } catch (e) {
                log(ns, `ERROR: ${e}`);
            }
        } else if (!hasUnlock(ns, 'Smart Supply')) {
            // Try to emulate Smart Supply if we don't have it.
            // TODO: I don't think this is working.
            for (const requiredMaterialName in industry.reqMats) {
                let amtPerProduct = industry.reqMats[requiredMaterialName];
                let amtRequiredMaterial = 0;
                for (const producedMaterialName of industry.prodMats) {
                    let producedMaterial = ns.corporation.getMaterial(division.name, city, producedMaterialName);
                    let lastProduced = producedMaterial.productionAmount;
                    if (lastProduced < 1) lastProduced = 1 * getDivisionProductionMult(division);
                    amtRequiredMaterial += lastProduced * amtPerProduct;
                }
                for (const productName of division.products) {
                    let lastProduced = getProductCityStats(ns, division.name, productName, city).produced;
                    if (lastProduced < 1) lastProduced = 1 * getDivisionProductionMult(division);
                    amtRequiredMaterial += lastProduced * amtPerProduct;
                }
                const requiredMaterial = ns.corporation.getMaterial(division.name, city, requiredMaterialName);
                amtRequiredMaterial -= requiredMaterial.stored;
                amtRequiredMaterial = Math.max(0, amtRequiredMaterial);
                amtRequiredMaterial *= 10; // Produce 10 times per cycle
                // Set the buy amount for this city based on our calculations.
                ns.corporation.buyMaterial(division.name, city, requiredMaterialName, amtRequiredMaterial);
            }
        }

        // Can we buy more materials given the space we currently have?
        // First, wait to cycle around to 'START' so we have a clean read on the warehouse levels.
        await sleepWhileNotInStartState(ns);
        // Calculate the required free space for a production cycle's worth of Material and products.
        let warehouseSpaceRequiredForCycle = getReservedWarehouseSpace(ns, industry, division, city);

        // We don't want to drive the corp too deeply negative with material purchases too soon, or 
        // else nothing else will ever be bought, and employees will never get happy.
        let freeSpace = warehouse.size - warehouse.sizeUsed;
        let warehouseSpaceAvailable = freeSpace - warehouseSpaceRequiredForCycle;
        let tolerance = warehouseSpaceRequiredForCycle * 0.01;
        let enoughSpace = warehouseSpaceAvailable >= tolerance; // Tiny safety margin
        const satisfied = allEmployeesSatisfied(ns);
        if ((budget > 0 || satisfied) && enoughSpace && raisingCapital === 0) {
            // We have a decent amount of space to fill.
            if (verbose) log(ns, `   ${division.name}/${city} warehouse: Wants +${nf(warehouseSpaceAvailable)} m² materials. ${nf(warehouseSpaceRequiredForCycle)} m² reserved.`);
            for (const material of bonusMaterials) {
                if (industry.prodMats.includes(material)) continue; // Don't fill warehouse with a material this division makes.
                let amt = (industry.scaledMaterialBonus[material] * warehouseSpaceAvailable) / 4;
                // somewhat scale the amount we buy with our budget
                let scaleFactor = Math.log10(budget) - 11; // Don't go full speed until our budget is $100b or more.
                scaleFactor = Math.max(-2, scaleFactor);
                scaleFactor = Math.min(0, scaleFactor);
                let scale = Math.pow(10, scaleFactor);
                // Only scale if we're waiting on employees to get happy.
                if (!satisfied) amt = scale * amt;
                ns.corporation.buyMaterial(division.name, city, material, amt);
            }
        } else {
            // Make sure we're not buying anything -- we're either out of room or out of money.
            for (const material of bonusMaterials) {
                ns.corporation.buyMaterial(division.name, city, material, 0);
            }
        }
        // It's possible to get into a situation where we've grown production faster than warehouse space.
        if (warehouseSpaceAvailable < -tolerance) {
            // Start clearing things out.
            if (verbose) log(ns, `   ${division.name}/${city} warehouse: Wants to reserve ${nf(warehouseSpaceRequiredForCycle)} of ${nf(warehouse.size)} m², but only ${nf(freeSpace)} m² free! Selling some materials.`);
            for (const material of allMaterials) {
                let materialInfo = ns.corporation.getMaterial(division.name, city, material);
                let amt = materialInfo.stored;
                let sellAmt = amt * 0.025;
                ns.corporation.sellMaterial(division.name, city, material, sellAmt.toFixed(2), 'MP*0.80');
            }
        } else {
            // Make sure we reset. It should be safe to sell '0' here, because the things we want to sell will get reset in the price discovery loop.
            for (const material of allMaterials) {
                ns.corporation.sellMaterial(division.name, city, material, '0', 'MP');
            }
        }
    }
    // Figure out which tasks we can afford to run, and in which order.
    tasks.sort((a, b) => a.cost - b.cost).reverse();
    tasks.sort((a, b) => a.priority - b.priority).reverse();
    // Finally, run all the tasks we've collected.
    spent += await runTasks(ns, tasks, budget);
    if (spent > 0 && verbose) log(ns, `Spent ${mf(spent)} of our budget of ${mf(totalBudget)}.`);

    return spent;
}

async function bootstrapFirstProductFoundation(ns, division, budget) {
    const productCity = getDivisionProductCity(division);
    let spent = 0;
    if (!division.cities.includes(productCity)) return 0;

    if (!ns.corporation.hasWarehouse(division.name, productCity)) {
        const cost = getCorpConstants(ns).warehouseInitialCost;
        if (cost < myCorporation.funds) {
            spent += await runTasks(ns, [
                new Task(`Buy product warehouse ${division.name}/${productCity}`, () => ns.corporation.purchaseWarehouse(division.name, productCity), cost, 100),
            ], Math.max(budget, cost), false);
        } else {
            logOnce(ns, `INFO: Skipping product creation for ${division.name}; product warehouse ${productCity} needs ${mf(cost)}, funds ${mf(myCorporation.funds)}.`);
        }
    }

    let office = ns.corporation.getOffice(division.name, productCity);
    if (office.size > office.numEmployees) {
        const hired = await fillOpenPositions(ns, division.name, productCity);
        if (hired > 0)
            log(ns, `Hired ${hired} product employee(s) for ${division.name}/${productCity}.`);
    }
    return spent;
}

function getMissingWarehouseCities(ns, division) {
    return division.cities.filter((city) => {
        try {
            return !ns.corporation.hasWarehouse(division.name, city);
        } catch {
            return false;
        }
    });
}

function getWarehouseCities(ns, division) {
    return division.cities.filter((city) => {
        try {
            return ns.corporation.hasWarehouse(division.name, city);
        } catch {
            return false;
        }
    });
}

async function buyMissingDivisionWarehouses(ns, division, budget) {
    const missingWarehouseCities = getMissingWarehouseCities(ns, division);
    if (missingWarehouseCities.length === 0) return 0;

    const cost = getCorpConstants(ns).warehouseInitialCost;
    const tasks = missingWarehouseCities.map((city) =>
        new Task(`Buy warehouse ${division.name}/${city}`, () => ns.corporation.purchaseWarehouse(division.name, city), cost, 95));
    return await runTasks(ns, tasks, budget);
}

function getDivisionCatchUpOfficeSize(ns, division) {
    const officeSizes = division.cities.map((city) => ns.corporation.getOffice(division.name, city).size);
    const minOfficeSize = Math.min(...officeSizes);
    const maxOfficeSize = Math.max(...officeSizes);
    const baseTarget = Math.max(lateGameCatchUpOfficeSize, maxOfficeSize);
    const nextGrowthTarget = minOfficeSize >= baseTarget ? baseTarget + 15 : baseTarget;
    return Math.min(getDynamicOfficeSizeLimit(ns, division), nextGrowthTarget);
}

function getDynamicOfficeSizeLimit(ns, division) {
    const industry = getIndustry(division);
    const revenueScale = Math.max(0, Math.floor(Math.log10(Math.max(1, myCorporation.revenue)) - 21));
    const fundsScale = Math.max(0, Math.floor(Math.log10(Math.max(1, myCorporation.funds)) - 24));
    const scale = Math.max(revenueScale, fundsScale);
    let limit = lateGameBaseOfficeSizeLimit + scale * 500;
    if (industry.makesProducts)
        limit += 1000;
    return Math.min(lateGameMaxOfficeSizeLimit, Math.max(lateGameBaseOfficeSizeLimit, limit));
}

function getOfficeCatchUpCities(ns, division) {
    const catchUpOfficeSize = getDivisionCatchUpOfficeSize(ns, division);
    return division.cities.filter((city) => ns.corporation.getOffice(division.name, city).size < catchUpOfficeSize);
}

function getOfficeBudgetShare(ns, industry, division, city) {
    if (lateGameGrowthLimited) return 0.75;
    if (industry.makesProducts && city === getDivisionProductCity(division)) return 0.85;
    if (industry.makesProducts) return 0.3;
    const divisionProfit = getDivisionProfit(division);
    if (divisionProfit > myCorporation.revenue * 0.05) return 0.55;
    return 0.35;
}

function getOfficeGrowthPriority(ns, industry, division, city) {
    if (industry.makesProducts && city === getDivisionProductCity(division)) return 92;
    const catchUpOfficeSize = getDivisionCatchUpOfficeSize(ns, division);
    const officeSize = ns.corporation.getOffice(division.name, city).size;
    if (officeSize < catchUpOfficeSize * 0.5) return 88;
    return 72;
}

function getWarehouseBudgetShare(ns, division, city, warehouse) {
    const officeCatchUpCities = getOfficeCatchUpCities(ns, division);
    const usedRatio = warehouse.sizeUsed / warehouse.size;
    if (officeCatchUpCities.length > 0) {
        if (usedRatio > 0.95) return 0.2;
        if (usedRatio > 0.85) return 0.1;
        return 0;
    }
    if (usedRatio > 0.90) return 0.25;
    if (usedRatio > 0.75) return 0.15;
    if (usedRatio > 0.65) return 0.05;
    return 0;
}

function getCorporationDevelopmentBacklog(ns) {
    if (!hasUnlock(ns, 'Office API') || !hasUnlock(ns, 'Warehouse API')) return [];

    const backlog = [];
    for (const division of getCorpDivisions(ns)) {
        const missingCities = cities.filter((city) => !division.cities.includes(city));
        if (missingCities.length > 0)
            backlog.push(`${division.name} missing city ${missingCities[0]}`);

        const missingWarehouseCities = getMissingWarehouseCities(ns, division);
        if (missingWarehouseCities.length > 0)
            backlog.push(`${division.name} missing warehouse ${missingWarehouseCities[0]}`);

        const officeCatchUpCities = getOfficeCatchUpCities(ns, division);
        if (officeCatchUpCities.length > 0)
            backlog.push(`${division.name} office catch-up ${officeCatchUpCities[0]}`);
    }
    return backlog;
}

function getFirstProductDevelopmentBacklog(ns, division) {
    return getProductCreationBacklog(ns, division);
}

function getProductCreationBacklog(ns, division) {
    if (!hasUnlock(ns, 'Office API') || !hasUnlock(ns, 'Warehouse API')) return [];
    const productCity = getDivisionProductCity(division);
    const backlog = [];
    if (!division.cities.includes(productCity))
        backlog.push(`${division.name} missing product city ${productCity}`);
    else {
        if (!ns.corporation.hasWarehouse(division.name, productCity))
            backlog.push(`${division.name} missing product warehouse ${productCity}`);
        const office = ns.corporation.getOffice(division.name, productCity);
        if (office.numEmployees === 0)
            backlog.push(`${division.name} missing product employees ${productCity}`);
    }
    return backlog;
}

function corporationHasDevelopmentBacklog(ns) {
    return getCorporationDevelopmentBacklog(ns).length > 0;
}

/**
 * How much space do we need to leave fee in this warehouse for a full cycle of production?
 * @param {NS} ns
 * @param {Industry} industry
 * @param {Division} division
 * @param {string} city
 * @returns {number}
 */
function getReservedWarehouseSpace(ns, industry, division, city) {
    let rawMaterialSize = 0;
    let warehouseSpaceRequiredForCycle = 0;
    let maxProd = 0;

    // Products take the same space as what was used to create it.
    for (const matName in industry.reqMats) {
        let matAmt = industry.reqMats[matName];
        rawMaterialSize += matAmt * materialSizes[matName];
    }

    // Max production is based on a bunch of production multipliers.
    maxProd = getMaximumProduction(ns, division, city);

    // How many materials could we produce? Material sizes are predefined.
    for (const matName of industry.prodMats) {
        warehouseSpaceRequiredForCycle += materialSizes[matName] * maxProd;
    }

    if (industry.makesProducts) {
        const readableProducts = division.products
            .map((productName) => tryGetProduct(ns, division.name, productName, getDivisionProductCity(division)))
            .filter(Boolean);
        const hasUnreadableProducts = readableProducts.length < division.products.length;
        const activeProductSlots = Math.max(
            division.products.length,
            readableProducts.some((product) => product.developmentProgress < 100) || hasUnreadableProducts ? 1 : 0,
        );
        warehouseSpaceRequiredForCycle += activeProductSlots * maxProd * rawMaterialSize;
    }

    // We produce stuff 10 times per cycle
    warehouseSpaceRequiredForCycle *= 10;

    // If we don't have automatic price discovery, we'll need some extra free space.
    let hasMarketTA2 = ns.corporation.hasResearched(division.name, 'Market-TA.II');
    if (!hasMarketTA2) warehouseSpaceRequiredForCycle *= 3;
    else warehouseSpaceRequiredForCycle *= 1.5;

    return warehouseSpaceRequiredForCycle;
}

function getMaximumProduction(ns, division, city) {
    let office = ns.corporation.getOffice(division.name, city);
    let officeMult = getOfficeProductivity(office); // Workers
    let prodMult = getDivisionProductionMult(division); // Materials
    let corpMult = 1 + 0.03 * ns.corporation.getUpgradeLevel('Smart Factories'); // Corporate upgrades.
    let resMult = 1;
    if (ns.corporation.hasResearched(division.name, 'Drones - Assembly')) resMult *= 1.2;
    if (ns.corporation.hasResearched(division.name, 'Self-Correcting Assemblers')) resMult *= 1.1;
    let maxProd = officeMult * prodMult * corpMult * resMult;
    return maxProd;
}

/**
 * Try to create a new product for this division, with a budget at least twice the size of the last
 * one we bought. If we don't have enough money, or all our product slots are full,
 * then set a reserve for the desired amount.
 *
 * @param {NS} ns
 * @param {Division} division
 * @param {number} availableBudget
 * @returns amount of money spent, if any.
 */
function createNewProduct(ns, division, availableBudget = Infinity) {
    let wantToSpend = minimumProductInvestment;
    let spent = 0;
    const spentOnProducts = division.products
        .map((p) => budgetFromProductName(p))
        .filter((budget) => Number.isFinite(budget) && budget > 0)
        .sort((a, b) => b - a);
    if (division.products.length > 0) {
        const fallbackSpend = minimumProductInvestment * Math.pow(2, division.products.length - 1);
        const previousSpend = spentOnProducts.length > 0 ? spentOnProducts[0] * 2 : 0;
        const revenueSpend = Number.isFinite(myCorporation.revenue) && myCorporation.revenue > 0 ? myCorporation.revenue * 100 : 0;
        wantToSpend = Math.max(previousSpend, fallbackSpend, revenueSpend, minimumProductInvestment);
    }
    if (!Number.isFinite(wantToSpend) || wantToSpend <= 0) {
        log(ns, `WARNING: Product budget for ${division.name} was invalid; falling back to ${mf(minimumProductInvestment)}.`);
        wantToSpend = minimumProductInvestment;
    }
    if (Number.isFinite(availableBudget)) {
        const productBudgetCap = Math.max(minimumProductInvestment, availableBudget * 0.5);
        if (wantToSpend > productBudgetCap) {
            if (verbose)
                log(ns, `Capping ${division.name} product budget from ${mf(wantToSpend)} to ${mf(productBudgetCap)} to keep division development moving.`);
            wantToSpend = productBudgetCap;
        }
    }
    let productname = `${getProductNamePrefix(division)}-${Math.log10(wantToSpend).toFixed(2)}`;
    try {
        ns.corporation.makeProduct(division.name, getDivisionProductCity(division), productname, wantToSpend / 2, wantToSpend / 2);
        log(ns, `Creating new product '${productname}' for ${mf(wantToSpend)}.`, 'info', true);
        spent += wantToSpend;
        extraReserve = 0;
    } catch (e) {
        const errorMessage = String(e);
        if (errorMessage.includes('already at the max products')) {
            extraReserve = 0;
            if (verbose) log(ns, `Skipping product creation for ${division.name}: product slots are full.`);
            return spent;
        }
        // Product reserves are soft; huge reserves can freeze office and warehouse catch-up.
        const reserveCap = Math.max(minimumProductInvestment, myCorporation.funds * 0.25);
        extraReserve = Math.min(wantToSpend, reserveCap);
        log(ns, `WARNING: Failed to create product for ${division.name}: ${e}`);
        log(ns, `Reserving budget of ${mf(extraReserve)} for next product.`);
    }
    return spent;
}

function getMaxProducts(ns, divisionName) {
    let maxProducts = 3;
    if (ns.corporation.hasResearched(divisionName, 'uPgrade: Capacity.I')) maxProducts++;
    if (ns.corporation.hasResearched(divisionName, 'uPgrade: Capacity.II')) maxProducts++;
    return maxProducts;
}

/** @param {NS} ns */
async function sleepWhileNotInStartState(ns, waitForNext = false) {
    myCorporation = ns.corporation.getCorporation();
    if (waitForNext) {
        while (getCorpState(myCorporation) === 'START') {
            if (ns.corporation.nextUpdate) await ns.corporation.nextUpdate();
            else await ns.sleep(50);
            myCorporation = ns.corporation.getCorporation();
        }
    }
    let lastState = 'Unknown';
    while (getCorpState(myCorporation) !== 'START') {
        const state = getCorpState(myCorporation);
        if (verbose && state !== lastState) {
            log(ns, `Waiting for corporation to move into the 'START' status. Currently: '${state}'.`);
            lastState = state;
        }
        if (ns.corporation.nextUpdate) await ns.corporation.nextUpdate();
        else await ns.sleep(50); // Better keep the sleep short, in case we're in catch-up mode.
        myCorporation = ns.corporation.getCorporation();
    }
    myCorporation = ns.corporation.getCorporation();
}

/**
 * Buy the specified number of seats, and hire employees to fill them.
 * @param {NS} ns
 * @param {string} divisionName
 * @param {string} city
 * @param {number} seats
 * @returns {boolean} returns true on success
 */
async function upgradeOfficeSize(ns, divisionName, city, seats) {
    // First buy the new seats.
    let success = false;
    try {
        if (seats > 0) ns.corporation.upgradeOfficeSize(divisionName, city, seats);
        success = true;
    } catch (e) {
        log(ns, `ERROR: Failed to upgrade office size by ${seats} seats in ${city}.`);
        log(ns, `ERROR: ${e}`);
    }
    if (!success) return false;

    /**
     * Now that we have more office space, we need to hire and assign workers. Since
     * worker assignment takes a long time, add them to a queue and we'll handle it
     * later.
     */
    fillSpaceQueue.push(`${divisionName}/${city}`);

    return true;
}

async function fillOpenPositionsFromQueue(ns) {
    myCorporation = ns.corporation.getCorporation();
    fillSpaceQueue = [...new Set(fillSpaceQueue)]; // Unique
    let filledOffices = 0;
    let hiredEmployees = 0;
    while (fillSpaceQueue.length > 0) {
        let office = fillSpaceQueue.shift();
        let divisionName = office.split('/')[0];
        let cityName = office.split('/')[1];
        if (!corporationHasDivision(ns, divisionName)) {
            logOnce(ns, `INFO: Skipping stale hiring queue entry for missing division '${divisionName}'.`);
            continue;
        }
        const division = ns.corporation.getDivision(divisionName);
        if (!division.cities.includes(cityName)) {
            logOnce(ns, `INFO: Skipping stale hiring queue entry for missing office '${divisionName}/${cityName}'.`);
            continue;
        }
        const hired = await fillOpenPositions(ns, divisionName, cityName);
        if (hired > 0) {
            filledOffices++;
            hiredEmployees += hired;
        }
        myCorporation = ns.corporation.getCorporation();
    }
    if (filledOffices > 0)
        log(ns, `Hired ${hiredEmployees} employee(s) across ${filledOffices} office(s).`);
}

/**
 * Fill any open positions with employees.
 * @param {NS} ns
 * @param {string} divisionName
 * @param {string} cityName
 */
async function fillOpenPositions(ns, divisionName, cityName) {
    if (options.mock) return 0;
    if (!corporationHasDivision(ns, divisionName)) return 0;
    const division = ns.corporation.getDivision(divisionName);
    if (!division.cities.includes(cityName)) return 0;
    let office = ns.corporation.getOffice(divisionName, cityName);
    let openJobs = office.size - office.numEmployees;
    for (let i = 0; i < openJobs; i++) {
        ns.corporation.hireEmployee(divisionName, cityName);
    }
    office = ns.corporation.getOffice(divisionName, cityName);
    if (office.numEmployees > 0) {
        if (verbose) log(ns, `Assigning ${office.numEmployees} employees to work in ${divisionName}/${cityName}`);
        const industry = getIndustry(division);
        const isProductHeadquarters = industry.makesProducts && cityName === getDivisionProductCity(division);
        const assignments = getEmployeeAssignments(office.numEmployees, isProductHeadquarters);

        // Release current assignments first. In Bitburner 3.x, increases can only consume Unassigned employees.
        for (const job of clearableJobs)
            await ns.corporation.setJobAssignment(divisionName, cityName, job, 0);
        for (const job of jobs)
            await ns.corporation.setJobAssignment(divisionName, cityName, job, assignments[job]);
    }
    return openJobs;
}

/**
 * Attempt to find a reasonablly stable price for each product. This will take several production cycles to stabilize.
 * @param {NS} ns
 */
async function doPriceDiscovery(ns) {
    if (verbose) log(ns, ``);
    if (verbose) log(ns, `Doing price discovery for products.`);
    myCorporation = ns.corporation.getCorporation();
    for (const division of getCorpDivisions(ns)) {
        const industry = getIndustry(division);
        const warehouseCities = getWarehouseCities(ns, division);
        if (warehouseCities.length === 0) {
            if (industry.makesProducts)
                logOnce(ns, `INFO: ${division.name} has no revenue: no city has a warehouse yet.`);
            else if (verbose) log(ns, `Skipping price discovery for ${division.name}: no city has a warehouse yet.`);
            continue;
        }
        // If we have Market-TA.II researched, just let that work.
        let hasMarketTA2 = ns.corporation.hasResearched(division.name, 'Market-TA.II');
        if (hasMarketTA2) {
            for (const city of warehouseCities) {
                // Default prices
                industry.prodMats.forEach((material) => ns.corporation.sellMaterial(division.name, city, material, 'MAX', 'MP'));
                division.products.forEach((product) => ns.corporation.sellProduct(division.name, city, product, 'MAX', 'MP'));
                // Turn on automation.
                industry.prodMats.forEach((material) => ns.corporation.setMaterialMarketTA2(division.name, city, material, true));
                division.products.forEach((product) => ns.corporation.setProductMarketTA2(division.name, product, true));
            }
            if (industry.makesProducts)
                logProductRevenueStatus(ns, division, warehouseCities);
            // No need to do any other price discovery on this division.
            continue;
        }

        // Materials are easy. Just sell them for Market price.
        for (const materialName of industry.prodMats) {
            for (const city of warehouseCities) {
                // MAX also sells any backlog accumulated during an earlier production or pricing bottleneck.
                ns.corporation.sellMaterial(division.name, city, materialName, 'MAX', 'MP');
            }
        }

        // Go through each product, and see if the price needs to be adjusted. We can only
        // adjust the price on a per-product basis (desipe the UI letting you do it
        // manually, the API is busted.)
        let prevProductMultiplier = 1.0;
        for (const productName of division.products) {
            const productCity = getDivisionProductCity(division);
            if (!warehouseCities.includes(productCity)) {
                if (verbose) log(ns, `Skipping price discovery for ${division.name}/${productName}: product city '${productCity}' has no warehouse yet.`);
                continue;
            }
            const product = tryGetProduct(ns, division.name, productName, productCity);
            if (!product) continue;
            if (product.developmentProgress < 100) continue;
            let sPrice = `${product.desiredSellPrice}`;
            // sPrice ought to be of the form 'MP * 123.45'. If not, we should use the price of the last product we calculated.
            let lastPriceMultiplier = parseProductPriceMultiplier(sPrice, prevProductMultiplier);
            let votes = [];
            for (const city of warehouseCities) {
                // Each city is going to "vote" for how they want the price to be manipulated.
                const cityStats = getProductCityStats(ns, division.name, productName, city);
                let qty = cityStats.qty;
                let produced = cityStats.produced;
                let sold = cityStats.sold;
                // if (verbose) log(ns, `${division.name}/${city}:${product.name} (qty, prod, sold): ${[qty, produced, sold].map((n) => nf(n))}`);

                if (produced == sold && qty == 0) {
                    // We sold every item we produced. Vote to double the price.
                    votes.push(lastPriceMultiplier * 2);
                }
                // If we've accumulated a big stockpile, reduce our prices.
                else if (qty > produced * 100) {
                    votes.push(lastPriceMultiplier * 0.9);
                } else if (qty > produced * 40) {
                    votes.push(lastPriceMultiplier * 0.95);
                } else if (qty > produced * 20) {
                    votes.push(lastPriceMultiplier * 0.98);
                }
                // Our stock levels must be good. If we sold less than production, then our price is probably high
                else if (sold < produced) {
                    let newMultiplier = lastPriceMultiplier;
                    if (sold <= produced * 0.5) {
                        newMultiplier *= 0.75; // Our price is very high.
                    } else if (sold <= produced * 0.9) {
                        newMultiplier *= 0.95; // Our price is a bit high.
                    } else {
                        newMultiplier *= 0.99; // Our price is just barely high
                    }
                    votes.push(newMultiplier);
                }
                // If we sold more than production, then our price is probably low.
                else if (produced < sold) {
                    let newMultiplier = lastPriceMultiplier;
                    if (sold >= produced * 2) {
                        newMultiplier *= 2; // We sold way too much. Double the price.
                    } else if (sold >= produced * 1.33) {
                        newMultiplier *= 1.05; // We sold a bit too much. Bring the price up a bit.
                    } else {
                        newMultiplier *= 1.01;
                    }
                    votes.push(newMultiplier);
                }
            } // end for-cities
            // All of the cities have voted. Use the lowest price that the cities have asked for.
            votes = votes.filter((vote) => Number.isFinite(vote) && vote > 0);
            if (votes.length == 0) {
                log(ns, `WARNING: No valid price votes for '${productName}'. Resetting price to MP.`);
                ns.corporation.sellProduct(division.name, productCity, productName, 'MAX', 'MP', true);
                prevProductMultiplier = 1.0;
                continue;
            }
            votes.sort((a, b) => a - b);
            let newMultiplier = Math.max(0.001, votes[0]);
            let newPrice = `MP*${newMultiplier.toFixed(3)}`;
            // if (verbose) log(ns, `${prefix}Votes: ${votes.map((n) => nf(n)).join(', ')}.`);
            let sChange = percentChange(lastPriceMultiplier, newMultiplier);
            if (verbose) log(ns, `    Adjusting '${productName}' price from ${sPrice} to ${newPrice} (${sChange}).`);
            try {
                ns.corporation.sellProduct(division.name, productCity, productName, 'MAX', newPrice, true);
            } catch (err) {
                log(ns, `WARNING: Failed to set '${productName}' price to ${newPrice}; resetting to MP. ${err}`);
                ns.corporation.sellProduct(division.name, productCity, productName, 'MAX', 'MP', true);
                newMultiplier = 1.0;
            }
            prevProductMultiplier = newMultiplier;
        } // end for-products
        logProductRevenueStatus(ns, division, warehouseCities);
    } // end for-divisions
    if (verbose) log(ns, ``);
}

function parseProductPriceMultiplier(price, fallback = 1.0) {
    if (typeof price != 'string') return fallback;
    const match = price.match(/MP\s*\*\s*([0-9]*\.?[0-9]+)/i);
    if (!match) return fallback;
    const multiplier = Number.parseFloat(match[1]);
    return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : fallback;
}

function logProductRevenueStatus(ns, division, warehouseCities) {
    if (division.products.length === 0) {
        const backlog = getFirstProductDevelopmentBacklog(ns, division);
        if (backlog.length > 0)
            logOnce(ns, `INFO: ${division.name} has no revenue: no product exists yet; blocked by ${backlog.slice(0, 3).join('; ')}.`);
        else
            logOnce(ns, `INFO: ${division.name} has no revenue: no product exists yet; waiting to start product development.`);
        return;
    }
    if ((division.lastCycleRevenue || 0) > 0) return;

    const productCity = getDivisionProductCity(division);
    for (const productName of division.products) {
        if (!warehouseCities.includes(productCity)) {
            logOnce(ns, `INFO: ${division.name}/${productName} has no revenue: product city '${productCity}' has no warehouse.`);
            continue;
        }
        const product = tryGetProduct(ns, division.name, productName, productCity);
        if (!product) continue;
        if (product.developmentProgress < 100) {
            const progressBucket = Math.floor(product.developmentProgress / 5) * 5;
            logOnce(ns, `INFO: ${division.name}/${productName} has no revenue yet: product development is about ${progressBucket}% complete.`);
            continue;
        }
        const stats = getProductCityStats(ns, division.name, productName, productCity);
        logOnce(ns, `INFO: ${division.name}/${productName} is complete but has no revenue yet: ` +
            `produced ${nf(stats.produced)}/s, sold ${nf(stats.sold)}/s, stored ${nf(stats.qty)}.`);
    }
}

function maintainEmployeeWellness(ns, budget) {
    if (options.mock || budget <= 0) return 0;
    let spent = 0;
    const teaCostPerEmployee = getCorpConstants(ns).teaCostPerEmployee;
    const offices = [];
    const divisions = getCorpDivisions(ns).sort((a, b) => Number(getIndustry(b).makesProducts) - Number(getIndustry(a).makesProducts));
    for (const division of divisions) {
        const hasAutoBrew = ns.corporation.hasResearched(division.name, 'AutoBrew');
        const hasAutoParty = ns.corporation.hasResearched(division.name, 'AutoPartyManager');
        const orderedCities = [...division.cities].sort((a, b) => Number(b === getDivisionProductCity(division)) - Number(a === getDivisionProductCity(division)));
        for (const city of orderedCities) {
            const office = ns.corporation.getOffice(division.name, city);
            if (office.numEmployees > 0) offices.push({ division, city, office, hasAutoBrew, hasAutoParty });
        }
    }

    let teaOffices = 0;
    let partyOffices = 0;
    for (const { division, city, office, hasAutoBrew } of offices) {
        if (hasAutoBrew || office.avgEnergy >= office.maxEnergy * employeeWellnessThreshold) continue;
        const cost = teaCostPerEmployee * office.numEmployees;
        if (cost > budget - spent) continue;
        if (ns.corporation.buyTea(division.name, city)) {
            spent += cost;
            teaOffices++;
        }
    }
    for (const { division, city, office, hasAutoParty } of offices) {
        if (hasAutoParty || office.avgMorale >= office.maxMorale * employeeWellnessThreshold) continue;
        const costPerEmployee = getPartyCostPerEmployee(office);
        const cost = costPerEmployee * office.numEmployees;
        if (cost > budget - spent) continue;
        if (ns.corporation.throwParty(division.name, city, costPerEmployee) > 0) {
            spent += cost;
            partyOffices++;
        }
    }
    if (spent > 0)
        log(ns, `Employee wellness: spent ${mf(spent)} on tea for ${teaOffices} office(s) and parties for ${partyOffices} office(s).`);
    return spent;
}

function getPartyCostPerEmployee(office) {
    // OfficeSpace applies (morale + 10*x) * (1+x), where x = partyCost / $10m.
    // Aim 1% above the cap so a weak performance multiplier still reaches maximum morale.
    const morale = Math.max(0, office.avgMorale);
    const target = office.maxMorale * 1.01;
    const linear = morale + 10;
    const x = Math.max(0, (-linear + Math.sqrt(linear * linear - 40 * (morale - target))) / 20);
    return Math.ceil((x * 10e6) / 100e3) * 100e3;
}

function getEmployeeAssignments(employeeCount, isProductHeadquarters) {
    const weightedJobs = isProductHeadquarters
        ? [
            ['Engineer', 0.35],
            ['Management', 0.20],
            ['Research & Development', 0.20],
            ['Operations', 0.15],
            ['Business', 0.10],
        ]
        : [
            ['Operations', 0.30],
            ['Engineer', 0.30],
            ['Management', 0.20],
            ['Business', 0.10],
            ['Research & Development', 0.10],
        ];
    const assignments = Object.fromEntries(jobs.map((job) => [job, 0]));
    const shares = weightedJobs.map(([job, weight], index) => {
        const exact = employeeCount * weight;
        const assigned = Math.floor(exact);
        assignments[job] = assigned;
        return { job, remainder: exact - assigned, index };
    });
    let employeesLeft = employeeCount - Object.values(assignments).reduce((sum, count) => sum + count, 0);
    shares.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (let i = 0; i < employeesLeft; i++) assignments[shares[i].job]++;
    return assignments;
}

function isReadyForProductDivision(corporation, offer) {
    return corporation.public || offer.round > 3;
}

function bootstrapEmployeeAutomationWithHashes(ns) {
    if (ns.getPlayer().money <= 100e6 || !(9 in dictSourceFiles)) return;
    const bootstrapPlan = commonResearchPlan.slice(0, 3);
    let divisions = getCorpDivisions(ns);
    let researchNeeded = Math.max(...divisions.map((division) => getPendingResearchCost(ns, division, bootstrapPlan)), 0);
    let spentHashes = 0;
    let purchases = 0;
    while (researchNeeded > 0) {
        const hashesBefore = ns.hacknet.numHashes();
        if (!ns.hacknet.spendHashes('Exchange for Corporation Research')) break;
        const hashesAfter = ns.hacknet.numHashes();
        if (hashesAfter >= hashesBefore) break;
        spentHashes += hashesBefore - hashesAfter;
        purchases++;
        researchNeeded -= 1000;
    }
    divisions = getCorpDivisions(ns);
    for (const division of divisions)
        purchaseResearchPlan(ns, division, bootstrapPlan);
    if (purchases > 0)
        log(ns, `Employee automation bootstrap: spent ${nf(spentHashes)} hashes for ${nf(purchases * 1000)} research in each existing division.`);
}

function getPendingResearchCost(ns, division, researchPlan) {
    let cost = 0;
    for (const researchType of researchPlan) {
        if (ns.corporation.hasResearched(division.name, researchType)) continue;
        try {
            cost += ns.corporation.getResearchCost(division.name, researchType);
        } catch {}
    }
    return Math.max(0, cost - getDivisionResearch(division));
}

function purchaseResearchPlan(ns, division, researchPlan) {
    let researchToSpend = getDivisionResearch(ns.corporation.getDivision(division.name));
    for (const researchType of researchPlan) {
        let hasResearch = false;
        let cost = Infinity;
        try {
            hasResearch = ns.corporation.hasResearched(division.name, researchType);
            cost = ns.corporation.getResearchCost(division.name, researchType);
        } catch {}
        if (hasResearch) continue;
        if (researchToSpend < cost) {
            if (verbose && cost !== Infinity)
                log(ns, `Saving ${nf(researchToSpend)} research for '${researchType}' at ${nf(cost)}.`);
            break;
        }
        log(ns, `INFO: Buying research project ${researchType} for ${nf(cost)} research points.`, 'info');
        ns.corporation.research(division.name, researchType);
        researchToSpend -= cost;
    }
}

/**
 * Expand to a new city and fill the newly-opened office positions.
 * @param {NS} ns
 * @param {string} divisionName
 * @param {string} cityName
 */
async function doExpandCity(ns, divisionName, cityName) {
    ns.corporation.expandCity(divisionName, cityName);
    fillSpaceQueue.push(`${divisionName}/${cityName}`);
    log(ns, `Expanded ${divisionName} to ${cityName}.`);
}

/**
 * Spend hashes on something, as long as we have hacknet servers unlocked and a bit of money in the bank.
 * @param {NS} ns
 * @param {string} spendOn 'Sell for Corporation Funds' | 'Exchange for Corporation Research'
 */
async function doSpendHashes(ns, spendOn) {
    // Make sure we have a decent amount of money ($100m) before spending hashes this way.
    if (ns.getPlayer().money > 100e6 && 9 in dictSourceFiles) {
        let spentHashes = 0;
        let shortName = spendOn;
        if (spendOn === 'Sell for Corporation Funds') shortName = '$1B of corporate funding';
        else if (spendOn === 'Exchange for Corporation Research') shortName = '1000 research for each corporate division';
        do {
            let numHashes = ns.hacknet.numHashes();
            ns.hacknet.spendHashes(spendOn);
            spentHashes = numHashes - ns.hacknet.numHashes();
            if (spentHashes > 0) log(ns, `  Spent ${nf(Math.round(spentHashes / 100) * 100)} hashes on ${shortName}`, 'success');
        } while (spentHashes > 0);
    }
}

/**
 * Log a message. Optionally, pop up a toast. Optionally, print to the terminal.
 * @param {NS} ns
 * @param {string} log message to log
 * @param {string} toastStyle
 * @param {boolean} printToTerminal
 */
function log(ns, log, toastStyle, printToTerminal) {
    ns.print(log);
    void ns.write(historyLogFile, `[${new Date().toLocaleTimeString()}] ${log}\n`, 'a');
    if (toastStyle) ns.toast(log, toastStyle);
    if (printToTerminal) ns.tprint(log);
}

function logOnce(ns, message, toastStyle, printToTerminal) {
    if (loggedMessages.has(message)) return;
    loggedMessages.add(message);
    log(ns, message, toastStyle, printToTerminal);
}

/**
 * Assuming a product is named Industry-XX.XX, where XX.XX is the log10() of the budget.
 * @param {string} projectName
 * @returns {number} - the budget
 */
function budgetFromProductName(projectName) {
    let sExp = projectName.split('-')[1];
    let exp = Number.parseFloat(sExp);
    let budget = Math.pow(10, exp);
    return Number.isFinite(budget) ? budget : 0;
}

function getOfficeProductivity(office, forProduct = false) {
    const employeeProduction = office.employeeProductionByJob;
    const opProd = employeeProduction.Operations;
    const engrProd = employeeProduction.Engineer;
    const mgmtProd = employeeProduction.Management;
    const total = opProd + engrProd + mgmtProd;
    if (total <= 0) return 0;

    const mgmtFactor = 1 + mgmtProd / (1.2 * total);
    const prod = (Math.pow(opProd, 0.4) + Math.pow(engrProd, 0.3)) * mgmtFactor;
    const balancingMult = 0.05;

    if (forProduct) return 0.5 * balancingMult * prod;
    else return balancingMult * prod;
}

/**
 * Return the percentage change from from oldVal to NewVal.
 * @param {number} oldVal
 * @param {number} newVal
 * @returns {string} formatted as "+99.9%"
 */
function percentChange(oldVal, newVal) {
    let percentChange = (newVal / oldVal) * 100 - 100;
    let sChange = nf(percentChange) + '%';
    if (percentChange >= 0) sChange = '+' + sChange;
    return sChange;
}
