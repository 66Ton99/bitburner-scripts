import {instanceCount} from "./helpers";

/** @param {NS} ns **/
export async function main(ns) {
    if (await instanceCount(ns) > 1) return; // Prevent multiple instances of this script from being started, even with different args.
    
    eval("ns.bypass(document)"); // bypass
    ns.exploit(); // undocumented
    if (ns.rainbow("noodles")) {} // rainbow
    window.performance.now = function () { return 0; }; // time compression
    ns.alterReality(); // Only part of: reality alteration
    document.getElementById('unclickable').style = "display: block;position: absolute;top: 50%;left: 50%;width: 100px;height: 100px;z-index: 10000;background: red;"; document.getElementById('unclickable').parentNode.addEventListener('click', () => {
        let unclickableEl = document.getElementById('unclickable');
        unclickableEl.style = "display: none; visibility: hidden;";
        // unclickableEl.click();
    }, true); // unclickable

    Number.prototype.toExponential = function () { return null; }; // prototype tampering
}
