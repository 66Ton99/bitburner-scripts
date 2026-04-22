import { log, getErrorInfo, getFilePath } from './helpers.js'

const supportedGames = ['blackjack', 'roulette'];

export function autocomplete(data, args) {
    const lastFlag = args.length > 1 ? args[args.length - 2] : null;
    if (lastFlag === '--game')
        return supportedGames;
    return [];
}

function getSelectedGame(rawArgs) {
    for (let i = 0; i < rawArgs.length; i++) {
        if (rawArgs[i] !== '--game')
            continue;
        const value = rawArgs[i + 1];
        return typeof value === 'string' ? value : 'blackjack';
    }
    return 'blackjack';
}

function removeGameArg(rawArgs) {
    const forwardedArgs = [];
    for (let i = 0; i < rawArgs.length; i++) {
        if (rawArgs[i] === '--game') {
            i++;
            continue;
        }
        forwardedArgs.push(rawArgs[i]);
    }
    return forwardedArgs;
}

function filterArgsForGame(game, rawArgs) {
    const allowedFlags = game === 'roulette' ? new Set([
        '--click-sleep-time',
        '--find-sleep-time',
        '--enable-logging',
        '--training-bet',
        '--kill-all-scripts',
        '--no-deleting-remote-files',
        '--on-completion-script',
        '--on-completion-script-args',
    ]) : null;
    const forwardedArgs = removeGameArg(rawArgs);
    if (!allowedFlags)
        return forwardedArgs;
    const filteredArgs = [];
    for (let i = 0; i < forwardedArgs.length; i++) {
        const arg = forwardedArgs[i];
        if (typeof arg !== 'string' || !arg.startsWith('--')) {
            filteredArgs.push(arg);
            continue;
        }
        if (!allowedFlags.has(arg)) {
            i++;
            continue;
        }
        filteredArgs.push(arg);
        if (i + 1 < forwardedArgs.length && !(typeof forwardedArgs[i + 1] === 'string' && forwardedArgs[i + 1].startsWith('--')))
            filteredArgs.push(forwardedArgs[++i]);
    }
    return filteredArgs;
}

export async function checkForKickedOut(tryfindElement, click, ns = null, retries = 10) {
    let closeModal;
    do {
        const kickedOut = await tryfindElement(
            "//*[contains(normalize-space(.), 'Alright cheater get out of here') and contains(normalize-space(.), 'not allowed here anymore')]",
            retries);
        if (kickedOut !== null) return true;
        closeModal = await tryfindElement("//button[contains(@class,'closeButton')]", retries);
        if (!closeModal) break;
        if (ns) log(ns, "Found a modal that needs to be closed.");
        await click(closeModal);
    } while (closeModal !== null);
    return false;
}

export async function findCasinoSaveButton(findRequiredElement) {
    return await findRequiredElement("//button[@aria-label = 'save game']", 100,
        `Sorry, couldn't find the Overview Save (💾) button. Is your "Overview" panel collapsed or modded?`, true);
}

export async function saveCasinoGame(ns, click, btnSaveGame, saveSleepTime = 0) {
    if (saveSleepTime) await ns.sleep(saveSleepTime);
    await click(btnSaveGame);
    if (saveSleepTime) await ns.sleep(saveSleepTime);
}

export async function ensureInAevum(ns, click, findRequiredElement, travelToAevum = null) {
    if (ns.getPlayer().city === "Aevum")
        return;
    if (ns.getPlayer().money < 200000)
        throw new Error("Sorry, you need at least 200k to travel to the casino.");

    let travelled = false;
    if (travelToAevum) {
        try { travelled = await travelToAevum(); } catch { }
    } else {
        try { travelled = await ns.singularity.travelToCity("Aevum"); } catch { }
    }

    if (!travelled) {
        await click(await findRequiredElement("//div[@role='button' and ./div/p/text()='Travel']"));
        await click(await findRequiredElement("//span[contains(@class,'travel') and ./text()='A']"));
        const confirm = await findRequiredElement("//button[p/text()='Travel']", 5);
        if (confirm)
            await click(confirm);
    }

    if (ns.getPlayer().city !== "Aevum")
        throw new Error(`We thought we travelled to Aevum, but we're apparently still in ${ns.getPlayer().city}...`);
}

export async function navigateToCasino(ns, click, findRequiredElement, goToCasino = null) {
    let success = false;
    if (goToCasino) {
        try { success = await goToCasino(); } catch { }
    } else {
        try { success = await ns.singularity.goToLocation("Iker Molina Casino"); } catch { }
    }
    if (!success) {
        await click(await findRequiredElement("//div[(@role = 'button') and (contains(., 'City'))]", 15,
            `Couldn't find the "🏙 City" menu button. Is your "World" nav menu collapsed?`));
        await click(await findRequiredElement("//span[@aria-label = 'Iker Molina Casino']"));
    }
}

export async function openCasinoGame(click, findRequiredElement, gameButtonText, retries = 15) {
    await click(await findRequiredElement(`//button[contains(text(), '${gameButtonText}')]`, retries));
}

/** @param {NS} ns **/
export async function main(ns) {
    const game = getSelectedGame(ns.args);
    const gameScript = game === 'blackjack' ? 'casino-blackjack.js' :
        game === 'roulette' ? 'casino-roulette.js' : null;
    if (gameScript) {
        const pid = ns.run(getFilePath(gameScript), 1, ...filterArgsForGame(game, ns.args));
        if (!pid)
            log(ns, `ERROR: Failed to launch ${gameScript} from casino.js.`, true, 'error');
        return;
    }

    log(ns, `ERROR: Unsupported casino game "${game}". Supported values: ${supportedGames.join(', ')}`, true, 'error');
}
