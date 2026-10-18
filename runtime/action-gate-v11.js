// Shared v11 action helpers for interactive composers.
// Keeps Support and Suggestions consistent without adding background work.

export function createActionGate(){
  const active = new Set();
  return Object.freeze({
    enter(key = "default"){
      const k = String(key || "default");
      if(active.has(k)) return false;
      active.add(k);
      return true;
    },
    leave(key = "default"){
      active.delete(String(key || "default"));
    },
    isActive(key = "default"){
      return active.has(String(key || "default"));
    },
  });
}

export function stableActionFingerprint(parts = []){
  return (Array.isArray(parts) ? parts : [parts])
    .map((part) => String(part ?? "").replace(/\s+/g, " ").trim())
    .join("¦");
}
