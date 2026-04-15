import { getConfiguration, getNsDataThroughFile, log } from './helpers.js'

const argsSchema = [
    ['company', ''],
    ['city', ''],
    ['faction', ''],
    ['cash', false],
    ['allow-travel', false],
    ['result-file', '/Temp/infiltration-runner-result.txt'],
];

const infiltrationStartLockFile = "/Temp/work-for-factions-infiltration-lock.txt";
const infiltrationActiveLockFile = "/Temp/work-for-factions-infiltration-active.txt";
const infiltrationPendingTimeout = 120000;

/** @param {NS} ns **/
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return;
    ns.disableLog('sleep');
    ns.disableLog('singularity.travelToCity');
    ns.disableLog('singularity.goToLocation');
    ns.write(options['result-file'], JSON.stringify({ success: false, reason: 'started' }), 'w');

    const infiltrationAutomationActive = await getNsDataThroughFile(ns, `(() => {
        const wnd = eval("window");
        return !!wnd.tmrAutoInf;
    })()`, '/Temp/infiltration-automation-active.txt');
    if (!infiltrationAutomationActive)
        return finish(ns, options['result-file'], { success: false, reason: 'infiltrate.js-not-running' });

    if (!options.city || !options.company || (!options.cash && !options.faction))
        return finish(ns, options['result-file'], { success: false, reason: 'missing-args' });

    if (!await goToCity(ns, options.city, options['allow-travel']))
        return finish(ns, options['result-file'], { success: false, reason: 'travel-failed' });
    if (!await getNsDataThroughFile(ns, `ns.singularity.goToLocation(ns.args[0])`, null, [options.company]))
        return finish(ns, options['result-file'], { success: false, reason: 'go-to-location-failed' });
    if (!await waitForInfiltrateCompanyButton(ns))
        return finish(ns, options['result-file'], { success: false, reason: 'button-not-found' });

    const startTs = Date.now();
    ns.write(infiltrationStartLockFile, `${startTs}`, 'w');
    ns.write(infiltrationActiveLockFile, `${startTs}`, 'w');
    await startInfiltrationFromCompanyPage(ns);

    while (true) {
        const state = await getInfiltrationUiState(ns);
        if (state == "running") {
            await ns.sleep(100);
            continue;
        }
        if (state == "success") {
            const clicked = await clickInfiltrationRewardButton(ns, options.faction, options.cash);
            clearInfiltrationActiveLock(ns);
            return finish(ns, options['result-file'], { success: clicked, reason: clicked ? 'success' : 'reward-click-failed' });
        }
        if (state == "hospitalized") {
            clearInfiltrationActiveLock(ns);
            await dismissHospitalizedDialog(ns);
            return finish(ns, options['result-file'], { success: false, reason: 'hospitalized' });
        }
        const activeSince = Number(ns.read(infiltrationActiveLockFile) || 0);
        if (activeSince > 0 && Date.now() - activeSince > infiltrationPendingTimeout) {
            clearInfiltrationActiveLock(ns);
            return finish(ns, options['result-file'], { success: false, reason: 'timeout' });
        }
        await ns.sleep(100);
    }
}

function finish(ns, resultFile, result) {
    ns.write(resultFile, JSON.stringify(result), 'w');
    return result.success;
}

function getDocument() {
    return eval("document");
}

function getWindow() {
    return eval("window");
}

function getText(element) {
    return element?.textContent?.trim()?.replace(/\s+/g, " ") || "";
}

function clickElement(element) {
    if (!element) return false;
    const wnd = getWindow();
    if (typeof element.click === "function") element.click();
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: wnd }));
    element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: wnd }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: wnd }));
    return true;
}

async function goToCity(ns, cityName, allowTravel = false) {
    const player = await getNsDataThroughFile(ns, `ns.getPlayer()`);
    if (player.city == cityName) return true;
    if (!allowTravel) {
        log(ns, `WARN: Travel from ${player.city} to ${cityName} is disabled for infiltration-runner.`, false, 'warning');
        return false;
    }
    if (await getNsDataThroughFile(ns, `ns.singularity.travelToCity(ns.args[0])`, null, [cityName])) return true;
    log(ns, `WARN: Failed to travel from ${player.city} to ${cityName} for infiltration-runner.`, false, 'warning');
    return false;
}

async function clickInfiltrateCompanyButton(ns) {
    const clickWorked = await getNsDataThroughFile(ns, `(() => {
        const doc = eval("document");
        const buttons = Array.from(doc.querySelectorAll("button"));
        const button = buttons.find(btn => btn.textContent?.trim()?.includes("Infiltrate Company"));
        if (!button) return false;
        const reactHandlerKey = Object.keys(button).find(key => key.startsWith("__reactProps"));
        if (reactHandlerKey && typeof button[reactHandlerKey]?.onClick === "function") {
            button[reactHandlerKey].onClick({
                isTrusted: true,
                currentTarget: button,
                target: button,
                preventDefault: () => { },
                stopPropagation: () => { },
            });
            return true;
        }
        button.click();
        return true;
    })()`, '/Temp/click-infiltrate-company.txt');
    return !!clickWorked;
}

async function startInfiltrationFromCompanyPage(ns) {
    const attemptedStart = await clickInfiltrateCompanyButton(ns);
    return attemptedStart && await waitForInfiltrationToStart(ns, 3000);
}

async function waitForInfiltrateCompanyButton(ns, timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const buttonExists = await getNsDataThroughFile(ns, `(() => {
            const doc = eval("document");
            return Array.from(doc.querySelectorAll("button"))
                .some(btn => btn.textContent?.trim()?.includes("Infiltrate Company"));
        })()`, '/Temp/has-infiltrate-company-button.txt');
        if (buttonExists) return true;
        await ns.sleep(50);
    }
    return false;
}

async function waitForInfiltrationToStart(ns, timeout = 1000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (await getInfiltrationUiState(ns) == "running")
            return true;
        await ns.sleep(50);
    }
    return false;
}

async function clickInfiltrationRewardButton(ns, factionName, takeCash = false) {
    const doc = getDocument();
    const rewardButton = () => Array.from(doc.querySelectorAll("button")).find(btn => {
        const text = getText(btn);
        return takeCash ? text.includes("Sell for") : text.includes("Trade for");
    });
    const selectedFaction = () => getText(doc.querySelector('[role="combobox"]'));

    if (!takeCash && selectedFaction() !== factionName) {
        const combo = doc.querySelector('[role="combobox"]');
        if (combo) {
            clickElement(combo);
            await ns.sleep(25);
            const option = Array.from(doc.querySelectorAll('[role="option"]')).find(el => getText(el) === factionName);
            if (option) {
                clickElement(option);
                await ns.sleep(25);
            }
        }
    }

    const button = rewardButton();
    if (button && !button.disabled && (takeCash || selectedFaction() === factionName))
        return clickElement(button);
    return false;
}

async function dismissHospitalizedDialog(ns) {
    return !!await getNsDataThroughFile(ns, `(() => {
        const doc = eval("document");
        const bodyText = doc.body?.innerText || "";
        if (!bodyText.includes("Infiltration was cancelled because you were hospitalized")) return false;
        doc.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
        return true;
    })()`, '/Temp/dismiss-infiltration-hospitalized.txt');
}

async function getInfiltrationUiState(ns) {
    return await getNsDataThroughFile(ns, `(() => {
        const doc = eval("document");
        const bodyText = doc.body?.innerText || "";
        const h4Text = Array.from(doc.querySelectorAll("h4")).map(el => el.textContent?.trim() || "");
        if (bodyText.includes("Infiltration was cancelled because you were hospitalized")) return "hospitalized";
        if (h4Text.some(text => text.toLowerCase() === "infiltration successful!")) return "success";
        if (bodyText.includes("Type it backward")) return "running";
        if (bodyText.includes("Enter the Code!")) return "running";
        if (bodyText.includes("Close the brackets.")) return "running";
        if (bodyText.includes("Slash when his guard is down!")) return "running";
        if (bodyText.includes("Remember all the mines!")) return "running";
        if (bodyText.includes("Mark all the mines!")) return "running";
        if (bodyText.includes("Say something nice about the guard.")) return "running";
        if (bodyText.includes("Match the symbols!")) return "running";
        if (bodyText.includes("Cut the wires with the following properties!")) return "running";
        if (bodyText.includes("Enter the Code")) return "running";
        if (bodyText.includes("Maximum clearance level:")) return "running";
        return "other";
    })()`, '/Temp/infiltration-ui-state.txt');
}

function clearInfiltrationActiveLock(ns) {
    ns.rm(infiltrationActiveLockFile);
}
