// This script is awesome and will autocomplete the infiltrate tasks in BitBurner.
// This was copied from https://github.com/5p0ng3b0b/bitburner-scripts/blob/main/autoinfiltrate.js and modified.
// Type "wget https://https://raw.githubusercontent.com/66Ton99/bitburner-scripts/refs/heads/main/infiltrate.js infiltrate.js" from you home terminal to download.
// Type 'run autoinfiltrate.js' from home terminal. options are --start --stop --quiet although the --start option is not required.
// Try always running it via an alias eg 'alias autoinfil="run autoinfiltrate.js --stop --quiet; run autoinfiltrate.js --quiet""
// Once the script is running, It will activate when you visit any company and click the infiltrate button.
// You can use infiltrate to quickly get alot of money early in the game or quickly earn rep for any faction.
// ecorp in Aevum is the highest earner followed by megacorp in sector-12 and then KuaiGong International in Chongqing.

import { devConsole } from './helpers.js';

const AUTOINFIL_VERSION = "autoinfil-2026-04-17-10";
const blankScreenObservationThreshold = 8;

const state = {
	// Name of the company that's infiltrated.
	company: "",

	// Whether infiltration started. False means, we're
	// waiting to arrive on the infiltration screen.
	started: false,

	// Details/state of the current mini game.
	// Is reset after every game.
	game: {},
};

function debugGame(message, data = undefined) {
	if (!isInfiltrateLoggingEnabled()) {
		return;
	}
	const signature = data === undefined ? message : `${message}|${typeof data === "string" ? data : JSON.stringify(data)}`;
	if (state.game.lastDebugSignature === signature) {
		state.game.lastDebugRepeatCount = (state.game.lastDebugRepeatCount || 0) + 1;
		return;
	}
	if (state.game.lastDebugRepeatCount > 0) {
		devConsole("log", "Infiltration debug:", "repeated", JSON.stringify({
			message: state.game.lastDebugSignature,
			count: state.game.lastDebugRepeatCount,
		}));
	}
	state.game.lastDebugSignature = signature;
	state.game.lastDebugRepeatCount = 0;
	if (data === undefined) devConsole("log", "Infiltration debug:", message);
	else devConsole("log", "Infiltration debug:", message, data);
}

function canSendForObservedProgress(progressKey, observedValue) {
	const observedKey = `${progressKey}Observed`;
	const pendingKey = `${progressKey}Pending`;
	const repeatsKey = `${progressKey}Repeats`;
	if (state.game[observedKey] !== observedValue) {
		state.game[observedKey] = observedValue;
		state.game[repeatsKey] = 0;
		delete state.game[pendingKey];
		return true;
	}
	state.game[repeatsKey] = (state.game[repeatsKey] || 0) + 1;
	if (!state.game[pendingKey]) {
		return true;
	}
	return state.game[repeatsKey] >= 2;
}

function markProgressSend(progressKey, observedValue, sentValue = observedValue) {
	state.game[`${progressKey}Observed`] = observedValue;
	state.game[`${progressKey}Pending`] = sentValue;
	state.game[`${progressKey}Repeats`] = 0;
	state.game.lastProgressTick = state.game.loopCount || 0;
}

function markGameComplete(reason) {
	if (state.game.completed) {
		return;
	}
	state.game.completed = true;
	state.game.completeReason = reason;
	state.game.completedTick = state.game.loopCount || 0;
	debugGame("game complete", JSON.stringify({
		game: state.game.current || null,
		reason,
	}));
}

function summarizeGameState() {
	const summary = {};
	for (const [key, value] of Object.entries(state.game)) {
		if (value == null) continue;
		if (["lastTitle", "lastVisibleTick", "lastInputTick", "lastProgressTick", "lastStallLogTick", "lastCountdownToken", "missingScreenLoops", "loopCount", "pendingTitleRepeats"].includes(key)) {
			continue;
		}
		if (Array.isArray(value)) {
			summary[key] = value.length > 12 ? { length: value.length, head: value.slice(0, 12) } : value;
		} else if (typeof value === "object") {
			summary[key] = "[object]";
		} else {
			summary[key] = value;
		}
	}
	return summary;
}

function maybeLogGameStall(title, runtimeStageName) {
	const nowTick = state.game.loopCount || 0;
	const lastActivityTick = Math.max(
		state.game.lastProgressTick || 0,
		state.game.lastInputTick || 0,
		state.game.lastVisibleTick || 0,
	);
	if (!lastActivityTick || nowTick - lastActivityTick < 15) {
		return;
	}
	if (state.game.lastStallLogTick && nowTick - state.game.lastStallLogTick < 25) {
		return;
	}
	state.game.lastStallLogTick = nowTick;
	debugGame("game stall", JSON.stringify({
		game: state.game.current || null,
		title: title || null,
		stage: runtimeStageName || null,
		sinceTicks: nowTick - lastActivityTick,
		state: summarizeGameState(),
	}));
}

// Speed of game actions, in milliseconds.
// Keep this conservative enough that the live client has time to commit state changes
// between inputs, especially on long ECorp infiltrations.
const baseSpeed = 40;
const extraInputDelay = 0;
const speed = baseSpeed + extraInputDelay;

// Small hack to save RAM.
// This will work smoothly, because the script does not use
// any "ns" functions, it's a pure browser automation tool.
const wnd = eval("window");
const doc = wnd["document"];
const INFILTRATE_LOGS_DEFAULT = false;

function isInfiltrateLoggingEnabled() {
	return Boolean(wnd.__autoinfilLogs ?? INFILTRATE_LOGS_DEFAULT);
}

function logInfo(...args) {
	if (!isInfiltrateLoggingEnabled()) {
		return;
	}
	devConsole("log", ...args);
}

function logError(...args) {
	devConsole("error", ...args);
}

// List of all games and an automated solver.
const infiltrationGames = [
	{
		name: "type it",
		init: function (screen) {
			const runtimeStage = getRuntimeInfiltrationStage();
			if (runtimeStage?.constructor?.name === "BackwardModel" && typeof runtimeStage.answer === "string") {
				state.game.data = runtimeStage.answer.split("");
				debugGame("type it init", state.game.data.join(""));
				return;
			}
			const lines = getLines(getEl(screen, "p"));
			state.game.data = lines[0].split("");
			debugGame("type it init", state.game.data.join(""));
		},
		play: function (screen) {
			const runtimeStage = getRuntimeInfiltrationStage();
			if (runtimeStage?.constructor?.name === "BackwardModel" && typeof runtimeStage.answer === "string") {
				const guess = typeof runtimeStage.guess === "string" ? runtimeStage.guess : "";
				const progress = guess.length;
				if (progress >= runtimeStage.answer.length) {
					return;
				}
				if (!canSendForObservedProgress("runtimeProgress", progress)) {
					return;
				}
				const nextChar = runtimeStage.answer[progress];
				markProgressSend("runtimeProgress", progress, nextChar);
				pressKey(nextChar);
				return;
			}
			if (!state.game.data || !state.game.data.length) {
				markGameComplete("type it local data exhausted");
				delete state.game.data;
				return;
			}
			pressKey(state.game.data.shift());
		},
	},	
	{
		name: "type it backward",
		init: function (screen) {
			const runtimeStage = getRuntimeInfiltrationStage();
			if (runtimeStage?.constructor?.name === "BackwardModel" && typeof runtimeStage.answer === "string") {
				state.game.data = runtimeStage.answer.split("");
				debugGame("type it backward init", state.game.data.join(""));
				return;
			}
			const lines = getLines(getEl(screen, "p"));
			state.game.data = lines[0].split("");
			debugGame("type it backward init", state.game.data.join(""));
		},
		play: function (screen) {
			const runtimeStage = getRuntimeInfiltrationStage();
			if (runtimeStage?.constructor?.name === "BackwardModel" && typeof runtimeStage.answer === "string") {
				const guess = typeof runtimeStage.guess === "string" ? runtimeStage.guess : "";
				const progress = guess.length;
				if (progress >= runtimeStage.answer.length) {
					return;
				}
				if (!canSendForObservedProgress("runtimeProgress", progress)) {
					return;
				}
				const nextChar = runtimeStage.answer[progress];
				markProgressSend("runtimeProgress", progress, nextChar);
				pressKey(nextChar);
				return;
			}
			if (!state.game.data || !state.game.data.length) {
				markGameComplete("type it backward local data exhausted");
				delete state.game.data;
				return;
			}
			pressKey(state.game.data.shift());
		},
	},
	{
		name: "enter the code",
		init: function (screen) {
			state.game.lastCode = null;
		},
		play: function (screen) {
			const runtimeStage = getRuntimeInfiltrationStage();
			if (runtimeStage?.constructor?.name === "CheatCodeModel" && Array.isArray(runtimeStage.code)) {
				const progress = runtimeStage.index ?? 0;
				if (progress >= runtimeStage.code.length) {
					return;
				}
				const runtimeCode = runtimeStage.code[progress];
				const runtimeArrow = ["↑", "↓", "←", "→"].includes(runtimeCode) ? runtimeCode : null;
				if (!runtimeArrow) {
					return;
				}
				if (!canSendForObservedProgress("runtimeProgress", progress)) {
					return;
				}
				markProgressSend("runtimeProgress", progress, runtimeArrow);

				switch (runtimeArrow) {
					case "↑":
						debugGame("enter the code", "up");
						pressKey("w");
						break;
					case "↓":
						debugGame("enter the code", "down");
						pressKey("s");
						break;
					case "←":
						debugGame("enter the code", "left");
						pressKey("a");
						break;
					case "→":
						debugGame("enter the code", "right");
						pressKey("d");
						break;
				}
				return;
			}
			const spanElements = screen.querySelectorAll("span");
			// Adjust for SoA - Trickery of Hermes augmentation
			// Only the active arrow is rendered without the dimmed opacity style.
			// Older solved arrows and unrelated progress spans remain in the DOM.
			const code = Array.from(spanElements)
				.filter(span => ["↑", "↓", "←", "→"].includes(span.textContent?.trim()))
				.filter(span => !span.attributes.style || !span.attributes.style.textContent.includes("opacity: 0.4"))
				.map(span => span.textContent?.trim())
				.find(text => ["↑", "↓", "←", "→"].includes(text))
				?? Array.from(spanElements)
					.map(span => span.textContent?.trim())
					.find(text => ["↑", "↓", "←", "→"].includes(text));
			if (!code || state.game.lastCode === code) {
				return;
			}
			state.game.lastCode = code;

			switch (code) {
				case "↑":
					debugGame("enter the code", "up");
					pressKey("w");
					break;
				case "↓":
					debugGame("enter the code", "down");
					pressKey("s");
					break;
				case "←":
					debugGame("enter the code", "left");
					pressKey("a");
					break;
				case "→":
					debugGame("enter the code", "right");
					pressKey("d");
					break;
			}
		},
	},
	{
		name: "close the brackets",
		init: function (screen) {
			const runtimeStage = getRuntimeInfiltrationStage();
			if (runtimeStage?.constructor?.name === "BracketModel" && typeof runtimeStage.left === "string") {
				state.game.data = [];
				for (let i = runtimeStage.left.length - 1; i >= 0; i--) {
					const char = runtimeStage.left[i];
					if ("<" == char) state.game.data.push(">");
					else if ("(" == char) state.game.data.push(")");
					else if ("{" == char) state.game.data.push("}");
					else if ("[" == char) state.game.data.push("]");
				}
				if (typeof runtimeStage.right === "string" && runtimeStage.right.length > 0) {
					state.game.data.splice(0, runtimeStage.right.length);
				}
				debugGame("close the brackets init", state.game.data.join(""));
				return;
			}
			const data = getLines(getEl(screen, "p"));
			const brackets = data.join("").split("");
			state.game.data = [];

			for (let i = brackets.length - 1; i >= 0; i--) {
				const char = brackets[i];

				if ("<" == char) {
					state.game.data.push(">");
				} else if ("(" == char) {
					state.game.data.push(")");
				} else if ("{" == char) {
					state.game.data.push("}");
				} else if ("[" == char) {
					state.game.data.push("]");
				}
			}
			debugGame("close the brackets init", state.game.data.join(""));
		},
		play: function (screen) {
			const runtimeStage = getRuntimeInfiltrationStage();
			if (runtimeStage?.constructor?.name === "BracketModel" && typeof runtimeStage.left === "string") {
				const typed = typeof runtimeStage.right === "string" ? runtimeStage.right.length : 0;
				if (typed >= runtimeStage.left.length) {
					return;
				}
				if (!canSendForObservedProgress("runtimeProgress", typed)) {
					return;
				}
				const char = runtimeStage.left[runtimeStage.left.length - 1 - typed];
				let nextChar = null;
				if ("<" == char) nextChar = ">";
				else if ("(" == char) nextChar = ")";
				else if ("{" == char) nextChar = "}";
				else if ("[" == char) nextChar = "]";
				if (!nextChar) {
					return;
				}
				markProgressSend("runtimeProgress", typed, nextChar);
				pressKey(nextChar);
				return;
			}
			if (!state.game.data || !state.game.data.length) {
				markGameComplete("close the brackets local data exhausted");
				delete state.game.data;
				return;
			}
			pressKey(state.game.data.shift());
		},
	},
	{
		name: "slash when his guard is down",
		init: function (screen) {
			state.game.data = "wait";
		},
		play: function (screen) {
			const runtimeStage = getRuntimeInfiltrationStage();
			if (runtimeStage?.constructor?.name === "SlashModel") {
				if (runtimeStage.phase === 1 && state.game.data !== "done") {
					debugGame("slash when his guard is down", "attack");
					pressKey(" ");
					state.game.data = "done";
				}
				return;
			}
			if (state.game.data === "done") {
				return;
			}
			const text = getLines(getEl(screen, "h4, h5, p")).join(" ").toLowerCase();
			if (text.includes("preparing")) {
				debugGame("slash when his guard is down", "attack");
				pressKey(" ");
				state.game.data = "done";
			}
		},
	},
	{
		name: "guarding",
		init: function (screen) {
			state.game.data = "wait";
		},
		play: function (screen) { /* do nothing */ },
	},
	{
		name: "distracted",
		init: function (screen) {
			state.game.data = "wait";
		},
		play: function (screen) {
			if (state.game.data === "done") {
				return;
			}
			debugGame("distracted", "attack");
			pressKey(" ");
			state.game.data = "done";
		},
	},
	{
		name: "alerted",
		init: function (screen) {
			state.game.data = "wait";
		},
		play: function (screen) { /* do nothing */ },
	},
	{
		name: "say something nice about the guard",
		init: function (screen) { },
		play: function (screen) {
			const runtimeStage = getRuntimeInfiltrationStage();
			if (runtimeStage?.constructor?.name === "BribeModel" && Array.isArray(runtimeStage.choices)) {
				const word = String(runtimeStage.choices[runtimeStage.index] ?? "").trim().toLowerCase();
				debugGame("say something nice about the guard", word);
				if (typeof runtimeStage.correctIndex === "number" && runtimeStage.index === runtimeStage.correctIndex) {
					pressKey(" ");
				} else {
					const choicesLength = runtimeStage.choices.length || 1;
					const upIndex = (runtimeStage.index + 1) % choicesLength;
					const downIndex = (runtimeStage.index - 1 + choicesLength) % choicesLength;
					let upDistance = runtimeStage.correctIndex - upIndex;
					if (upIndex > runtimeStage.correctIndex) {
						upDistance = choicesLength - 1 - upIndex + runtimeStage.correctIndex;
					}
					let downDistance = downIndex - runtimeStage.correctIndex;
					if (downIndex < runtimeStage.correctIndex) {
						downDistance = downIndex + choicesLength - 1 - runtimeStage.correctIndex;
					}
					pressKey(upDistance <= downDistance ? "w" : "s");
				}
				return;
			}
			const correct = [
				"affectionate",
				"agreeable",
				"bright",
				"charming",
				"creative",
				"determined",
				"energetic",
				"friendly",
				"funny",
				"generous",
				"polite",
				"likable",
				"diplomatic",
				"helpful",
				"giving",
				"kind",
				"hardworking",
				"patient",
				"dynamic",
				"loyal",
				"based",
				"straightforward"
			];
			const word = (getLines(getEl(screen, "h5"))[1] || "").trim().toLowerCase();
			debugGame("say something nice about the guard", word);

			if (-1 !== correct.indexOf(word)) {
				pressKey(" ");
			} else {
				pressKey("w");
			}
		},
	},
	{
		name: "remember all the mines",
		init: function (screen) {
			const runtimeStage = getRuntimeInfiltrationStage();
			if (runtimeStage?.constructor?.name === "MinesweeperModel" && Array.isArray(runtimeStage.minefield)) {
				state.game.data = runtimeStage.minefield.map((row) => [...row]);
				debugGame("remember all the mines init", JSON.stringify(state.game.data));
				return;
			}
			const rows = getEl(screen, "p");
			let gridSize = null;
			switch (rows.length) {
				case 9:
					gridSize = [3, 3];
					break;
				case 12:
					gridSize = [3, 4];
					break;
				case 16:
					gridSize = [4, 4];
					break;
				case 20:
					gridSize = [4, 5];
					break;
				case 25:
					gridSize = [5, 5];
					break;
				case 30:
					gridSize = [5, 6];
					break;
				case 36:
					gridSize = [6, 6];
					break;
			}
			if (gridSize == null) {
				return;
			}
			//12 20 30 42
			state.game.data = [];
			let index = 0;
			//for each row
			for (let y = 0; y < gridSize[1]; y++) {
				//initialize array data
				state.game.data[y] = [];
				for (let x = 0; x < gridSize[0]; x++) {
					//for each column in the row add to state data if it has a child
					if (rows[index].children.length > 0) {
						state.game.data[y].push(true);
					} else state.game.data[y].push(false);
					index += 1;
				}
			}
			debugGame("remember all the mines init", JSON.stringify(state.game.data));
		},
		play: function (screen) { },
	},
	{
		name: "mark all the mines",
		init: function (screen) {
			const runtimeStage = getRuntimeInfiltrationStage();
			if ((!Array.isArray(state.game.data) || !state.game.data.length) &&
				runtimeStage?.constructor?.name === "MinesweeperModel" &&
				Array.isArray(runtimeStage.minefield) &&
				runtimeStage.minefield.length) {
				state.game.data = runtimeStage.minefield.map(row => Array.isArray(row) ? [...row] : []);
			}
			if (!Array.isArray(state.game.data) || !state.game.data.length || !Array.isArray(state.game.data[0])) {
				state.game.data = [];
				state.game.x = 0;
				state.game.y = 0;
				state.game.cols = 0;
				state.game.dir = 1;
				state.game.target = null;
				debugGame("mark all the mines init", "waiting for minefield");
				return;
			}
			state.game.x = 0;
			state.game.y = 0;
			state.game.cols = state.game.data[0].length;
			state.game.dir = 1;
			state.game.target = null;
			debugGame("mark all the mines init", JSON.stringify(state.game.data));
		},
		play: function (screen) {
			const runtimeStage = getRuntimeInfiltrationStage();
			if (runtimeStage?.constructor?.name === "MinesweeperModel" && Array.isArray(runtimeStage.minefield) && Array.isArray(runtimeStage.answer)) {
				const minefield = runtimeStage.minefield;
				const answer = runtimeStage.answer;
				const width = minefield[0]?.length ?? 0;
				const height = minefield.length;
				const x = runtimeStage.x ?? 0;
				const y = runtimeStage.y ?? 0;

				if (!width || !height || runtimeStage.memoryPhase) {
					return;
				}

				if (minefield[y]?.[x] && !answer[y]?.[x]) {
					debugGame("mark all the mines", `mark ${x},${y}`);
					pressKey(" ");
					state.game.target = null;
					return;
				}

				const currentTarget = state.game.target;
				const target = currentTarget &&
					minefield[currentTarget[1]]?.[currentTarget[0]] &&
					!answer[currentTarget[1]]?.[currentTarget[0]]
					? currentTarget
					: findNextMinesweeperTarget(minefield, answer, x, y, width, height);
				if (!target) {
					state.game.target = null;
					return;
				}
				state.game.target = target;

				const [toX, toY] = target;
				const rightDistance = (toX - x + width) % width;
				const leftDistance = (x - toX + width) % width;
				const downDistance = (toY - y + height) % height;
				const upDistance = (y - toY + height) % height;

				debugGame("mark all the mines target", `${toX},${toY}`);

				if (y !== toY) {
					pressKey(downDistance <= upDistance ? "s" : "w");
				} else if (x !== toX) {
					pressKey(rightDistance <= leftDistance ? "d" : "a");
				}
				return;
			}

			let { data, x, y, cols, dir } = state.game;
			if (!Array.isArray(data) || !data.length || !Array.isArray(data[0]) || !cols) {
				return;
			}

			if (data[y][x]) {
				debugGame("mark all the mines", `mark ${x},${y}`);
				pressKey(" ");
				data[y][x] = false;
			}

			x += dir;

			if (x < 0 || x >= cols) {
				x = Math.max(0, Math.min(cols - 1, x));
				y++;
				dir *= -1;
				pressKey("s");
			} else {
				pressKey(dir > 0 ? "d" : "a");
			}

			state.game.data = data;
			state.game.x = x;
			state.game.y = y;
			state.game.dir = dir;
		},
	},
	{
		name: "match the symbols",
		init: function (screen) {
			const runtimeStage = getRuntimeInfiltrationStage();
			if (runtimeStage?.constructor?.name === "Cyberpunk2077Model" && Array.isArray(runtimeStage.grid) && Array.isArray(runtimeStage.answers)) {
				state.game.data = runtimeStage.answers.map((symbol) => {
					for (let y = 0; y < runtimeStage.grid.length; y++) {
						for (let x = 0; x < runtimeStage.grid[y].length; x++) {
							if (runtimeStage.grid[y][x] === symbol) {
								return [y, x];
							}
						}
					}
					return null;
				}).filter(Boolean);
				state.game.x = runtimeStage.x ?? 0;
				state.game.y = runtimeStage.y ?? 0;
				debugGame("match the symbols init", JSON.stringify(state.game.data));
				return;
			}
			const data = getLines(getEl(screen, "h5 span"));
			const rows = getLines(getEl(screen, "p"));
			const keypad = [];
			const targets = [];
			let gridSize = null;
			switch (rows.length) {
				case 9:
					gridSize = [3, 3];
					break;
				case 12:
					gridSize = [3, 4];
					break;
				case 16:
					gridSize = [4, 4];
					break;
				case 20:
					gridSize = [4, 5];
					break;
				case 25:
					gridSize = [5, 5];
					break;
				case 30:
					gridSize = [5, 6];
					break;
				case 36:
					gridSize = [6, 6];
					break;
			}
			if (gridSize == null) {
				return;
			}
			//build the keypad grid.
			let index = 0;
			for (let i = 0; i < gridSize[1]; i++) {
				keypad[i] = [];
				for (let y = 0; y < gridSize[0]; y++) {

					keypad[i].push(rows[index]);
					index += 1;
				}
			}
			//foreach data get coords of keypad entry
			for (let i = 0; i < data.length; i++) {
				const symbol = data[i].trim();
				//for each keypad entry
				for (let j = 0; j < keypad.length; j++) {
					const k = keypad[j].indexOf(symbol);

					if (-1 !== k) {
						targets.push([j, k]);
						break;
					}
				}
			}
			state.game.data = targets;
			state.game.x = 0;
			state.game.y = 0;
			debugGame("match the symbols init", JSON.stringify(targets));
		},
		play: function (screen) {
			const runtimeStage = getRuntimeInfiltrationStage();
			if (runtimeStage?.constructor?.name === "Cyberpunk2077Model" && Array.isArray(runtimeStage.answers) && Array.isArray(runtimeStage.grid)) {
				const currentAnswerIndex = runtimeStage.currentAnswerIndex ?? 0;
				const targetSymbol = runtimeStage.answers[currentAnswerIndex];
				if (!targetSymbol) {
					return;
				}

				let toX = -1;
				let toY = -1;
				for (let y = 0; y < runtimeStage.grid.length; y++) {
					for (let x = 0; x < runtimeStage.grid[y].length; x++) {
						if (runtimeStage.grid[y][x] === targetSymbol) {
							toX = x;
							toY = y;
							break;
						}
					}
					if (toX !== -1) {
						break;
					}
				}

				if (toX === -1 || toY === -1) {
					return;
				}

				const x = runtimeStage.x ?? 0;
				const y = runtimeStage.y ?? 0;
				const progressToken = `${currentAnswerIndex}:${x},${y}`;
				if (!canSendForObservedProgress("runtimeProgress", progressToken)) {
					return;
				}
				debugGame("match the symbols state", {
					index: currentAnswerIndex,
					x,
					y,
					targetX: toX,
					targetY: toY,
					targetSymbol,
				});

				if (toY < y) {
					markProgressSend("runtimeProgress", progressToken, "w");
					pressKey("w");
				} else if (toY > y) {
					markProgressSend("runtimeProgress", progressToken, "s");
					pressKey("s");
				} else if (toX < x) {
					markProgressSend("runtimeProgress", progressToken, "a");
					pressKey("a");
				} else if (toX > x) {
					markProgressSend("runtimeProgress", progressToken, "d");
					pressKey("d");
				} else {
					debugGame("match the symbols select", {
						index: currentAnswerIndex,
						x,
						y,
						targetSymbol,
					});
					markProgressSend("runtimeProgress", progressToken, " ");
					pressKey(" ");
				}
				return;
			}

			const target = state.game.data[0];
			let { x, y } = state.game;

			if (!target) {
				return;
			}

			const to_y = target[0];
			const to_x = target[1];
			debugGame("match the symbols target", `${to_x},${to_y}`);

			if (to_y < y) {
				y--;
				pressKey("w");
			} else if (to_y > y) {
				y++;
				pressKey("s");
			} else if (to_x < x) {
				x--;
				pressKey("a");
			} else if (to_x > x) {
				x++;
				pressKey("d");
			} else {
				pressKey(" ");
				state.game.data.shift();
			}

			state.game.x = x;
			state.game.y = y;
		},
	},
	{
		name: "cut the wires with the following properties",
		init: function (screen) {
			const runtimeStage = getRuntimeInfiltrationStage();
			if (runtimeStage?.constructor?.name === "WireCuttingModel" && runtimeStage.wiresToCut instanceof Set) {
				state.game.data = [...runtimeStage.wiresToCut].map(index => index + 1).sort((a, b) => a - b);
				debugGame("cut the wires init", JSON.stringify(state.game.data));
				return;
			}
			state.game.data = getRemainingFallbackWireTargets(screen);
			debugGame("cut the wires init", JSON.stringify(state.game.data));
		},
		play: function (screen) {
			const runtimeStage = getRuntimeInfiltrationStage();
			const isRuntimeWireStage = runtimeStage?.constructor?.name === "WireCuttingModel";
			const runtimeWireTargets = isRuntimeWireStage && runtimeStage.wiresToCut instanceof Set
				? [...runtimeStage.wiresToCut].map(index => index + 1)
				: null;
			if (isRuntimeWireStage && runtimeStage.wiresToCut instanceof Set) {
				debugGame("cut the wires runtime", JSON.stringify({
					remaining: runtimeStage.wiresToCut.size,
					targets: [...runtimeStage.wiresToCut].map(index => index + 1).sort((a, b) => a - b),
				}));
				const remaining = runtimeStage.wiresToCut.size;
				if (remaining === 0) {
					return;
				}
				if (!canSendForObservedProgress("runtimeProgress", remaining)) {
					return;
				}
				const nextWire = [...runtimeStage.wiresToCut].map(index => index + 1).sort((a, b) => a - b)[0];
				if (nextWire == null) {
					return;
				}
				markProgressSend("runtimeProgress", remaining, nextWire);
				pressKey(nextWire.toString());
				return;
			}
			if (isRuntimeWireStage) {
				debugGame("cut the wires runtime", "waiting for wiresToCut");
				return;
			}
			if (state.game.data === "done") {
				debugGame("cut the wires fallback", JSON.stringify({
					state: "done",
					data: null,
				}));
				return;
			}
			const observedWireTargets = getRemainingFallbackWireTargets(screen);
			if (!Array.isArray(state.game.data)) {
				state.game.data = observedWireTargets;
			}
			const wire = Array.isArray(state.game.data) ? state.game.data : observedWireTargets;
			if (!wire) {
				debugGame("cut the wires fallback", JSON.stringify({
					state: "empty",
					data: null,
				}));
				return;
			}
			debugGame("cut the wires fallback", JSON.stringify({
				data: Array.isArray(wire) ? wire : null,
				observed: Array.isArray(observedWireTargets) ? observedWireTargets : null,
			}));
			if (!wire.length) {
				markGameComplete("cut the wires local data exhausted");
				state.game.data = "done";
				return;
			}
			debugGame("cut the wires send", wire[0]);
			pressKey(wire[0].toString());
			state.game.data = wire.slice(1);
		},
	},
];

const runtimeStageToGameName = {
	BackwardModel: "type it backward",
	BracketModel: "close the brackets",
	BribeModel: "say something nice about the guard",
	CheatCodeModel: "enter the code",
	Cyberpunk2077Model: "match the symbols",
	MinesweeperModel: null,
	SlashModel: null,
	WireCuttingModel: "cut the wires with the following properties",
};

function getWireCuttingDomState(screen) {
	const lines = getEl(screen, "p");
	if (!lines.length) {
		return null;
	}
	let wireCount = 0;
	while (wireCount < lines.length && /^\d+$/.test(lines[wireCount].textContent?.trim() || "")) {
		wireCount++;
	}
	if (!wireCount) {
		return null;
	}
	const wireRows = [];
	for (let row = 0; row < 11; row++) {
		const rowData = [];
		for (let col = 0; col < wireCount; col++) {
			const node = lines[wireCount + row * wireCount + col];
			rowData.push(node?.textContent?.trim() || "");
		}
		wireRows.push(rowData);
	}
	const cutWires = Array.from({ length: wireCount }, (_, index) => wireRows[3]?.[index] === "" || wireRows[4]?.[index] === "");
	return { wireCount, cutWires };
}

function getRemainingFallbackWireTargets(screen) {
	const hookTargets = callAutoinfTestHook("getRemainingFallbackWireTargets", {
		screen,
		game: state.game.current || null,
		data: Array.isArray(state.game.data) ? [...state.game.data] : state.game.data,
	});
	if (hookTargets !== undefined) {
		return hookTargets;
	}
	let numberHack = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];
	const colors = {
		red: "red",
		white: "white",
		blue: "blue",
		"rgb(255, 193, 7)": "yellow",
	};
	const wireColor = {
		red: [],
		white: [],
		blue: [],
		yellow: [],
	};
	let instructions = [];
	for (const child of screen.children) instructions.push(child);
	const wiresData = instructions.pop();
	instructions.shift();
	instructions = getLines(instructions);
	const samples = getEl(wiresData, "p");
	const wires = [];
	let wireCount = 0;
	for (let i = wireCount; i < samples.length; i++) {
		if (numberHack.includes(samples[i].innerText)) wireCount += 1;
		else break;
	}
	let index = 0;
	for (let i = 0; i < 3; i++) {
		for (let j = 0; j < wireCount; j++) {
			const node = samples[index];
			const color = colors[node.style.color];
			if (color) {
				wireColor[color].push(j + 1);
			}
			index += 1;
		}
	}
	for (let i = 0; i < instructions.length; i++) {
		const line = instructions[i].trim().toLowerCase();
		if (!line || line.length < 10) continue;
		const numberMatch = line.match(/^cut wire number\s+(\d+)\.?$/);
		if (numberMatch) {
			wires.push(parseInt(numberMatch[1], 10));
			continue;
		}
		const colorMatch = line.match(/^cut all wires colored\s+([a-z]+)\.?$/);
		if (colorMatch) {
			const color = colorMatch[1];
			if (wireColor[color]) wireColor[color].forEach((num) => wires.push(num));
		}
	}
	const domState = getWireCuttingDomState(screen);
	const uniqueWires = [...new Set(wires)].sort((a, b) => a - b);
	debugGame("cut the wires parsed rules", JSON.stringify({
		instructions,
		targets: uniqueWires,
	}));
	if (!domState) {
		return uniqueWires;
	}
	return uniqueWires.filter((wireNumber) => !domState.cutWires[wireNumber - 1]);
}

function findNextMinesweeperTarget(minefield, answer, startX, startY, width, height) {
	let bestTarget = null;
	let bestDistance = Infinity;

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			if (!minefield[y]?.[x] || answer[y]?.[x]) {
				continue;
			}
			const dx = Math.abs(x - startX);
			const dy = Math.abs(y - startY);
			const wrappedDx = Math.min(dx, width - dx);
			const wrappedDy = Math.min(dy, height - dy);
			const distance = wrappedDx + wrappedDy;
			if (distance < bestDistance) {
				bestDistance = distance;
				bestTarget = [x, y];
			}
		}
	}

	return bestTarget;
}

/** @param {NS} ns **/
export async function main(ns) {
	const args = ns.flags([
		["start", false],
		["stop", false],
		["status", false],
		["quiet", false],
	]);

	function print(msg) {
		if (!args.quiet) {
			ns.tprint(`\n${msg}\n`);
		}
	}

	if (args.status) {
		if (wnd.tmrAutoInf) {
			print("Automated infiltration is active");
		} else {
			print("Automated infiltration is inactive");
		}
		return;
	}

	if (wnd.tmrAutoInf) {
		print("Stopping automated infiltration...");
		clearInterval(wnd.tmrAutoInf);
		delete wnd.tmrAutoInf;
	}

	if (args.stop) {
		return;
	}

	print(
		"Automated infiltration is enabled...\nWhen you visit the infiltration screen of any company, all tasks are completed automatically."
	);
	logInfo("Auto infiltration version:", AUTOINFIL_VERSION);

	endInfiltration();

	// Monitor the current screen and start infiltration once a
	// valid screen is detected.
	wnd.tmrAutoInf = setInterval(infLoop, speed);

	// Modify the addEventListener logic.
	wrapEventListeners();
}

/**
 * The infiltration loop, which is called at a rapid interval
 */
function infLoop() {
	if (!state.started) {
		waitForStart();
	} else {
		playGame();
	}
}

/**
 * Returns a list of DOM elements from the main game
 * container.
 */
function getEl(parent, selector) {
	let prefix = ":scope";

	if ("string" === typeof parent) {
		selector = parent;
		parent = doc;

		prefix = ".MuiBox-root>.MuiBox-root>.MuiBox-root";

		if (!doc.querySelectorAll(prefix).length) {
			prefix = ".MuiBox-root>.MuiBox-root>.MuiGrid-root";
		}
		if (!doc.querySelectorAll(prefix).length) {
			prefix = ".MuiContainer-root>.MuiPaper-root";
		}
		if (!doc.querySelectorAll(prefix).length) {
			return [];
		}
	}

	selector = selector.split(",");
	selector = selector.map((item) => `${prefix} ${item}`);
	selector = selector.join(",");

	return parent.querySelectorAll(selector);
}

/**
 * Returns the first element with matching text content.
 */
function filterByText(elements, text) {
	text = text.toLowerCase();

	for (let i = 0; i < elements.length; i++) {
		const content = elements[i].textContent.toLowerCase();

		if (-1 !== content.indexOf(text)) {
			return elements[i];
		}
	}

	return null;
}

/**
 * Returns an array with the text-contents of the given elements.
 *
 * @param {NodeList} elements
 * @returns {string[]}
 */
function getLines(elements) {
	const lines = [];
	elements.forEach((el) => lines.push(el.textContent));

	return lines;
}

function getCandidateScreen(container) {
	if (!container) {
		return null;
	}
	return container.children.length >= 3 ? container.children[2] : container.lastElementChild ?? container;
}

function getScreenTitle(screen) {
	if (!screen) {
		return "";
	}
	const h4 = getEl(screen, "h4");
	return h4.length ? h4[0].textContent.trim().toLowerCase().split(/[!.(]/)[0].trim() : "";
}

function getActiveInfiltrationContainer(containers) {
	const containerList = Array.from(containers);
	for (let i = containerList.length - 1; i >= 0; i--) {
		const screen = getCandidateScreen(containerList[i]);
		const title = getScreenTitle(screen);
		if (title) {
			return { container: containerList[i], screen, title };
		}
	}
	const fallbackContainer = containerList[containerList.length - 1] ?? null;
	const fallbackScreen = getCandidateScreen(fallbackContainer);
	return { container: fallbackContainer, screen: fallbackScreen, title: getScreenTitle(fallbackScreen) };
}

function clearPendingTitle() {
	delete state.game.pendingTitle;
	delete state.game.pendingTitleRepeats;
}

function clearPendingWireState() {
	delete state.game.pendingWire;
	delete state.game.pendingWireRepeats;
}

function getConfirmedTitle(rawTitle, runtimeStageName) {
	if (!rawTitle) {
		debugGame("title cleared", runtimeStageName ?? "none");
		clearPendingTitle();
		return rawTitle;
	}
	const mappedRuntimeGame = runtimeStageToGameName[runtimeStageName] ?? null;
	if (mappedRuntimeGame && rawTitle === mappedRuntimeGame) {
		debugGame("title accepted by runtime", JSON.stringify({ rawTitle, runtimeStageName }));
		clearPendingTitle();
		return rawTitle;
	}
	if (runtimeStageName || !state.game.current || rawTitle === state.game.current || rawTitle === "get ready" || rawTitle === "infiltration successful") {
		debugGame("title accepted", JSON.stringify({
			rawTitle,
			runtimeStageName,
			current: state.game.current || null,
		}));
		clearPendingTitle();
		return rawTitle;
	}
	if (state.game.pendingTitle !== rawTitle) {
		state.game.pendingTitle = rawTitle;
		state.game.pendingTitleRepeats = 1;
		debugGame("pending title", rawTitle);
		return state.game.current;
	}
	state.game.pendingTitleRepeats = (state.game.pendingTitleRepeats || 0) + 1;
	if (state.game.pendingTitleRepeats < 2) {
		return state.game.current;
	}
	clearPendingTitle();
	return rawTitle;
}

function callAutoinfTestHook(name, ...args) {
	const hook = wnd.__autoinfTestHooks?.[name];
	if (typeof hook !== "function") {
		return undefined;
	}
	try {
		return hook(...args);
	} catch (error) {
		debugGame("test hook failed", JSON.stringify({
			name,
			error: error?.message ?? String(error),
		}));
		return undefined;
	}
}

function getWebpackRequire() {
	if (wnd.__bbWebpackRequire) {
		return wnd.__bbWebpackRequire;
	}
	const chunk = wnd.webpackChunkbitburner;
	if (!chunk || typeof chunk.push !== "function") {
		return null;
	}
	let webpackRequire = null;
	chunk.push([[Symbol("autoinfil")], {}, (req) => {
		webpackRequire = req;
	}]);
	if (webpackRequire) {
		wnd.__bbWebpackRequire = webpackRequire;
	}
	return webpackRequire;
}

function findWebpackModuleExport(req, predicate) {
	const cache = req?.c;
	if (!cache) {
		return null;
	}
	for (const moduleRecord of Object.values(cache)) {
		const moduleExports = moduleRecord?.exports;
		if (!moduleExports) {
			continue;
		}
		try {
			if (predicate(moduleExports)) {
				return moduleExports;
			}
			if (moduleExports.default && predicate(moduleExports.default)) {
				return moduleExports.default;
			}
		} catch {
			// Ignore cache entries that throw on inspection.
		}
	}
	return null;
}

function getRuntimePlayer(req) {
	const moduleIds = ["./src/Player.ts", "./src/Player", "@player"];
	for (const moduleId of moduleIds) {
		try {
			const playerModule = req(moduleId);
			if (playerModule?.Player && typeof playerModule.Player === "object") {
				return playerModule.Player;
			}
			if (playerModule?.default && typeof playerModule.default === "object" && "infiltration" in playerModule.default) {
				return playerModule.default;
			}
		} catch {
			// Fall through to cache scan for production bundles.
		}
	}

	const scannedModule = findWebpackModuleExport(req, (moduleExports) => {
		if (moduleExports?.Player && typeof moduleExports.Player === "object") {
			const player = moduleExports.Player;
			return "infiltration" in player || "hp" in player || "money" in player;
		}
		if (typeof moduleExports === "object" && moduleExports && "infiltration" in moduleExports && "hp" in moduleExports) {
			return true;
		}
		if (typeof moduleExports?.default === "object" && moduleExports.default && "infiltration" in moduleExports.default) {
			return true;
		}
		return false;
	});
	return scannedModule?.Player ?? scannedModule?.default ?? scannedModule ?? null;
}

function getReactPropsNode(node) {
	if (!node) {
		return null;
	}
	for (const key of Object.keys(node)) {
		if (key.startsWith("__reactProps$")) {
			return node[key];
		}
	}
	return null;
}

function getReactFiberNode(node) {
	if (!node) {
		return null;
	}
	for (const key of Object.keys(node)) {
		if (key.startsWith("__reactFiber$")) {
			return node[key];
		}
	}
	return null;
}

function getStageFromProps(props) {
	if (looksLikeStageModel(props?.stage)) {
		return { stage: props.stage, detail: "__reactProps.stage" };
	}
	if (looksLikeStageModel(props?.state?.stage)) {
		return { stage: props.state.stage, detail: "__reactProps.state.stage" };
	}
	return null;
}

function getStageFromFiberProps(props, detailPrefix) {
	if (looksLikeStageModel(props?.stage)) {
		return { stage: props.stage, detail: `${detailPrefix}.stage` };
	}
	if (looksLikeStageModel(props?.state?.stage)) {
		return { stage: props.state.stage, detail: `${detailPrefix}.state.stage` };
	}
	return null;
}

function getStageFromMemoizedState(state) {
	let current = state;
	while (current) {
		const direct = getStageFromFiberProps(current, "memoizedState");
		if (direct?.stage) {
			return direct;
		}
		const nested = getStageFromFiberProps(current?.element?.props, "memoizedState.element.props");
		if (nested?.stage) {
			return nested;
		}
		current = current.next;
	}
	return null;
}

function looksLikeStageModel(value) {
	if (!value || typeof value !== "object") {
		return false;
	}
	const name = value.constructor?.name;
	return [
		"BackwardModel",
		"BracketModel",
		"BribeModel",
		"CheatCodeModel",
		"Cyberpunk2077Model",
		"MinesweeperModel",
		"SlashModel",
		"WireCuttingModel",
		"VictoryModel",
		"CountdownModel",
		"IntroModel",
	].includes(name);
}

function getStageFromFiber(fiber) {
	let current = fiber;
	while (current) {
		const memoizedPropsResult = getStageFromFiberProps(current.memoizedProps, "memoizedProps");
		if (memoizedPropsResult?.stage) {
			return memoizedPropsResult;
		}
		const pendingPropsResult = getStageFromFiberProps(current.pendingProps, "pendingProps");
		if (pendingPropsResult?.stage) {
			return pendingPropsResult;
		}
		const memoizedStateResult = getStageFromMemoizedState(current.memoizedState);
		if (memoizedStateResult?.stage) {
			return memoizedStateResult;
		}
		current = current.return;
	}
	return null;
}

function findRuntimeInfiltrationStageFromReact() {
	const root = doc.querySelector(".MuiContainer-root") ?? doc.body;
	const candidates = root ? [root, ...root.querySelectorAll("*")] : [doc.body];
	for (const node of candidates) {
		const props = getReactPropsNode(node);
		const propsResult = getStageFromProps(props);
		if (propsResult?.stage) {
			return propsResult;
		}
		const fiber = getReactFiberNode(node);
		if (!fiber) {
			continue;
		}
		const result = getStageFromFiber(fiber);
		if (result?.stage) {
			return result;
		}
	}
	return null;
}

function getRuntimeInfiltrationStage() {
	const hookStage = callAutoinfTestHook("getRuntimeInfiltrationStage");
	if (hookStage !== undefined) {
		return hookStage;
	}
	let webpackStatus = "unavailable";
	try {
		const req = getWebpackRequire();
		if (req) {
			webpackStatus = "require";
			const player = getRuntimePlayer(req);
			if (!player) {
				webpackStatus = "no-player";
			}
			const stage = player?.infiltration?.stage ?? null;
			if (stage) {
				return stage;
			}
			if (player) {
				webpackStatus = "no-stage";
			}
		}
	} catch (error) {
		webpackStatus = `error:${error?.name ?? "unknown"}`;
	}
	const reactResult = findRuntimeInfiltrationStageFromReact();
	if (reactResult?.stage) {
		return reactResult.stage;
	}
	return null;
}

/**
 * Reset the state after infiltration is done.
 */
function endInfiltration() {
	if (state.game?.current || state.game?.previous) {
		debugGame("end infiltration state", JSON.stringify({
			company: state.company || null,
			game: state.game.current || null,
			previous: state.game.previous || null,
			stage: state.game.runtimeStageName || null,
			reason: state.game.completeReason || null,
		}));
	}
	unwrapEventListeners();
	state.company = "";
	state.game = {};
	state.started = false;
}

/**
 * Simulate a keyboard event (keydown + keyup).
 *
 * @param {string|int} keyOrCode A single letter (string) or key-code to send.
 */
function getKeyboardKeyInfo(key) {
	const normalizedKey = key === " " ? " " : key;
	const arrowKeys = {
		ArrowUp: { key: "ArrowUp", code: "ArrowUp", keyCode: 38, shiftKey: false },
		ArrowDown: { key: "ArrowDown", code: "ArrowDown", keyCode: 40, shiftKey: false },
		ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", keyCode: 37, shiftKey: false },
		ArrowRight: { key: "ArrowRight", code: "ArrowRight", keyCode: 39, shiftKey: false },
	};
	if (arrowKeys[normalizedKey]) {
		return arrowKeys[normalizedKey];
	}
	if (/^[a-z]$/i.test(normalizedKey)) {
		const upper = normalizedKey.toUpperCase();
		return {
			key: normalizedKey.toLowerCase(),
			code: `Key${upper}`,
			keyCode: upper.charCodeAt(0),
			shiftKey: false,
		};
	}
	if (/^[0-9]$/.test(normalizedKey)) {
		return {
			key: normalizedKey,
			code: `Digit${normalizedKey}`,
			keyCode: 48 + Number(normalizedKey),
			shiftKey: false,
		};
	}
	const specialKeys = {
		" ": { key: " ", code: "Space", keyCode: 32, shiftKey: false },
		">": { key: ">", code: "Period", keyCode: 190, shiftKey: true },
		"<": { key: "<", code: "Comma", keyCode: 188, shiftKey: true },
		")": { key: ")", code: "Digit0", keyCode: 48, shiftKey: true },
		"(": { key: "(", code: "Digit9", keyCode: 57, shiftKey: true },
		"]": { key: "]", code: "BracketRight", keyCode: 221, shiftKey: false },
		"[": { key: "[", code: "BracketLeft", keyCode: 219, shiftKey: false },
		"}": { key: "}", code: "BracketRight", keyCode: 221, shiftKey: true },
		"{": { key: "{", code: "BracketLeft", keyCode: 219, shiftKey: true },
	};
	return specialKeys[normalizedKey] || null;
}

function pressKey(keyOrCode) {
	let keyInfo = null;

	if ("string" === typeof keyOrCode && keyOrCode.length > 0) {
		keyInfo = getKeyboardKeyInfo(keyOrCode);
		if (!keyInfo) {
			keyInfo = getKeyboardKeyInfo(keyOrCode.substr(0, 1));
		}
	} else if ("number" === typeof keyOrCode) {
		keyInfo = getKeyboardKeyInfo(String.fromCharCode(keyOrCode));
	}

	if (!keyInfo) {
		return;
	}
	const { key, code, keyCode, shiftKey = false } = keyInfo;
	state.game.lastInputTick = state.game.loopCount || 0;
	debugGame("pressKey", { key, code, keyCode, shiftKey });

	function sendEvent(event) {
		const keyboardEvent = new KeyboardEvent(event, {
			key,
			code,
			keyCode,
			which: keyCode,
			charCode: key.length === 1 ? key.charCodeAt(0) : 0,
			shiftKey,
			bubbles: true,
			cancelable: true,
		});

		doc.dispatchEvent(keyboardEvent);
	}

	sendEvent("keydown");
	if (key.length === 1 || key === "Space") {
		sendEvent("keypress");
	}
	sendEvent("keyup");
}

/**
 * Infiltration monitor to start automatic infiltration.
 *
 * This function runs asynchronously, after the "main" function ended,
 * so we cannot use any "ns" function here!
 */
function waitForStart() {
	if (state.started) {
		return;
	}

	const h4 = getEl("h4");

	if (!h4.length) {
		return;
	}
	const title = h4[0].textContent;
	if (0 !== title.indexOf("Infiltrating")) {
		return;
	}

	const btnStart = filterByText(getEl("button"), "Start");
	if (!btnStart) {
		return;
	}

	state.company = title.substr(13);
	state.game = {};
	state.started = true;
	wrapEventListeners();

	logInfo("Start automatic infiltration of", state.company);
	btnStart.click();
}

/**
 * Identify the current infiltration game.
 */
function playGame() {
	state.game.loopCount = (state.game.loopCount || 0) + 1;
	const screens = doc.querySelectorAll(".MuiContainer-root");
	const runtimeStage = getRuntimeInfiltrationStage();
	const runtimeStageName = runtimeStage?.constructor?.name ?? null;
	const runtimeRequire = getWebpackRequire();
	const runtimePlayer = runtimeRequire ? getRuntimePlayer(runtimeRequire) : null;
	const runtimeInfiltration = runtimePlayer?.infiltration ?? null;
	const runtimeResults = runtimeInfiltration?.results ?? "";
	if (state.game.runtimeStageName !== runtimeStageName) {
		state.game.runtimeStageName = runtimeStageName;
		logInfo("Infiltration stage:", runtimeStageName ?? "none");
		debugGame("runtime stage", runtimeStageName ?? "none");
	}
	if (state.game.lastResults !== runtimeResults) {
		state.game.lastResults = runtimeResults;
		if (runtimeResults) {
			debugGame("results", JSON.stringify({
				results: runtimeResults,
				game: state.game.current || null,
				stage: runtimeStageName,
			}));
		}
	}

	if (!screens.length) {
		if (!runtimeStage) {
			if (runtimeInfiltration) {
				debugGame("waiting for runtime infiltration state", JSON.stringify({
					game: state.game.current || null,
					results: runtimeResults || "",
				}));
				return;
			}
			state.game.missingScreenLoops = (state.game.missingScreenLoops || 0) + 1;
			if (!state.game.completed && state.game.missingScreenLoops < blankScreenObservationThreshold) {
				debugGame("waiting for blank screen transition", JSON.stringify({
					game: state.game.current || null,
					missingScreenLoops: state.game.missingScreenLoops,
				}));
				return;
			}
			if (state.game.completed) {
				debugGame("ending after completed game blank screen", JSON.stringify({
					game: state.game.current || null,
					reason: state.game.completeReason || null,
				}));
				endInfiltration();
				return;
			}
			debugGame("infiltration end", JSON.stringify({
				company: state.company || null,
				game: state.game.current || null,
				previous: state.game.previous || null,
				stage: state.game.runtimeStageName || null,
				reason: "missing screen and runtime stage",
			}));
			logError("Infiltration ended unexpectedly:", {
				company: state.company || null,
				game: state.game.current || null,
				previous: state.game.previous || null,
				stage: state.game.runtimeStageName || null,
			});
			endInfiltration();
		} else {
			debugGame("waiting for infiltration screen", runtimeStageName);
		}
		return;
	}
	delete state.game.missingScreenLoops;
	const { container, screen, title: rawTitle } = getActiveInfiltrationContainer(screens);
	const title = getConfirmedTitle(rawTitle, runtimeStageName);
	if (!title && container.children.length < 3 && runtimeStageName !== "CountdownModel" && runtimeStageName !== "VictoryModel" && runtimeStageName !== "IntroModel") {
		debugGame("waiting for screen content", JSON.stringify({
			stage: runtimeStageName,
			children: container.children.length,
		}));
		return;
	}
	if (state.game.lastTitle !== title) {
		state.game.lastTitle = title;
		logInfo("Infiltration title:", title || "(none)");
		debugGame("title", title || "(none)");
	}
	if (title || runtimeStageName) {
		state.game.lastVisibleTick = state.game.loopCount || 0;
	}

	if (runtimeStageName === "VictoryModel" || "infiltration successful" === title) {
		debugGame("infiltration success", JSON.stringify({
			company: state.company || null,
			game: state.game.current || null,
			stage: runtimeStageName,
			title: title || null,
		}));
		endInfiltration();
		return;
	}

	if (runtimeStageName === "CountdownModel" || "get ready" === title) {
		if (state.game.current === "cut the wires with the following properties" && state.game.pendingWire != null) {
			debugGame("cut the wires countdown transition", JSON.stringify({
				wire: state.game.pendingWire,
				title: title || null,
				stage: runtimeStageName || null,
			}));
			clearPendingWireState();
			if (!state.game.completed) {
				markGameComplete("cut the wires advanced to countdown");
			}
		}
		const countdownToken = `${title || ""}|${runtimeStageName || ""}|${state.game.current || ""}`;
		if (state.game.lastCountdownToken !== countdownToken) {
			state.game.lastCountdownToken = countdownToken;
			debugGame("waiting for countdown", JSON.stringify({
				title: title || null,
				stage: runtimeStageName,
				game: state.game.current || null,
			}));
		}
		return;
	}
	delete state.game.lastCountdownToken;

	let currentGameName = title || state.game.current || "";
	if (runtimeStageName === "MinesweeperModel") {
		currentGameName = runtimeStage.memoryPhase ? "remember all the mines" : "mark all the mines";
	} else if (runtimeStageName === "SlashModel") {
		currentGameName = runtimeStage.phase === 0 ? "guarding" : runtimeStage.phase === 1 ? "distracted" : "alerted";
	} else if (runtimeStageName === "BackwardModel") {
		currentGameName = title === "type it" ? "type it" : "type it backward";
	} else if (runtimeStageToGameName[runtimeStageName]) {
		currentGameName = runtimeStageToGameName[runtimeStageName];
	}
	debugGame("game resolution", JSON.stringify({
		title: title || null,
		runtimeStageName,
		current: state.game.current || null,
		resolved: currentGameName || null,
	}));

	if (!currentGameName) {
		maybeLogGameStall(title, runtimeStageName);
		return;
	}

	const game = infiltrationGames.find((game) => game.name === currentGameName);

	if (game) {
		if (state.game.current !== currentGameName) {
			const prevGame = state.game;
			const prevGameName = prevGame.current || "none";
			const carryMinesData =
				prevGame.current === "remember all the mines" &&
				currentGameName === "mark all the mines" &&
				Array.isArray(prevGame.data) &&
				prevGame.data.length;
			state.game = carryMinesData
				? { current: currentGameName, previous: prevGame.current || null, data: prevGame.data }
				: { current: currentGameName, previous: prevGame.current || null };
			logInfo("Infiltration game:", currentGameName);
			debugGame("game transition", `${prevGameName} -> ${currentGameName}`);
			game.init(screen);
			return;
		}
		if (state.game.completed) {
			const completedToken = `${currentGameName}|${title || ""}|${runtimeStageName || ""}|${state.game.completeReason || ""}`;
			if (state.game.lastCompletedWaitToken !== completedToken) {
				state.game.lastCompletedWaitToken = completedToken;
				debugGame("waiting for completed game transition", JSON.stringify({
					game: currentGameName,
					title: title || null,
					stage: runtimeStageName || null,
					reason: state.game.completeReason || null,
				}));
			}
			return;
		}

		game.play(screen);
		maybeLogGameStall(title, runtimeStageName);
	} else {
		logError("Unknown game:", {
			game: currentGameName,
			previous: state.game.previous || null,
			title: title || null,
			stage: runtimeStageName || null,
		});
	}
}

/**
 * Wrap all event listeners with a custom function that injects
 * the "isTrusted" flag.
 *
 * Is this cheating? Or is it real hacking? Don't care, as long
 * as it's working :)
 */
function wrapEventListeners() {
	const eventTarget = wnd.EventTarget?.prototype ?? doc;

	if (!eventTarget._addEventListener) {
		eventTarget._addEventListener = eventTarget.addEventListener;

		eventTarget.addEventListener = function (type, callback, options) {
			if ("undefined" === typeof options) {
				options = false;
			}
			let handler = false;

			// For this script, we only want to modify "keydown" events.
			if ("keydown" === type) {
				handler = function (...args) {
					if (!args[0].isTrusted) {
						const originalEvent = args[0];
						const hackedEv = {
							isTrusted: true,
							key: originalEvent.key,
							code: originalEvent.code,
							keyCode: originalEvent.keyCode,
							which: originalEvent.which,
							charCode: originalEvent.charCode,
							location: originalEvent.location,
							repeat: originalEvent.repeat,
							isComposing: originalEvent.isComposing,
							altKey: originalEvent.altKey,
							ctrlKey: originalEvent.ctrlKey,
							metaKey: originalEvent.metaKey,
							shiftKey: originalEvent.shiftKey,
							defaultPrevented: originalEvent.defaultPrevented,
							preventDefault: originalEvent.preventDefault?.bind(originalEvent),
							stopPropagation: originalEvent.stopPropagation?.bind(originalEvent),
							stopImmediatePropagation: originalEvent.stopImmediatePropagation?.bind(originalEvent),
							getModifierState: originalEvent.getModifierState?.bind(originalEvent),
							composedPath: originalEvent.composedPath?.bind(originalEvent),
							target: originalEvent.target,
							currentTarget: originalEvent.currentTarget,
						};

						Object.setPrototypeOf(hackedEv, KeyboardEvent.prototype);
						args[0] = hackedEv;
					}

					return callback.apply(this, args);
				};

				for (const prop in callback) {
					if ("function" === typeof callback[prop]) {
						handler[prop] = callback[prop].bind(callback);
					} else {
						handler[prop] = callback[prop];
					}
				}
			}

			if (!this.eventListeners) {
				this.eventListeners = {};
			}
			if (!this.eventListeners[type]) {
				this.eventListeners[type] = [];
			}
			this.eventListeners[type].push({
				listener: callback,
				useCapture: options,
				wrapped: handler,
			});

			return eventTarget._addEventListener.call(
				this,
				type,
				handler ? handler : callback,
				options
			);
		};
	}

	if (!eventTarget._removeEventListener) {
		eventTarget._removeEventListener = eventTarget.removeEventListener;

		eventTarget.removeEventListener = function (type, callback, options) {
			if ("undefined" === typeof options) {
				options = false;
			}

			if (!this.eventListeners) {
				this.eventListeners = {};
			}
			if (!this.eventListeners[type]) {
				this.eventListeners[type] = [];
			}

			for (let i = 0; i < this.eventListeners[type].length; i++) {
				if (
					this.eventListeners[type][i].listener === callback &&
					this.eventListeners[type][i].useCapture === options
				) {
					if (this.eventListeners[type][i].wrapped) {
						callback = this.eventListeners[type][i].wrapped;
					}

					this.eventListeners[type].splice(i, 1);
					break;
				}
			}

			if (this.eventListeners[type].length == 0) {
				delete this.eventListeners[type];
			}

			return eventTarget._removeEventListener.call(this, type, callback, options);
		};
	}
}

/**
 * Revert the "wrapEventListeners" changes.
 */
function unwrapEventListeners() {
	const eventTarget = wnd.EventTarget?.prototype ?? doc;

	if (eventTarget._addEventListener) {
		eventTarget.addEventListener = eventTarget._addEventListener;
		delete eventTarget._addEventListener;
	}
	if (eventTarget._removeEventListener) {
		eventTarget.removeEventListener = eventTarget._removeEventListener;
		delete eventTarget._removeEventListener;
	}
	delete doc.eventListeners;
}
