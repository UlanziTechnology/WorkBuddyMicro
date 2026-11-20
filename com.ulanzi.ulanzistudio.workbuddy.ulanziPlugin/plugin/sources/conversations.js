"use strict";

/** Runs in WorkBuddy's renderer. Both recent slots and the picker read the same
 * committed list; reused DOM fibers can still point into an obsolete tree.
 * null means unavailable; [] is an authoritative empty list.
 */
function readConversations() {
  const anchor = document.querySelector(".cb-agent-card[data-conversation-id]") || document.querySelector(".conversation-list") || document.getElementById("root")?.firstElementChild;
  if (!anchor) return null;
  let root = anchor[Object.keys(anchor).find(key => key.startsWith("__reactFiber$"))];
  while (root?.return) root = root.return;
  const pending = root?.stateNode?.current ? [root.stateNode.current] : [];
  while (pending.length) {
    const current = pending.pop();
    if (current.sibling) pending.push(current.sibling);
    if (current.child) pending.push(current.child);
    const list = current.memoizedProps?.allConversations;
    if (!Array.isArray(list)) continue;
    const valid = list.filter(row => typeof row?.id === "string" && row.id && Number.isFinite(row.sortAt) && !["archived","deleted"].includes(row.lifecycle));
    if (list.length && !valid.length) {
      // A list containing only archived chats is empty, not a malformed snapshot.
      return list.every(row => ["archived","deleted"].includes(row?.lifecycle)) ? [] : null;
    }
    const seen = new Set();
    return valid.sort((a,b) => b.sortAt-a.sortAt || a.id.localeCompare(b.id)).filter(row => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);return true;
    });
  }
  return null;
}
module.exports = {readConversations};
