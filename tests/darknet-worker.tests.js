/**
 * External test suite for `darknet-worker.js`.
 * The original inline `runSelfTest` implementation defined a large `tests`
 * array and performed validation against `buildCandidates`.  To keep the
 * production file concise we moved that logic here.
 */

function runTests(buildCandidates) {
    const tests = [
        ["ZeroLogon", { modelId: "ZeroLogon" }, [""]],
        ["DeskMemo_3.1", { modelId: "DeskMemo_3.1", passwordHint: "The password is 123" }, ["123"]],
        ["FreshInstall_1.0", { modelId: "FreshInstall_1.0" }, ["admin", "password", "0000", "12345"]],
        ["CloudBlare(tm)", { modelId: "CloudBlare(tm)", data: "1[]2╬3" }, ["123"]],
        ["Laika4", { modelId: "Laika4" }, ["fido", "spot", "rover", "max"]],
        ["BellaCuore single", { modelId: "BellaCuore", data: "XLII" }, ["42"]],
        ["BellaCuore range", { modelId: "BellaCuore", data: "IX,XI" }, ["9", "10", "11"]],
        ["PrimeTime 2", { modelId: "PrimeTime 2", data: String(9739 * 97) }, ["9739"]],
        ["110100100", { modelId: "110100100", data: "01101000 01101001" }, ["hi"]],
        ["OrdoXenos", { modelId: "OrdoXenos", data: "aaa;00000001 00000010 00000011" }, ["`cb"]],
        ["OctantVoxel", { modelId: "OctantVoxel", data: "16,2A" }, ["42"]],
        ["MathML", { modelId: "MathML", data: "6 * (7 + 1)" }, ["48"]],
        ["Pr0verFl0", { modelId: "Pr0verFl0", passwordLength: 4 }, ["AAAAAAAA"]],
        ["PHP 5.4", { modelId: "PHP 5.4", data: "1[]2╬3" }, ["123", "132", "213", "231", "312", "321"]],
        ["AccountsManager_4.2 len1", { modelId: "AccountsManager_4.2", passwordLength: 1 }, ["0", "1", "2"], actual =>
            actual.length === 10 && actual.at(-1) === "9" && !actual.includes("10") ? "" :
                `expected 10 one-digit candidates ending at 9, got ${actual.length} ending at ${actual.at(-1)}`],
        ["AccountsManager_4.2 len2", { modelId: "AccountsManager_4.2", passwordLength: 2 }, ["00", "01", "02"], actual =>
            actual.length === 100 && actual.at(-1) === "99" && !actual.includes("100") ? "" :
                `expected 100 two-digit candidates ending at 99, got ${actual.length} ending at ${actual.at(-1)}`],
        ["Factori-Os divisible by 1 len2", { modelId: "Factori-Os", passwordHint: "The password is divisible by 1 ;)", passwordLength: 2 }, ["00", "01", "02"], actual =>
            actual.length === 100 && actual.at(-1) === "99" ? "" :
                `expected 100 two-digit candidates ending at 99, got ${actual.length} ending at ${actual.at(-1)}`],
        ["Factori-Os divisible by 7 len2", { modelId: "Factori-Os", passwordHint: "The password is divisible by 7 ;)", passwordLength: 2 }, ["00", "07", "14"], actual =>
            actual.every(candidate => Number(candidate) % 7 === 0) && actual.includes("98") ? "" :
                `expected divisible-by-7 candidates including 98, got ${JSON.stringify(actual.slice(0, 20))}`],
        // Additional models for full coverage
        // Models that currently have no static candidate lists; they are solved dynamically at runtime.
        // The buildCandidates function returns an empty array for these, which is acceptable.
        ["NIL", { modelId: "NIL" }, [], actual => actual.length === 0 ? "" : `NIL should return empty array`],
        ["OpenWebAccessPoint", { modelId: "OpenWebAccessPoint", passwordLength: 3, passwordFormat: "numeric" }, [], actual => actual.length === 0 ? "" : `OpenWebAccessPoint should return empty array`],
        ["2G_cellular", { modelId: "2G_cellular", passwordLength: 2, passwordFormat: "numeric" }, [], actual => actual.length === 0 ? "" : `2G_cellular should return empty array`],
        ["RateMyPix.Auth", { modelId: "RateMyPix.Auth", passwordLength: 2, passwordFormat: "numeric" }, [], actual => actual.length === 0 ? "" : `RateMyPix.Auth should return empty array`],
        ["DeepGreen", { modelId: "DeepGreen" }, [], actual => actual.length === 0 ? "" : `DeepGreen should return empty array`],
        // Additional models that were previously omitted from the test suite.
        ["TopPass", { modelId: "TopPass" }, ["123456", "password", "12345678"], actual =>
            actual.slice(0, 3).join(",") === "123456,password,12345678" ? "" :
                `TopPass candidates mismatch: ${actual.slice(0, 5).join(",")}`],
        ["EuroZone Free", { modelId: "EuroZone Free" }, ["Austria", "Belgium", "Bulgaria"], actual =>
            actual.slice(0, 3).join(",") === "Austria,Belgium,Bulgaria" ? "" :
                `EuroZone Free candidates mismatch: ${actual.slice(0, 5).join(",")}`],
        // Ensure that unknown models return an empty array.
        ["UnknownModel", { modelId: "NonExistent" }, [], actual => actual.length === 0 ? "" : `expected empty for unknown model, got ${actual.length}`],
    ];

    const failures = [];
    for (const [name, details, expectedPrefix, validate] of tests) {
        const actual = buildCandidates(details);
        for (let i = 0; i < expectedPrefix.length; i++) {
            if (actual[i] !== expectedPrefix[i]) failures.push(`${name}: expected candidate[${i}]=${expectedPrefix[i]}, got ${actual[i]}`);
        }
        const validationFailure = validate?.(actual);
        if (validationFailure) failures.push(`${name}: ${validationFailure}`);
    }
    return { total: tests.length, passed: tests.length - failures.length, failures };
}

module.exports = { runTests };
