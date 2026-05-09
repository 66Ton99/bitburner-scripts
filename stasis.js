/** @param {NS} ns */
export async function main(ns) {
  let ara = ns.args[0] ?? true;
  await ns.dnet.setStasisLink(ara);  
}
