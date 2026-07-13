export const argsSchema = [
    ['corporation-name', 'Forge'], // Corporation name, if we have to create a new one.
    ['no-expansion', false], // If this flag is set, do not expand to new industries. Just work on what we have.
    ['reserve-amount', 1e9], // Don't spend the corporation's last $billion if we can help it.
    ['verbose', false], // Print extra log messages.
    ['can-accept-funding', true], // When we run low on money, should we look for outside funding?
    ['can-go-public', true], // If we can't get private funding, should we go public?
    ['issue-shares', 0], // If we go public, how many shares should we issue?
    ['can-issue-new-shares', true], // After IPO, issue new shares when growth is capital-starved.
    ['issue-new-shares-min-ownership', 0.51], // Do not dilute CEO ownership below this fraction.
    ['can-sell-divisions', false], // Risky: sell only clearly undeveloped weak divisions when the division cap blocks a better industry.
    ['can-spend-hashes', true], // Can we spend hacknet hashes (assuming we have them)?
    ['once', false], // Run once, then quit, instead of going into a loop.
    ['interval', 10000], // Fixed delay in ms between management loops. 10000ms matches the normal corporation market cycle; 0 waits for START tick.
    ['mock', false], // Run the task assignment queue, but don't actually spend any money.
    ['price-discovery-only', false], // Don't do any auto-buying, just try to keep the sale price balanced as high as possible. (Emulating TA2 as best we can)
    ['first', 'Refinery'], // First bootstrap division. Refinery is cheap and feeds later hardware/real-estate growth with Metal.
    ['second', 'Tobacco'], // Product division to save for after round 3. Tobacco converts research into high-value products efficiently.
    ['no-tail-windows', false], // Suppress tail windows when launched by daemon.js default no-tail orchestration.
];
