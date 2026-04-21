import { getConfiguration, getFilePath, getNsDataThroughFile, log } from './helpers.js'

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
const infiltrationTeardownTimeout = 5000;

/** @param {NS} ns **/
export async function main(ns) {
    const options = getConfiguration(ns, argsSchema);
    if (!options) return;
    ns.disableLog('sleep');
    ns.disableLog('singularity.travelToCity');
    ns.disableLog('singularity.goToLocation');
    ns.write(options['result-file'], JSON.stringify({ success: false, reason: 'started' }), 'w');

    if (!options.city || !options.company || (!options.cash && !options.faction))
        return finish(ns, options['result-file'], { success: false, reason: 'missing-args' });

    if (!await waitForInfiltrationIdle(ns, infiltrationTeardownTimeout))
        log(ns, `WARNING: Previous infiltration UI did not fully clear before starting ${options.company}.`, false, 'warning');

    if (!await goToCity(ns, options.city, options['allow-travel']))
        return finish(ns, options['result-file'], { success: false, reason: 'travel-failed' });
    if (!await getNsDataThroughFile(ns, `ns.singularity.goToLocation(ns.args[0])`, null, [options.company]))
        return finish(ns, options['result-file'], { success: false, reason: 'go-to-location-failed' });
    if (!await waitForInfiltrateCompanyButton(ns))
        return finish(ns, options['result-file'], { success: false, reason: 'button-not-found' });

    const startTs = Date.now();
    ns.write(infiltrationStartLockFile, `${startTs}`, 'w');
    ns.write(infiltrationActiveLockFile, `${startTs}`, 'w');
    let automationStarted = false;
    try {
        automationStarted = await ensureInfiltrationAutomationStarted(ns);
        if (!automationStarted) {
            clearInfiltrationActiveLock(ns);
            return finish(ns, options['result-file'], { success: false, reason: 'infiltrate.js-start-failed' });
        }

        if (!await startInfiltrationFromCompanyPage(ns)) {
            clearInfiltrationActiveLock(ns);
            return finish(ns, options['result-file'], { success: false, reason: 'start-failed' });
        }

        while (true) {
            const state = await getInfiltrationUiState(ns);
            if (state == "running") {
                await ns.sleep(100);
                continue;
            }
            if (state == "start") {
                await ns.sleep(100);
                continue;
            }
            if (state == "success") {
                const clicked = await clickInfiltrationRewardButton(ns, options.faction, options.cash);
                clearInfiltrationActiveLock(ns);
                if (!await waitForInfiltrationIdle(ns, infiltrationTeardownTimeout))
                    log(ns, `WARNING: Infiltration UI did not fully clear after success at ${options.company}.`, false, 'warning');
                return finish(ns, options['result-file'], { success: clicked, reason: clicked ? 'success' : 'reward-click-failed' });
            }
            if (state == "hospitalized") {
                clearInfiltrationActiveLock(ns);
                await dismissHospitalizedDialog(ns);
                if (!await waitForInfiltrationIdle(ns, infiltrationTeardownTimeout))
                    log(ns, `WARNING: Infiltration UI did not fully clear after hospitalization at ${options.company}.`, false, 'warning');
                return finish(ns, options['result-file'], { success: false, reason: 'hospitalized' });
            }
            const activeSince = Number(ns.read(infiltrationActiveLockFile) || 0);
            if (activeSince > 0 && Date.now() - activeSince > infiltrationPendingTimeout) {
                clearInfiltrationActiveLock(ns);
                return finish(ns, options['result-file'], { success: false, reason: 'timeout' });
            }
            await ns.sleep(100);
        }
    } finally {
        if (automationStarted)
            await ensureInfiltrationAutomationStopped(ns);
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

async function isInfiltrationAutomationActive(ns) {
    return !!await getNsDataThroughFile(ns, `(() => {
        const wnd = eval("window");
        return !!wnd.tmrAutoInf;
    })()`, '/Temp/infiltration-automation-active.txt');
}

async function ensureInfiltrationAutomationStarted(ns) {
    if (await isInfiltrationAutomationActive(ns))
        await ensureInfiltrationAutomationStopped(ns);
    const pid = await getNsDataThroughFile(ns, 'ns.run(ns.args[0], 1, "--quiet")', null, [getFilePath('infiltrate.js')]);
    if (!pid) return false;
    const start = Date.now();
    while (Date.now() - start < 5000) {
        if (await isInfiltrationAutomationActive(ns))
            return true;
        await ns.sleep(50);
    }
    return false;
}

async function ensureInfiltrationAutomationStopped(ns) {
    await getNsDataThroughFile(ns, 'ns.run(ns.args[0], 1, "--stop", "--quiet")', null, [getFilePath('infiltrate.js')]);
    const start = Date.now();
    while (Date.now() - start < 5000) {
        if (!await isInfiltrationAutomationActive(ns))
            return true;
        await ns.sleep(50);
    }
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
        const state = await getInfiltrationUiState(ns);
        if (state == "running" || state == "start")
            return true;
        await ns.sleep(50);
    }
    return false;
}

async function clickInfiltrationStartButton(ns) {
    return !!await getNsDataThroughFile(ns, `(() => {
        const doc = eval("document");
        const button = Array.from(doc.querySelectorAll("button"))
            .find(btn => btn.textContent?.trim() === "Start");
        if (!button || button.disabled) return false;
        if (typeof button.click === "function") button.click();
        button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
        button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
        button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));
        return true;
    })()`, '/Temp/click-infiltration-start.txt');
}

async function clickInfiltrationRewardButton(ns, factionName, takeCash = false, timeout = 5000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        if (takeCash) {
            const clicked = await getNsDataThroughFile(ns, `(() => {
                const doc = eval("document");
                const wnd = eval("window");
                const button = Array.from(doc.querySelectorAll("button"))
                    .find(btn => btn.textContent?.trim()?.includes("Sell for"));
                if (!button || button.disabled) {
                    return JSON.stringify({
                        clicked: false,
                        found: !!button,
                        disabled: !!button?.disabled,
                        text: button?.textContent?.trim() || null,
                    });
                }
                const reactHandlerKey = Object.keys(button).find(key => key.startsWith("__reactProps"));
                if (reactHandlerKey && typeof button[reactHandlerKey]?.onClick === "function") {
                    button[reactHandlerKey].onClick({
                        isTrusted: true,
                        currentTarget: button,
                        target: button,
                        preventDefault: () => { },
                        stopPropagation: () => { },
                    });
                }
                if (typeof button.click === "function") button.click();
                button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: wnd }));
                button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: wnd }));
                button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: wnd }));
                return JSON.stringify({
                    clicked: true,
                    found: true,
                    disabled: false,
                    text: button.textContent?.trim() || null,
                });
            })()`, '/Temp/click-infiltration-cash-reward.txt');
            const result = typeof clicked === "string" ? JSON.parse(clicked) : clicked;
            if (result?.clicked) return true;
            ns.write('/Temp/infiltration-cash-reward-debug.txt', JSON.stringify(result), 'w');
            await ns.sleep(50);
            continue;
        }

        const doc = getDocument();
        const rewardButton = () => Array.from(doc.querySelectorAll("button")).find(btn => {
            const text = getText(btn);
            return text.includes("Trade for");
        });
        const combo = () => doc.querySelector('[role="combobox"]') || doc.querySelector('[aria-haspopup="listbox"]');
        const selectedFaction = () => getText(combo());
        const isTargetFactionSelected = () => {
            const selected = selectedFaction();
            return !!selected && (selected === factionName || selected.includes(factionName) || factionName.includes(selected));
        };

        if (!takeCash && !isTargetFactionSelected()) {
            const comboElement = combo();
            if (comboElement) {
                clickElement(comboElement);
                await ns.sleep(50);
                const option = Array.from(doc.querySelectorAll('[role="option"]')).find(el => getText(el) === factionName);
                if (option) {
                    clickElement(option);
                    await ns.sleep(50);
                }
            }
        }

        const button = rewardButton();
        if (button && !button.disabled && isTargetFactionSelected())
            return clickElement(button);
        await ns.sleep(50);
    }
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
        if (h4Text.some(text => text.startsWith("Infiltrating ")) &&
            Array.from(doc.querySelectorAll("button")).some(btn => btn.textContent?.trim() === "Start")) return "start";
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

async function getInfiltrationRuntimeState(ns) {
    const raw = await getNsDataThroughFile(ns, `(() => {
        const doc = eval("document");
        const wnd = eval("window");
        const bodyText = doc.body?.innerText || "";
        const h4Text = Array.from(doc.querySelectorAll("h4")).map(el => el.textContent?.trim() || "");
        let uiState = "other";
        if (bodyText.includes("Infiltration was cancelled because you were hospitalized")) uiState = "hospitalized";
        else if (h4Text.some(text => text.toLowerCase() === "infiltration successful!")) uiState = "success";
        else if (h4Text.some(text => text.startsWith("Infiltrating ")) &&
            Array.from(doc.querySelectorAll("button")).some(btn => btn.textContent?.trim() === "Start")) uiState = "start";
        else if (bodyText.includes("Type it backward")) uiState = "running";
        else if (bodyText.includes("Enter the Code!")) uiState = "running";
        else if (bodyText.includes("Close the brackets.")) uiState = "running";
        else if (bodyText.includes("Slash when his guard is down!")) uiState = "running";
        else if (bodyText.includes("Remember all the mines!")) uiState = "running";
        else if (bodyText.includes("Mark all the mines!")) uiState = "running";
        else if (bodyText.includes("Say something nice about the guard.")) uiState = "running";
        else if (bodyText.includes("Match the symbols!")) uiState = "running";
        else if (bodyText.includes("Cut the wires with the following properties!")) uiState = "running";
        else if (bodyText.includes("Enter the Code")) uiState = "running";
        else if (bodyText.includes("Maximum clearance level:")) uiState = "running";

        let playerHasInfiltration = null;
        try {
            let req = wnd.__bbWebpackRequire;
            if (!req && wnd.webpackChunkbitburner) {
                wnd.webpackChunkbitburner.push([[Symbol("infiltration-runner-runtime-state")], {}, (r) => { req = r; }]);
                wnd.__bbWebpackRequire = req;
            }
            const { Player } = req("./src/Player.ts");
            playerHasInfiltration = !!Player?.infiltration;
        } catch {
            playerHasInfiltration = null;
        }

        return JSON.stringify({ uiState, playerHasInfiltration });
    })()`, '/Temp/infiltration-runtime-state.txt');
    try {
        return typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
        return { uiState: 'other', playerHasInfiltration: null };
    }
}

async function waitForInfiltrationIdle(ns, timeout = infiltrationTeardownTimeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        const state = await getInfiltrationRuntimeState(ns);
        const infiltrationActive = state?.playerHasInfiltration === true;
        const uiBusy = ["running", "start", "success", "hospitalized"].includes(state?.uiState);
        if (!infiltrationActive && !uiBusy) return true;
        await ns.sleep(50);
    }
    return false;
}

function clearInfiltrationActiveLock(ns) {
    ns.rm(infiltrationActiveLockFile);
}
