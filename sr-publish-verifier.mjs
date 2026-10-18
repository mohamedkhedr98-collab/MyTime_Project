// SR publication verification is deliberately separate from GitHub write success.
// One check on explicit admin intent; no intervals, polling, or Worker writes.
export function summarizeSrProof(operations = [], results = []) {
  const outputs = Array.isArray(results) ? results : [];
  const byIndex = new Map(outputs.map((output, i) => [
    Number.isInteger(output?.index) ? output.index : i, output,
  ]));
  return (Array.isArray(operations) ? operations : []).map((op, index) => {
    const output = byIndex.get(index) || {};
    const removed = output.removedStructure || {};
    return {
      operation: String(op?.operation || ""),
      tabId: String(removed.tabId || op?.tabId || op?.menu?.tabId || ""),
      newLabel: String(op?.newLabel || ""),
      menuLabel: String(op?.menu?.newLabel || removed.menuLabel ||
        removed.label && removed.type === "menu" && removed.label ||
        op?.menu?.label || ""),
      menuOccurrence: Math.max(1, Number(op?.menu?.occurrence) || 1),
      subLabel: String(op?.submenu?.newLabel || removed.type === "submenu" && removed.label ||
        op?.submenu?.label || ""),
      srTypeId: String(op?.operation === "delete" ?
        output?.target?.srTypeId || op?.target?.srTypeId || "" : output?.added?.srTypeId || ""),
      // Server-derived count from the final browser-visible catalog. Missing
      // proof fails closed; never infer an absent menu from an unchanged SR count.
      remainingMatches: Number.isInteger(output?.remainingMatches) ?
        output.remainingMatches : null,
    };
  }).filter((item) => [
    "create_menu", "create_submenu", "delete_menu", "delete_submenu", "delete",
    "insert_above", "insert_below", "replace",
    "append_to_menu", "append_to_submenu", "append_to_tab",
    "rename_tab", "rename_menu", "rename_submenu",
  ].includes(item.operation));
}

function label(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export function visibleSrChangesInDom(doc, proof = []) {
  if (!doc || typeof doc.querySelectorAll !== "function") return false;
  const tabs = [...doc.querySelectorAll(".tabcontent")];
  for (const op of proof) {
    if (["rename_tab", "rename_menu", "rename_submenu", "append_to_tab"].includes(op.operation)) {
      const tab = tabs.find((node) => node.id === op.tabId);
      if (!tab) return false;
      if (op.operation === "rename_tab") {
        if (!op.newLabel || label(tab.getAttribute("data-sr-display-name")) !== label(op.newLabel)) return false;
      }
      if (op.operation === "rename_menu" || op.operation === "rename_submenu") {
        const namedMenus = [...tab.querySelectorAll(".dropdown")].filter((node) =>
          [...node.children].some(el => el.matches?.("button.dropbtn") &&
            label(el.textContent) === label(op.operation === "rename_menu" ? op.newLabel : op.menuLabel))
        );
        const menu = namedMenus[op.operation === "rename_menu" ? 0 : Math.max(0, (Number(op.menuOccurrence) || 1) - 1)];
        if (!menu) return false;
        if (op.operation === "rename_submenu" && ![...menu.querySelectorAll(".sub-dropdown")].some(node =>
          [...node.children].some(el => el.matches?.("a.no-search") &&
            label(el.textContent) === label(op.newLabel))
        )) return false;
      }
      if (op.operation === "append_to_tab") {
        if (!/^\d+$/.test(op.srTypeId)) return false;
        const wanted = new RegExp("(?:[?&]|&amp;)srTypeId=" + op.srTypeId + "(?:&|$)");
        // A direct SR is identified by its real BSS href AND its position
        // outside all dropdown lists, just like legacy SR 099008001. Do not
        // require a visual class that would make the link look different.
        if (![...tab.querySelectorAll('a[href*="BMEBusiness=srNewSrPage"]')].some(link =>
          wanted.test(link.getAttribute("href") || "") &&
          !link.closest(".dropdown, .sub-dropdown"))) return false;
      }
    }
    if (op.operation === "delete") {
      // Duplicate SR IDs can legitimately remain in other lists. Verify the
      // exact server-derived visible occurrence count, never a fixed total.
      if (!/^\d+$/.test(op.srTypeId) ||
          !Number.isInteger(op.remainingMatches) || op.remainingMatches < 0) return false;
      const srIdPattern = new RegExp("(?:[?&]|&amp;)srTypeId=" + op.srTypeId + "(?:&|$)");
      const visible = [...doc.querySelectorAll('a[href*="srTypeId="]')].filter((node) =>
        srIdPattern.test(node.getAttribute("href") || "")).length;
      if (visible !== op.remainingMatches) return false;
    }
    if (op.operation === "delete_menu" || op.operation === "delete_submenu") {
      if (!Number.isInteger(op.remainingMatches) || op.remainingMatches < 0) return false;
      const tab = tabs.find((node) => node.id === op.tabId);
      const menus = tab ? [...tab.querySelectorAll(".dropdown")].filter((node) => {
        const button = [...node.children].find((el) => el.matches?.("button.dropbtn"));
        return button && label(button.textContent) === label(op.menuLabel);
      }) : [];
      if (op.operation === "delete_menu") {
        if (menus.length !== op.remainingMatches) return false;
      } else {
        const remaining = menus.reduce((total, menu) => total +
          [...menu.querySelectorAll(".sub-dropdown")].filter((node) =>
            [...node.children].some((el) =>
              el.matches?.("a.no-search") && label(el.textContent) === label(op.subLabel)
            )
          ).length, 0);
        if (remaining !== op.remainingMatches) return false;
      }
    }
    if (op.operation === "create_menu" || op.operation === "create_submenu") {
      const tab = tabs.find((node) => node.id === op.tabId);
      if (!tab) return false;
      const matchingMenus = [...tab.querySelectorAll(".dropdown")].filter((node) => {
        const button = [...node.children].find((el) => el.matches?.("button.dropbtn"));
        return button && label(button.textContent) === label(op.menuLabel);
      });
      const menu = matchingMenus[Math.max(0, (Number(op.menuOccurrence) || 1) - 1)];
      if (!menu) return false;
      if (op.operation === "create_submenu" &&
          ![...menu.querySelectorAll(".sub-dropdown")].some((node) =>
            [...node.children].some((el) =>
              el.matches?.("a.no-search") && label(el.textContent) === label(op.subLabel)
            )
          )) return false;
    }
    if (op.srTypeId && op.operation !== "delete") {
      const found = [...doc.querySelectorAll('a[href*="srTypeId="]')].some((node) =>
        new RegExp("(?:[?&]|&amp;)srTypeId=" + op.srTypeId + "(?:&|$)").test(
          node.getAttribute("href") || ""
        )
      );
      if (!found) return false;
    }
  }
  return true;
}

const CATALOG_PROOF_BEGIN = "<!-- SR_CATALOG_PROOF_BEGIN -->";
const CATALOG_PROOF_END = "<!-- SR_CATALOG_PROOF_END -->";

// Hash only the *actual delivered catalog fragment* if an edge transform has
// legitimately altered the surrounding page. Duplicated or stripped markers
// are untrustworthy and deliberately reject verification.
function servedCatalogFragment(html) {
  const start = html.indexOf(CATALOG_PROOF_BEGIN);
  if (start < 0 || html.indexOf(CATALOG_PROOF_BEGIN, start + 1) >= 0) return null;
  const from = start + CATALOG_PROOF_BEGIN.length;
  const end = html.indexOf(CATALOG_PROOF_END, from);
  if (end < 0 || html.indexOf(CATALOG_PROOF_END, end + 1) >= 0) return null;
  return html.slice(from, end);
}

async function sha256Browser(text, cryptoApi) {
  if (!cryptoApi?.subtle) throw new Error("Secure SHA-256 verification is unavailable.");
  const digest = await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}


/**
 * Cryptographic proof from the currently opened authenticated SR tool.
 * The original source bytes must match the authoritative GitHub SHA,
 * plus the shell's pinned SHA + exact catalog asset URL and change proof.
 * A cached/expired shell can never prove a newer deployment.
 */
export async function verifyOpenedSrCatalog({
  hash, proof = [], currentDocument, cryptoApi = globalThis.crypto,
}) {
  const revision = String(hash || "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(revision))
    throw new Error("Missing the verified SR catalog SHA.");
  const openedSha = String(
    currentDocument?.querySelector?.('meta[name="sr-catalog-sha256"]')?.content || ""
  ).toLowerCase();
  if (openedSha !== revision)
    return {state:"pending", reloadRequired:true,
      reason:"The open SR tool has an older or different catalog. Reload after Cloudflare deploys."};
  if (currentDocument?.querySelector?.('meta[name="sr-catalog-asset"]')?.content !==
      "/sr-catalog/" + revision + ".catalog")
    throw new Error("The opened SR tool has no matching signed catalog asset URL.");
  const loader=currentDocument?.defaultView?.__srCatalog;
  if (!loader || typeof loader.get !== "function")
    throw new Error("The authenticated opened SR catalog loader is unavailable.");
  const data=await loader.get();
  if (String(data?.revision || "").toLowerCase() !== revision ||
      typeof data?.source !== "string" ||
      await sha256Browser(data.source, cryptoApi) !== revision ||
      !visibleSrChangesInDom(data.doc, proof))
    throw new Error("The opened SR catalog bytes or requested menu proof cannot be verified.");
  return {state:"live",reason:"Verified exact SR catalog source SHA-256 and staged menu proof in the opened tool."};
}

export async function verifySrPublication({
  hash, proof = [], currentDocument, fetcher = fetch,
  cryptoApi = globalThis.crypto, parseHtml = (html) =>
    new DOMParser().parseFromString(html, "text/html"),
}) {
  if (!/^[a-f0-9]{64}$/i.test(String(hash || ""))) {
    throw new Error("Missing exact signed SR revision. Never mark as published.");
  }
  const query = "?sr_revision=" + encodeURIComponent(hash) + "&check=" + Date.now();
  const init = { cache: "no-store", credentials: "same-origin" };
  const receiptRes = await fetcher("/sr-catalog-build.json" + query,
    { ...init, headers: { Accept: "application/json" } });
  if (!receiptRes.ok) {
    if (receiptRes.status === 403) {
      // Cloudflare can restrict the compiled receipt independently of the
      // signed source. Only accept the CURRENT opened tool after source SHA,
      // pinned asset and requested menu proofs all agree.
      return verifyOpenedSrCatalog({hash,proof,currentDocument,cryptoApi});
    }
    throw new Error("Compiled SR receipt is unavailable (HTTP " + receiptRes.status + ").");
  }
  const receipt = await receiptRes.json();
  if (String(receipt?.catalogSha256 || "") !== hash) {
    return { state: "pending", reason: "Cloudflare still serves an older catalog." };
  }
  if (!/^[a-f0-9]{64}$/i.test(String(receipt?.outputSha256 || ""))) {
    throw new Error("Compiled SR receipt has no valid page signature.");
  }
  // Item counts are operational statistics, not publication gates. A legitimate
  // admin edit can add/remove arbitrary SR links and even empty menu structures.
  // Publication is proven by the exact catalog SHA-256 and requested DOM change.

  const htmlRes = await fetcher("/index.html" + query,
    { ...init, headers: { Accept: "text/html" } });
  if (!htmlRes.ok) throw new Error("Live tool HTML returned HTTP " + htmlRes.status + ".");
  // The receipt is a static asset, but /index.html requires the user's
  // session. Do not mistake an automatically followed /login redirect for
  // a mismatching production build.
  const responseUrl = String(htmlRes.url || "");
  let finalPath = "";
  try { if (responseUrl) finalPath = new URL(responseUrl).pathname.toLowerCase(); } catch {}
  if (htmlRes.redirected && (finalPath === "/login" || finalPath.startsWith("/login/") ||
      finalPath === "/account/reset")) {
    throw new Error("The tool session expired and the HTML request went to login. Sign in and reload the tool; your pending edit was not erased.");
  }
  const contentType = htmlRes.headers?.get?.("content-type") || "";
  if (contentType && !contentType.toLowerCase().includes("text/html")) {
    throw new Error("The live tool did not return HTML (" + contentType + "). NOT verified.");
  }
  const liveHtml = await htmlRes.text();
  const rendered = parseHtml(liveHtml);
  const servedRevision = String(rendered.querySelector('meta[name="sr-catalog-sha256"]')?.content || "");
  if (!servedRevision) {
    throw new Error("The URL returned HTML without the SR tool revision. Check login/session or Cloudflare's response; do not retry publishing.");
  }
  if (servedRevision !== hash) {
    return { state: "pending", reason:
      "The served tool still has an older/different SR catalog. Do not save the same edit again; check Cloudflare deployment and reload." };
  }
  if (receipt.version === 2) {
    // As with the embedded catalog, unrelated delivery markup can change.
    // Exact revision/asset URL, source SHA and requested structure below are
    // still mandatory; shell byte equality is not an additional LIVE gate.
    const assetUrl = "/sr-catalog/" + hash + ".catalog";
    if (receipt.catalogAssetUrl !== assetUrl ||
        rendered.querySelector('meta[name="sr-catalog-asset"]')?.content !== assetUrl) {
      throw new Error("The deployed shell has no exact catalog asset signature.");
    }
    // Never download a second revision into the OPEN page. A new deployment
    // uses the existing reload workflow; the new page verifies its one asset.
    const loader = currentDocument?.defaultView?.__srCatalog;
    if (currentDocument?.querySelector('meta[name="sr-catalog-sha256"]')?.content !== hash || !loader) {
      return { state: "pending", reloadRequired: true, reason:
        "The new shell is deployed. Reload tool to verify its exact catalog asset and edited menus; LIVE is not yet verified." };
    }
    const data = await loader.get();
    if (data.revision !== hash || await sha256Browser(data.source, cryptoApi) !== hash ||
        !visibleSrChangesInDom(data.doc, proof)) {
      throw new Error("The opened tool's exact catalog asset or requested menu cannot be verified.");
    }
    return { state: "live", reason:
      "VERIFIED LIVE: exact source asset and requested menus verified in this tool's shared catalog." };
  }
  // First prefer the strongest check: exact bytes of the compiled page.
  // If Cloudflare modified unrelated markup on delivery, the signed catalog
  // must STILL hash exactly to the receipt and its requested visible changes
  // must appear in the browser DOM. Neither an HTML marker alone nor a count
  // alone can ever establish LIVE.
  if (await sha256Browser(liveHtml, cryptoApi) !== receipt.outputSha256) {
    const fragment = servedCatalogFragment(liveHtml);
    if (fragment === null || await sha256Browser(fragment, cryptoApi) !== receipt.catalogSha256) {
      throw new Error("Cloudflare delivered different HTML and the exact SR catalog cannot be verified. No duplicate save; inspect delivery transformation or session.");
    }
  }
  if (!visibleSrChangesInDom(rendered, proof)) {
    throw new Error("The SR menu/change is missing from the actual live HTML DOM.");
  }

  if (currentDocument?.querySelector('meta[name="sr-catalog-sha256"]')?.content !== hash ||
      !visibleSrChangesInDom(currentDocument, proof)) {
    return { state: "deployed", reason:
      "Cloudflare has the exact edit and its menu, but the OPEN tool still has old HTML. Click Reload tool." };
  }
  return { state: "live", reason:
    "VERIFIED LIVE: the saved SR revision and edited menus are in your currently opened tool." };
}
