#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");
const { createRequire } = require("module");

const SCRIPTS_REPO = __dirname;
const DEFAULT_BITBURNER_SRC = "/Volumes/SRC/bitburner-src";
const BITBURNER_SRC = process.env.BITBURNER_SRC || DEFAULT_BITBURNER_SRC;
const DEV_SERVER_URL = process.env.BITBURNER_DEV_URL || "http://127.0.0.1:8000/";
const RUNS = Number(process.env.INFILTRATION_RUNS || "3");
const STAGE_RUNS = Number(process.env.INFILTRATION_STAGE_RUNS || "2");
const TARGET = process.env.INFILTRATION_TARGET || "ECorp";
const HEADLESS = process.env.HEADLESS !== "false";
const RUN_TIMEOUT_MS = Number(process.env.INFILTRATION_TIMEOUT_MS || "120000");

const stageCases = [
	{ id: "backward", expectedGames: ["type it backward"] },
	{ id: "backward-forward", expectedGames: ["type it"] },
	{ id: "bracket", expectedGames: ["close the brackets"] },
	{ id: "bribe", expectedGames: ["say something nice about the guard"] },
	{ id: "cheatcode", expectedGames: ["enter the code"] },
	{ id: "cyberpunk", expectedGames: ["match the symbols"] },
	{ id: "minesweeper", expectedGames: ["remember all the mines", "mark all the mines"] },
	{ id: "slash", expectedGames: ["guarding", "distracted"] },
	{ id: "wirecutting", expectedGames: ["cut the wires with the following properties"] },
];

function requirePlaywright() {
	try {
		return require("playwright");
	} catch {
		const playwrightPath = path.join(BITBURNER_SRC, "node_modules", "playwright");
		return createRequire(path.join(BITBURNER_SRC, "package.json"))(playwrightPath);
	}
}

function buildBrowserScript() {
	const sourcePath = path.join(SCRIPTS_REPO, "infiltrate.js");
	let source = fs.readFileSync(sourcePath, "utf8");
	source = source.replace(/^import .*helpers\.js';\n/m, "const devConsole=(...args)=>console.log(...args);\n");
	source = source.replace(/export async function main/, "async function main");
	source += "\nwindow.__autoinf_main = main; window.__codexAutoInf = { state };";
	const outPath = path.join(os.tmpdir(), "infiltrate.browser.js");
	fs.writeFileSync(outPath, source);
	return outPath;
}

async function main() {
	const { chromium } = requirePlaywright();
	const browserScriptPath = buildBrowserScript();
	const browser = await chromium.launch({ headless: HEADLESS });

	const summary = { stages: [], runs: [] };

	for (const stageCase of stageCases) {
		for (let attempt = 1; attempt <= STAGE_RUNS; attempt++) {
			const page = await browser.newPage();
			await page.goto(DEV_SERVER_URL, { waitUntil: "networkidle" });
			await page.waitForFunction(() => !!window.webpackChunkbitburner);
			await page.waitForFunction(() => {
				let req = window.__bbWebpackRequire;
				if (!req) {
					window.webpackChunkbitburner.push([[Symbol("router-ready")], {}, (r) => { req = r; }]);
					window.__bbWebpackRequire = req;
				}
				const { Router } = req("./src/ui/GameRoot.tsx");
				const { Page } = req("./src/ui/Router.ts");
				try {
					return Router.page() !== Page.LoadingScreen;
				} catch {
					return false;
				}
			}, { timeout: 30000 });
			await page.addScriptTag({ path: browserScriptPath });

			const result = await page.evaluate(async ({ stageCase, attempt, target, runTimeoutMs }) => {
				window.__autoinfilLogs = true;
				const logs = [];
				const errors = [];
				const oldLog = console.log;
				const oldError = console.error;
				console.log = (...args) => {
					const text = args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
					if (
						text.includes("Infiltration game:") ||
						text.includes("Infiltration debug:") ||
						text.includes("Start automatic infiltration") ||
						text.includes("Unknown game:")
					) {
						logs.push(text);
					}
					return oldLog.apply(console, args);
				};
				console.error = (...args) => {
					const text = args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
					errors.push(text);
					return oldError.apply(console, args);
				};
				try {
					await window.__autoinf_main({
						flags: () => ({ start: false, stop: false, status: false, quiet: true }),
						tprint: () => {},
					});
					let req = window.__bbWebpackRequire;
					if (!req) {
						window.webpackChunkbitburner.push([[Symbol(`autoinfil-stage-${stageCase.id}`)], {}, (r) => { req = r; }]);
						window.__bbWebpackRequire = req;
					}
					const { Player } = req("./src/Player.ts");
					const { Infiltration } = req("./src/Infiltration/Infiltration.ts");
					const { Locations } = req("./src/Locations/Locations.ts");
					const { Router } = req("./src/ui/GameRoot.tsx");
					const { Page } = req("./src/ui/Router.ts");
					const { AugmentationName } = req("./src/Enums.ts");
					const stageModules = {
						backward: req("./src/Infiltration/model/BackwardModel.ts").BackwardModel,
						bracket: req("./src/Infiltration/model/BracketModel.ts").BracketModel,
						bribe: req("./src/Infiltration/model/BribeModel.ts").BribeModel,
						cheatcode: req("./src/Infiltration/model/CheatCodeModel.ts").CheatCodeModel,
						cyberpunk: req("./src/Infiltration/model/Cyberpunk2077Model.ts").Cyberpunk2077Model,
						minesweeper: req("./src/Infiltration/model/MinesweeperModel.ts").MinesweeperModel,
						slash: req("./src/Infiltration/model/SlashModel.ts").SlashModel,
						wirecutting: req("./src/Infiltration/model/WireCuttingModel.ts").WireCuttingModel,
					};

					for (const stat of ["hacking", "strength", "defense", "dexterity", "agility", "charisma", "intelligence"]) {
						if (stat in Player.skills) Player.skills[stat] = 5000;
						if (Player.exp && stat in Player.exp) Player.exp[stat] = 1e9;
					}
					if (Player.mults) {
						for (const key of Object.keys(Player.mults)) {
							if (typeof Player.mults[key] === "number") Player.mults[key] = Math.max(Player.mults[key], 10);
						}
					}
					if (Player.hp) {
						Player.hp.current = 1e6;
						Player.hp.max = 1e6;
					}

					const originalHasAugmentation = Player.hasAugmentation?.bind(Player);
					Player.hasAugmentation = (augmentationName, includeQueued) => {
						if (stageCase.id === "backward-forward" && augmentationName === AugmentationName.ChaosOfDionysus) {
							return true;
						}
						return originalHasAugmentation ? originalHasAugmentation(augmentationName, includeQueued) : false;
					};

					const infiltration = new Infiltration(Locations[target]);
					Player.infiltration = infiltration;
					infiltration.level = infiltration.maxLevel;
					let stage;
					switch (stageCase.id) {
						case "backward":
						case "backward-forward":
							stage = new stageModules.backward(infiltration);
							break;
						case "bracket":
							stage = new stageModules.bracket(infiltration);
							break;
						case "bribe":
							stage = new stageModules.bribe(infiltration);
							break;
						case "cheatcode":
							stage = new stageModules.cheatcode(infiltration);
							break;
						case "cyberpunk":
							stage = new stageModules.cyberpunk(infiltration);
							break;
						case "minesweeper":
							stage = new stageModules.minesweeper(infiltration);
							break;
						case "slash":
							stage = new stageModules.slash(infiltration);
							break;
						case "wirecutting":
							stage = new stageModules.wirecutting(infiltration);
							break;
						default:
							throw new Error(`Unknown stage case ${stageCase.id}`);
					}
					infiltration.stage = stage;
					Router.toPage(Page.Infiltration);
					infiltration.updateEvent.emit();
					window.__codexAutoInf.state.started = true;
					window.__codexAutoInf.state.company = target;

					const startedAt = Date.now();
					while (Date.now() - startedAt < runTimeoutMs) {
						const infil = Player.infiltration;
						const stageName = infil?.stage?.constructor?.name ?? null;
						const results = infil?.results ?? "";
						if (results.endsWith("✓")) {
							const seenGames = logs
								.filter((line) => line.includes("Infiltration game:"))
								.map((line) => line.split("Infiltration game:")[1].trim().toLowerCase());
							return {
								stageId: stageCase.id,
								attempt,
								ok: stageCase.expectedGames.every((name) => seenGames.includes(name)),
								stage: stageName,
								results,
								seenGames,
								expectedGames: stageCase.expectedGames,
								logsTail: logs.slice(-120),
								errors,
							};
						}
						if (results.endsWith("✗")) {
							return {
								stageId: stageCase.id,
								attempt,
								ok: false,
								reason: "failure",
								stage: stageName,
								results,
								seenGames: logs
									.filter((line) => line.includes("Infiltration game:"))
									.map((line) => line.split("Infiltration game:")[1].trim().toLowerCase()),
								expectedGames: stageCase.expectedGames,
								logsTail: logs.slice(-120),
								errors,
							};
						}
						await new Promise((resolve) => setTimeout(resolve, 25));
					}

					return {
						stageId: stageCase.id,
						attempt,
						ok: false,
						reason: "timeout",
						stage: Player.infiltration?.stage?.constructor?.name ?? null,
						results: Player.infiltration?.results ?? "",
						seenGames: logs
							.filter((line) => line.includes("Infiltration game:"))
							.map((line) => line.split("Infiltration game:")[1].trim().toLowerCase()),
						expectedGames: stageCase.expectedGames,
						logsTail: logs.slice(-120),
						errors,
					};
				} finally {
					console.log = oldLog;
					console.error = oldError;
				}
			}, { stageCase, attempt, target: TARGET, runTimeoutMs: RUN_TIMEOUT_MS });

			summary.stages.push(result);
			console.log(JSON.stringify({
				kind: "stage",
				stageId: result.stageId,
				attempt: result.attempt,
				ok: result.ok,
				reason: result.reason || null,
				stage: result.stage || null,
				results: result.results || "",
				seenGames: result.seenGames || [],
				expectedGames: result.expectedGames || [],
			}));
			await page.close();
			if (!result.ok) {
				console.log(`FAIL_LOG_TAIL=${JSON.stringify(result.logsTail)}`);
				console.log(`FAIL_ERRORS=${JSON.stringify(result.errors)}`);
				process.exitCode = 1;
				console.log(`SUMMARY=${JSON.stringify(summary)}`);
				await browser.close();
				return;
			}
		}
	}

	for (let run = 1; run <= RUNS; run++) {
		const page = await browser.newPage();
		await page.goto(DEV_SERVER_URL, { waitUntil: "networkidle" });
		await page.waitForFunction(() => !!window.webpackChunkbitburner);
		await page.waitForFunction(() => {
			let req = window.__bbWebpackRequire;
			if (!req) {
				window.webpackChunkbitburner.push([[Symbol("router-ready")], {}, (r) => { req = r; }]);
				window.__bbWebpackRequire = req;
			}
			const { Router } = req("./src/ui/GameRoot.tsx");
			const { Page } = req("./src/ui/Router.ts");
			try {
				return Router.page() !== Page.LoadingScreen;
			} catch {
				return false;
			}
		}, { timeout: 30000 });
		await page.addScriptTag({ path: browserScriptPath });

		const result = await page.evaluate(async ({ runNo, target, runTimeoutMs }) => {
			window.__autoinfilLogs = true;
			const logs = [];
			const errors = [];
			const oldLog = console.log;
			const oldError = console.error;
			console.log = (...args) => {
				const text = args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
				if (
					text.includes("Infiltration game:") ||
					text.includes("Infiltration debug:") ||
					text.includes("Start automatic infiltration") ||
					text.includes("Unknown game:")
				) {
					logs.push(text);
				}
				return oldLog.apply(console, args);
			};
			console.error = (...args) => {
				const text = args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ");
				errors.push(text);
				return oldError.apply(console, args);
			};
			try {
				await window.__autoinf_main({
					flags: () => ({ start: false, stop: false, status: false, quiet: true }),
					tprint: () => {},
				});
				let req = window.__bbWebpackRequire;
				if (!req) {
					window.webpackChunkbitburner.push([[Symbol("autoinfil-verify")], {}, (r) => { req = r; }]);
					window.__bbWebpackRequire = req;
				}
				const { Player } = req("./src/Player.ts");
				const { Infiltration } = req("./src/Infiltration/Infiltration.ts");
				const { Locations } = req("./src/Locations/Locations.ts");
				const { Router } = req("./src/ui/GameRoot.tsx");
				const { Page } = req("./src/ui/Router.ts");

				for (const stat of ["hacking", "strength", "defense", "dexterity", "agility", "charisma", "intelligence"]) {
					if (stat in Player.skills) Player.skills[stat] = 5000;
					if (Player.exp && stat in Player.exp) Player.exp[stat] = 1e9;
				}
				if (Player.mults) {
					for (const key of Object.keys(Player.mults)) {
						if (typeof Player.mults[key] === "number") Player.mults[key] = Math.max(Player.mults[key], 10);
					}
				}
				if (Player.hp) {
					Player.hp.current = 1e6;
					Player.hp.max = 1e6;
				}

				Player.infiltration = new Infiltration(Locations[target]);
				Player.infiltration.startInfiltration();
				Router.toPage(Page.Infiltration);
				window.__codexAutoInf.state.started = true;
				window.__codexAutoInf.state.company = target;

				const startedAt = Date.now();
				while (Date.now() - startedAt < runTimeoutMs) {
					const infil = Player.infiltration;
					const stage = infil?.stage?.constructor?.name ?? null;
					const results = infil?.results ?? "";
					if (stage === "VictoryModel") {
						return { runNo, ok: true, stage, results, logsTail: logs.slice(-60), errors };
					}
					if (!infil) {
						return { runNo, ok: false, reason: "ended", stage: null, results, logsTail: logs.slice(-120), errors };
					}
					if (results.endsWith("✗")) {
						return { runNo, ok: false, reason: "failure", stage, results, logsTail: logs.slice(-120), errors };
					}
					await new Promise((resolve) => setTimeout(resolve, 25));
				}

				return {
					runNo,
					ok: false,
					reason: "timeout",
					stage: Player.infiltration?.stage?.constructor?.name ?? null,
					results: Player.infiltration?.results ?? "",
					logsTail: logs.slice(-120),
					errors,
				};
			} finally {
				console.log = oldLog;
				console.error = oldError;
			}
		}, { runNo: run, target: TARGET, runTimeoutMs: RUN_TIMEOUT_MS });

		summary.runs.push(result);
		console.log(JSON.stringify({
			kind: "full-run",
			run: result.runNo,
			ok: result.ok,
			reason: result.reason || null,
			stage: result.stage || null,
			results: result.results || "",
		}));
		if (!result.ok) {
			console.log(`FAIL_LOG_TAIL=${JSON.stringify(result.logsTail)}`);
			console.log(`FAIL_ERRORS=${JSON.stringify(result.errors)}`);
			await page.close();
			break;
		}
		await page.close();
	}

	if (summary.stages.some((result) => !result.ok) || summary.runs.some((result) => !result.ok)) {
		process.exitCode = 1;
	}
	console.log(`SUMMARY=${JSON.stringify(summary)}`);
	await browser.close();
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
