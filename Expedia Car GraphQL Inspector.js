// ==UserScript==
// @name         Expedia GraphQL Inspector
// @namespace    HamzaScripts
// @version      2.5
// @description  Capture GraphQL requests and responses from Expedia
// @author       Hamza
// @match        https://www.expedia.com/*
// @grant        none
// @run-at       document-start
// ==/UserScript==

(function () {
  "use strict";

  if (window.__HAMZA_GRAPHQL_LOGGER__) return;

  window.__HAMZA_GRAPHQL_LOGGER__ = true;

  // =============================
  // CONFIG
  // =============================
  const CONFIG = {
    autoLoadDelayMs: 3500,
    maxRetries: 3,
    retryBackoffMs: 1500,
    maxPages: 100,
    maxLogsInMemory: 200,
    persistToStorage: true,
    storageKey: "expedia_graphql_capture",
    storageMaxAgeMs: 3600000,
    fetchTimeoutMs: 30000,
  };

  // =============================
  // SPEED PRESETS
  // =============================
  const SPEED_PRESETS = {
    slow: { delay: 4000, backoff: 3000, jitter: 3000 },
    medium: { delay: 1500, backoff: 1500, jitter: 1500 },
    fast: { delay: 600, backoff: 800, jitter: 800 },
  };
  let currentSpeed = "medium";

  function applySpeed(speed) {
    currentSpeed = speed;
    const preset = SPEED_PRESETS[speed];
    if (!preset) return;
    CONFIG.autoLoadDelayMs = preset.delay;
    CONFIG.retryBackoffMs = preset.backoff;
    CONFIG._jitter = preset.jitter;
  }
  applySpeed("medium");

  const SPEED_STORAGE_KEY = "expedia_graphql_speed";

  function saveSpeed() {
    try {
      localStorage.setItem(SPEED_STORAGE_KEY, currentSpeed);
    } catch (e) {
      console.warn(e);
    }
  }

  function loadSpeed() {
    try {
      const saved = localStorage.getItem(SPEED_STORAGE_KEY);
      if (saved && SPEED_PRESETS[saved]) applySpeed(saved);
    } catch (e) {
      console.warn(e);
    }
  }

  // =============================
  // STATE
  // =============================
  let capturing = true;
  let autoLoading = false;
  let __replaying = false;
  const logs = [];
  const capturedPages = new Set();
  let latestGraphQL = null;

  window.__EXPEDIA_GRAPHQL__ = {
    get() {
      return latestGraphQL;
    },
  };

  // =============================
  // PERSISTENCE
  // =============================
  function saveState() {
    if (!CONFIG.persistToStorage) return;
    try {
      const snapshot = {
        logs: logs.slice(-CONFIG.maxLogsInMemory),
        capturedPages: Array.from(capturedPages),
        latestGraphQL,
        timestamp: Date.now(),
      };
      localStorage.setItem(CONFIG.storageKey, JSON.stringify(snapshot));
    } catch (e) {
      console.warn("Failed to save state to localStorage", e);
    }
  }

  function loadState() {
    if (!CONFIG.persistToStorage) return;
    try {
      const raw = localStorage.getItem(CONFIG.storageKey);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (Date.now() - saved.timestamp > CONFIG.storageMaxAgeMs) {
        localStorage.removeItem(CONFIG.storageKey);
        return;
      }
      (saved.logs || []).forEach((l) => logs.push(l));
      (saved.capturedPages || []).forEach((k) => capturedPages.add(k));
      if (saved.latestGraphQL) latestGraphQL = saved.latestGraphQL;
    } catch (e) {
      console.warn("Failed to load state from localStorage", e);
    }
  }

  // =============================
  // HELPERS
  // =============================
  function setSelection(selections, id, value) {
    const existing = selections.find((x) => x.id === id);
    if (existing) {
      existing.value = String(value);
    } else {
      selections.push({ id, value: String(value) });
    }
  }

  function stopAutoLoad() {
    autoLoading = false;
  }

  function logUI(text) {
    const area = document.getElementById("gql_output");
    if (!area) return;
    area.value += text + "\n";
    area.scrollTop = area.scrollHeight;
  }

  function setStatus(text) {
    const s = document.getElementById("gql_status");
    if (s) s.textContent = text;
  }

  function updateCounter() {
    const c = document.getElementById("gql_counter");
    if (c) c.textContent = logs.length;
    const badge = document.getElementById("gql_mini_badge");
    if (badge) badge.textContent = logs.length;
  }

  function parseTotalListingsCount() {
    try {
      const el = document.querySelector('[role="status"][aria-live="polite"]');
      if (!el) return null;
      const m = el.textContent.match(/([\d,]+)\s*Cars?/i);
      return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
    } catch (e) {
      return null;
    }
  }

  function calculateAutoLoadPages(totalEntries, firstPageCount, pageSize) {
    if (!totalEntries || !firstPageCount || totalEntries <= firstPageCount)
      return 0;
    return Math.ceil((totalEntries - firstPageCount) / pageSize);
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  async function parseBody(body) {
    if (!body) return null;
    if (typeof body === "string") {
      try {
        return JSON.parse(body);
      } catch {
        return null;
      }
    }
    if (body instanceof Blob) return JSON.parse(await body.text());
    if (body instanceof ArrayBuffer)
      return JSON.parse(new TextDecoder().decode(body));
    return null;
  }

  // Normalize headers from any format (Headers, array, plain object)
  function captureHeaders(request, options) {
    if (request instanceof Request)
      return Object.fromEntries(request.headers.entries());
    if (options && options.headers) {
      if (options.headers instanceof Headers)
        return Object.fromEntries(options.headers.entries());
      if (Array.isArray(options.headers))
        return Object.fromEntries(options.headers);
      if (typeof options.headers === "object" && options.headers !== null)
        return { ...options.headers };
    }
    return {};
  }

  // Random delay with jitter
  function randomDelay(base, jitter) {
    return base + Math.random() * jitter;
  }

  // Quote a field for CSV (handles commas, quotes, and newlines)
  function csvField(val) {
    const s = String(val ?? "");
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  // Fixed getAttribute with null safety
  function getAttribute(vehicle, title, description) {
    return (
      vehicle?.attributes?.find(
        (a) => a.icon?.title === title || a.icon?.description === description,
      )?.text ?? ""
    );
  }

  // Dedicated free cancellation check
  function getFreeCancellation(car) {
    return (
      car.actionableConfidenceMessages?.some(
        (x) => x.value === "Free cancellation",
      ) ??
      car.supplyInfo?.cancellationDescription?.toLowerCase().includes("free") ??
      false
    );
  }

  // Dedicated mileage extractor
  function getMileage(vehicle) {
    if (!vehicle?.attributes) return "";
    const attr = vehicle.attributes.find(
      (a) => a.icon?.id === "speed" || a.icon?.description === "mileage",
    );
    const text = attr?.text ?? "";
    return text === "Unlimited mileage" ? "Unlimited" : text;
  }

  // Parse Retry-After header into milliseconds, capped at 2 minutes
  function parseRetryAfter(resp) {
    const header = resp.headers.get("Retry-After");
    if (!header) return null;
    const seconds = parseInt(header, 10);
    if (!isNaN(seconds)) return Math.min(seconds * 1000, 120000);
    const date = Date.parse(header);
    if (!isNaN(date)) return Math.min(Math.max(0, date - Date.now()), 120000);
    return null;
  }

  // Fetch with timeout and retry, respects Retry-After header
  async function fetchWithRetry(url, options, retries) {
    const maxRetries = retries ?? CONFIG.maxRetries;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(
        () => controller.abort(),
        CONFIG.fetchTimeoutMs,
      );
      const opts = { ...options, signal: controller.signal };
      try {
        const resp = await fetch(url, opts);
        clearTimeout(timeoutId);
        if (resp.ok) return resp;
        if (attempt === maxRetries)
          throw new Error(`HTTP ${resp.status} after ${maxRetries} retries`);
        const retryAfter = parseRetryAfter(resp);
        const delay =
          retryAfter ??
          randomDelay(CONFIG.retryBackoffMs * Math.pow(2, attempt), 1000);
        await new Promise((r) => setTimeout(r, delay));
      } catch (err) {
        clearTimeout(timeoutId);
        if (attempt === maxRetries) throw err;
        const delay = randomDelay(
          CONFIG.retryBackoffMs * Math.pow(2, attempt),
          1000,
        );
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }

  // =============================
  // AUTO PAGINATION ENGINE
  // =============================
  async function replayLoadMore(entry) {
    const body = structuredClone(entry.request);

    const vars = (body.variables ??= {});
    const secondary = (vars.secondaryCriteria ??= {});
    const selections = (secondary.selections ??= []);

    const pagination = entry.loadMore?.searchPagination;
    const pageSize =
      pagination?.size ??
      Number(selections.find((x) => x.id === "selPageCount")?.value ?? 25);

    const currentIndex = pagination?.startingIndex ?? 0;
    const currentCount = entry.listingCount || pageSize;
    const nextIndex = currentIndex + currentCount;

    // CRITICAL: use selPageIndex (not startingIndex) as observed in manual requests
    setSelection(selections, "selPageIndex", nextIndex);
    setSelection(selections, "searchId", entry.searchId);
    setSelection(selections, "selPageCount", pageSize);

    const headers = { ...entry.requestHeaders };
    delete headers["content-length"];
    delete headers["host"];

    // Ensure content-type is always set
    if (!headers["content-type"] && !headers["Content-Type"]) {
      headers["content-type"] = "application/json";
    }

    __replaying = true;
    try {
      const response = await fetchWithRetry(entry.url, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify(body),
      });

      const json = await response.json();

      return {
        time: new Date().toISOString(),
        operation: body.operationName,
        url: entry.url,
        searchId:
          json?.data?.carSearchOrRecommendations?.carSearchResults
            ?.carsShoppingContext?.searchId,
        listingCount:
          json?.data?.carSearchOrRecommendations?.carSearchResults?.listings
            ?.length ?? 0,
        request: body,
        response: json,
        loadMore:
          json?.data?.carSearchOrRecommendations?.carSearchResults
            ?.loadMoreAction,
        requestHeaders: entry.requestHeaders,
        _requestedOffset: nextIndex,
      };
    } finally {
      __replaying = false;
    }
  }

  async function autoLoadAll() {
    if (autoLoading) return;
    autoLoading = true;
    setStatus("Auto loading...");

    let page = latestGraphQL;
    if (!page) {
      setStatus(
        "No base page captured yet. Perform a new car search or refresh the page to capture data again, then click Auto.",
      );
      autoLoading = false;
      return;
    }

    const _autoPages = calculateAutoLoadPages(
      parseTotalListingsCount(),
      page.listingCount || 0,
      25,
    );
    const _totalPages = _autoPages + 1;
    if (_totalPages > 1) {
      startProgress(_totalPages);
      updateProgress(1);
    }

    let pageNum = 0;
    let totalListings = page.listingCount || 0;
    while (
      page.loadMore &&
      page.loadMore?.searchPagination?.hasNextPage !== false &&
      autoLoading &&
      pageNum < CONFIG.maxPages
    ) {
      setStatus(`Loading page ${pageNum + 2} (${totalListings} so far)...`);
      try {
        const next = await replayLoadMore(page);

        if (next.listingCount === 0) {
          setStatus("No more listings");
          break;
        }

        // Stop if page returned fewer results than requested (last page)
        const requestedSize = page.loadMore?.searchPagination?.size ?? 25;
        if (next.listingCount < requestedSize) {
          next.loadMore = {
            ...next.loadMore,
            searchPagination: {
              ...next.loadMore?.searchPagination,
              hasNextPage: false,
            },
          };
        }

        // Dedup against already captured pages
        const nextPageKey = next.searchId + ":" + (next._requestedOffset ?? 0);
        if (capturedPages.has(nextPageKey)) {
          logUI(`⏭ All remaining pages already captured`);
          break;
        }
        capturedPages.add(nextPageKey);

        logs.push(next);
        saveState();

        page = next;
        latestGraphQL = next;
        pageNum++;
        totalListings += next.listingCount;

        updateCounter();
        logUI(`✔ Page ${pageNum + 1} | ${next.listingCount} listings`);
        updateProgress(pageNum + 1);

        if (
          autoLoading &&
          page.loadMore?.searchPagination?.hasNextPage !== false
        ) {
          await new Promise((r) =>
            setTimeout(r, randomDelay(CONFIG.autoLoadDelayMs, CONFIG._jitter)),
          );
        }
      } catch (e) {
        const is403 = e.message?.includes("403");
        console.error("Auto-load error on page", pageNum + 2, e);
        logUI(`✖ Error on page ${pageNum + 2}: ${e.message}`);
        setStatus(`Error: ${e.message} – retrying...`);

        // Smart retry: on 403 retry harder, otherwise once
        let retrySuccess = false;
        const maxAttempts = is403 ? CONFIG.maxRetries + 1 : 1;
        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
          try {
            const retryDelay = is403
              ? randomDelay(
                  CONFIG.retryBackoffMs * Math.pow(3, attempt),
                  CONFIG._jitter,
                )
              : CONFIG.retryBackoffMs * 2;
            await new Promise((r) => setTimeout(r, retryDelay));
            const retry = await replayLoadMore(page);
            if (retry.listingCount > 0) {
              const retryPageKey = retry.searchId + ":" + (retry._requestedOffset ?? 0);
              if (!capturedPages.has(retryPageKey)) {
                capturedPages.add(retryPageKey);
                logs.push(retry);
                saveState();
              }
              page = retry;
              latestGraphQL = retry;
              pageNum++;
              totalListings += retry.listingCount;
              updateCounter();
              logUI(
                `✔ Retry OK page ${pageNum + 1} | ${retry.listingCount} listings`,
              );
              updateProgress(pageNum + 1);
              retrySuccess = true;
              break;
            }
          } catch (retryErr) {
            if (attempt === maxAttempts) {
              console.error("All retries failed", retryErr);
              logUI(`✖ All retries failed: ${retryErr.message}`);
            }
          }
        }
        if (retrySuccess) continue;
        break;
      }
    }

    autoLoading = false;
    if (pageNum > 0) {
      const totalListings = logs.reduce(
        (sum, l) => sum + (l.listingCount || 0),
        0,
      );
      setStatus(
        `Finished – ${pageNum} auto pages, ${totalListings} total listings`,
      );
      logUI(`✔ Auto-exporting CSV (${totalListings} total listings)...`);
      exportCSV();
      localStorage.removeItem(CONFIG.storageKey);
    } else {
      setStatus("Finished");
    }
    completeProgress();
  }

  // =============================
  // CSV EXPORT
  // =============================
  function exportCSV() {
    const rows = [];

    rows.push(
      [
        "Provider",
        "Location Code",
        "Pickup Date",
        "Pickup Time",
        "Return Date",
        "Duration Days",
        "Supplier",
        "Supplier Raw",
        "ACRISS",
        "Vehicle Example",
        "Currency",
        "Total Price",
        "Price Daily",
        "Rating",
        "Transmission",
        "Mileage",
        "Free Cancellation",
        "Pay At Pickup",
        "Prepaid",
      ]
        .map(csvField)
        .join(","),
    );

    logs.forEach((page) => {
      const listings =
        page.response?.data?.carSearchOrRecommendations?.carSearchResults
          ?.listings ?? [];

      listings.forEach((car) => {
        const attrs = car?.tripsSaveItemWrapper?.tripsSaveItem?.attributes;
        if (!attrs) return;

        const pickupDT = attrs.searchCriteria?.pickUpDateTime;
        const dropoffDT = attrs.searchCriteria?.dropOffDateTime;
        if (!pickupDT || !dropoffDT) return;

        const pickupCode =
          attrs.searchCriteria?.pickUpLocation?.airportCode ??
          car.tripLocations?.pickUpLocation?.locationId ??
          "";

        const vendor = car.vendor?.image?.description ?? "";

        const pickupDate = `${String(pickupDT.day).padStart(2, "0")}-${String(pickupDT.month).padStart(2, "0")}-${pickupDT.year}`;
        const pickupTime = `${String(pickupDT.hour).padStart(2, "0")}:${String(pickupDT.minute).padStart(2, "0")}`;
        const returnDate = `${String(dropoffDT.day).padStart(2, "0")}-${String(dropoffDT.month).padStart(2, "0")}-${dropoffDT.year}`;

        const days = Math.round(
          (new Date(dropoffDT.year, dropoffDT.month - 1, dropoffDT.day) -
            new Date(pickupDT.year, pickupDT.month - 1, pickupDT.day)) /
            86400000,
        );

        const transmission = getAttribute(
          car.vehicle,
          "Transmission",
          "transmission",
        );
        const mileage = getMileage(car.vehicle);
        const freeCancellation = getFreeCancellation(car);

        const payAtPickup =
          car.actionableConfidenceMessages?.some(
            (x) => x.value === "Pay at pick-up",
          ) ?? false;

        rows.push(
          [
            "expedia",
            pickupCode,
            pickupDate,
            pickupTime,
            returnDate,
            days,
            vendor.toLowerCase(),
            vendor,
            `${attrs.categoryCode ?? ""}${attrs.typeCode ?? ""}${attrs.transmissionDriveCode ?? ""}${attrs.fuelAcCode ?? ""}`,
            car.vehicle?.description ?? "",
            car.priceSummary?.total?.price?.currencyInfo?.code ?? "",
            car.priceSummary?.total?.price?.amount ?? "",
            car.priceSummary?.lead?.price?.amount ?? "",
            car.review?.rating ?? "",
            transmission,
            mileage,
            freeCancellation ? 1 : 0,
            payAtPickup ? 1 : 0,
            !payAtPickup ? 1 : 0,
          ]
            .map(csvField)
            .join(","),
        );
      });
    });

    download("expedia_results.csv", rows.join("\n"), "text/csv");
  }

  // =============================
  // JSON EXPORT
  // =============================
  function exportJSON() {
    download(
      "graphql_capture.json",
      JSON.stringify(logs, null, 2),
      "application/json",
    );
  }

  // =============================
  // STYLES
  // =============================
  function injectStyles() {
    const style = document.createElement("style");
    style.textContent = `
      #gql_panel {
        position:fixed; top:16px; right:16px; width:380px;
        background:#1a1d2edd; color:#e2e8f0;
        border:1px solid #ddc729; border-radius:12px;
        z-index:2147483647; font-family:'Segoe UI',system-ui,sans-serif; font-size:13px;
        backdrop-filter:blur(12px); box-shadow:0 8px 32px rgba(0,0,0,0.4);
        overflow:hidden; transition:width 0.3s,height 0.3s,opacity 0.3s;
      }
      #gql_panel.gql-minimized { width:60px; height:36px; border-radius:18px; cursor:pointer; display:flex; align-items:center; justify-content:center; }
      #gql_panel.gql-minimized > * { display:none; }
      #gql_panel.gql-minimized #gql_mini_badge { display:flex; }
      #gql_mini_badge { display:none; align-items:center; justify-content:center; color:#ddc729; font-weight:700; font-size:14px; }
      #gql_titlebar { display:flex; align-items:center; gap:8px; padding:8px 12px; background:rgba(221,199,41,0.08); border-bottom:1px solid rgba(221,199,41,0.15); user-select:none; }
      .gql-title-icon { color:#ddc729; font-size:12px; }
      .gql-title-text { flex:1; font-weight:600; font-size:12px; color:#f1f5f9; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
      #gql_minimize_btn { background:none; border:none; color:#94a3b8; cursor:pointer; font-size:16px; line-height:1; padding:2px 6px; border-radius:4px; transition:color 0.15s,background 0.15s; }
      #gql_minimize_btn:hover { color:#f1f5f9; background:rgba(255,255,255,0.1); }
      .gql-section { border-bottom:1px solid rgba(255,255,255,0.06); }
      .gql-section:last-child { border-bottom:none; }
      .gql-section-header { display:flex; align-items:center; gap:6px; padding:8px 12px; cursor:pointer; user-select:none; transition:background 0.15s; }
      .gql-section-header:hover { background:rgba(255,255,255,0.04); }
      .gql-toggle { font-size:10px; color:#ddc729; transition:transform 0.2s; width:14px; text-align:center; }
      .gql-toggle.collapsed { transform:rotate(-90deg); }
      .gql-section-title { font-weight:600; font-size:11px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; }
      .gql-section-badge { margin-left:auto; font-size:11px; color:#ddc729; font-weight:500; }
      .gql-section-content { overflow:hidden; transition:max-height 0.3s ease; max-height:400px; padding:0 12px 10px; }
      .gql-section-content.collapsed { max-height:0; padding-top:0; padding-bottom:0; }
      .gql-btn-row { display:flex; gap:6px; margin-top:8px; }
      .gql-btn {    width: 100%; min-height: 40px; border:none; border-radius:6px; font-size:12px; font-weight:500; cursor:pointer; transition:background 0.15s,transform 0.1s,opacity 0.15s; color:#fff; line-height:1.2; }
      .gql-btn:hover { opacity:0.9; transform:translateY(-1px); }
      .gql-btn:active { transform:translateY(0) scale(0.97); }
      .gql-btn:disabled { opacity:0.4; cursor:not-allowed; transform:none; }
      .gql-btn-start { background:#22c55e; }
      .gql-btn-start:hover { background:#16a34a; }
      .gql-btn-stop { background:#ef4444; }
      .gql-btn-stop:hover { background:#dc2626; }
      .gql-btn-action { background:#ddc729; color:#1a1d2e; }
      .gql-btn-action:hover { background:#c4b214; }
      .gql-btn-export { background:#3b82f6; }
      .gql-btn-export:hover { background:#2563eb; }
      .gql-speed-row { display:flex; align-items:center; gap:8px; margin-top:10px; }
      .gql-speed-row label { font-size:12px; color:#94a3b8; white-space:nowrap; }
      #gql_speed { flex:1; padding:5px 8px; background:#0f172a; color:#e2e8f0; border:1px solid rgba(221,199,41,0.3); border-radius:6px; font-size:12px; cursor:pointer; outline:none; }
      #gql_speed:focus { border-color:#ddc729; }
      #gql_output { width:100%; height:200px; background:#0f172a; color:#e2e8f0; border:1px solid rgba(255,255,255,0.06); border-radius:6px; padding:8px; font-size:11px; font-family:'Cascadia Code','Fira Code',monospace; resize:vertical; box-sizing:border-box; outline:none; }
      #gql_output:focus { border-color:rgba(221,199,41,0.3); }
      #gql_status { font-size:11px; color:#94a3b8; margin-top:6px; padding:6px 8px; background:rgba(15,23,42,0.5); border-radius:6px; line-height:1.4; }
      #gql_progress { margin-top:10px; padding:8px; background:rgba(15,23,42,0.5); border-radius:6px; }
      .gql-progress-bar { height:6px; background:rgba(255,255,255,0.08); border-radius:3px; overflow:hidden; }
      .gql-progress-fill { height:100%; width:0%; background:#ddc729; border-radius:3px; transition:width 0.3s ease; min-width:0; }
      .gql-progress-row { display:flex; justify-content:space-between; margin-top:5px; font-size:11px; }
      .gql-progress-text { color:#e2e8f0; }
      .gql-progress-pct { color:#ddc729; font-weight:600; }
      .gql-progress-time {  font-size: 12px; color: #cfe2fd; text-align: center; margin-top: -8px;}
    `;
    document.head.appendChild(style);
  }

  // =============================
  // FLOATING UI
  // =============================
  const panel = document.createElement("div");
  panel.id = "gql_panel";

  let panelMinimized = false;
  let sectionStates = { controls: true, output: true };

  panel.innerHTML = `
    <div id="gql_titlebar">
      <span class="gql-title-icon">●</span>
      <span class="gql-title-text">Expedia GraphQL Inspector</span>
      <button id="gql_minimize_btn">─</button>
    </div>
    <div class="gql-section">
      <div class="gql-section-header" data-section="controls">
        <span class="gql-toggle">▼</span>
        <span class="gql-section-title">Controls</span>
        <span class="gql-section-badge" id="gql_counter">0</span>
      </div>
      <div class="gql-section-content" id="gql_controls_content">
        <div class="gql-btn-row">
          <button class="gql-btn gql-btn-start" id="gql_start">▶ Start</button>
          <button class="gql-btn gql-btn-stop" id="gql_stop" disabled>■ Stop</button>
          <button class="gql-btn gql-btn-action" id="gql_auto">↻ Auto</button>
          <button class="gql-btn gql-btn-stop" id="gql_stopauto">◼ Stop Auto</button>
        </div>
        <div class="gql-btn-row">
           <button class="gql-btn gql-btn-action" id="gql_clear">✕ Clear</button>
          <button class="gql-btn gql-btn-export" id="gql_csv">⊞ CSV</button>
          <!-- gql_json button hidden; uncomment to restore raw JSON export -->
          <!-- <button class="gql-btn gql-btn-export" id="gql_json">⎔ JSON</button> -->
        </div>
        <div class="gql-speed-row">
          <label>Speed:</label>
          <select id="gql_speed">
            <option value="slow">Slow (4s)</option>
            <option value="medium" selected>Medium (1.5s)</option>
            <option value="fast">Fast (0.6s)</option>
          </select>
        </div>
        <div id="gql_progress" class="gql-progress" style="display:none">
          <div class="gql-progress-bar">
            <div class="gql-progress-fill" id="gql_progress_fill"></div>
          </div>
          <div class="gql-progress-row">
            <span class="gql-progress-text" id="gql_progress_text">0 of 0</span>
            <span class="gql-progress-pct" id="gql_progress_pct">0%</span>
          </div>
          <div class="gql-progress-time" id="gql_progress_time">⏱ 00:00</div>
        </div>
      </div>
    </div>
    <div class="gql-section">
      <div class="gql-section-header" data-section="output">
        <span class="gql-toggle">▼</span>
        <span class="gql-section-title">Output Log</span>
      </div>
      <div class="gql-section-content" id="gql_output_content">
        <div id="gql_status">Initializing...</div>
        <textarea id="gql_output" spellcheck="false"></textarea>
      </div>
    </div>
    <div id="gql_mini_badge">0</div>
  `;

  function toggleSection(name) {
    sectionStates[name] = !sectionStates[name];
    const content = document.getElementById(
      name === "controls" ? "gql_controls_content" : "gql_output_content",
    );
    const toggle = content.parentElement.querySelector(".gql-toggle");
    content.classList.toggle("collapsed", !sectionStates[name]);
    toggle.classList.toggle("collapsed", !sectionStates[name]);
  }

  function toggleMinimize() {
    panelMinimized = !panelMinimized;
    panel.classList.toggle("gql-minimized", panelMinimized);
  }

  let progressTimer = null;
  let progressStartTime = null;
  let progressTotal = 0;

  function startProgress(total) {
    progressTotal = total;
    progressStartTime = Date.now();
    document.getElementById("gql_progress").style.display = "block";
    if (progressTimer) clearInterval(progressTimer);
    progressTimer = setInterval(() => {
      const el = document.getElementById("gql_progress_time");
      if (!el || !progressStartTime) return;
      const sec = Math.floor((Date.now() - progressStartTime) / 1000);
      el.textContent = `⏱ ${String(Math.floor(sec / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
    }, 1000);
    updateProgress(0);
  }

  function updateProgress(current) {
    const fill = document.getElementById("gql_progress_fill");
    const text = document.getElementById("gql_progress_text");
    const pct = document.getElementById("gql_progress_pct");
    if (!fill) return;
    const percent =
      progressTotal > 0 ? Math.min((current / progressTotal) * 100, 100) : 0;
    fill.style.width = Math.round(percent) + "%";
    if (text) text.textContent = `${current} of ${progressTotal}`;
    if (pct) pct.textContent = Math.round(percent) + "%";
  }

  function completeProgress() {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
  }

  function resetProgress() {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    const el = document.getElementById("gql_progress");
    if (el) el.style.display = "none";
    const fill = document.getElementById("gql_progress_fill");
    if (fill) fill.style.width = "0%";
    progressTotal = 0;
    progressStartTime = null;
  }

  function initButtons() {
    // Section toggles
    document.querySelectorAll(".gql-section-header").forEach((h) => {
      h.addEventListener("click", () => toggleSection(h.dataset.section));
    });

    // Minimize
    document
      .getElementById("gql_minimize_btn")
      .addEventListener("click", (e) => {
        e.stopPropagation();
        toggleMinimize();
      });
    panel.addEventListener("click", () => {
      if (panelMinimized) toggleMinimize();
    });

    // Speed
    const speedSel = document.getElementById("gql_speed");
    loadSpeed();
    speedSel.value = currentSpeed;
    speedSel.addEventListener("change", (e) => {
      applySpeed(e.target.value);
      saveSpeed();
    });

    // Buttons
    document.getElementById("gql_start").addEventListener("click", () => {
      capturing = true;
      document.getElementById("gql_start").disabled = true;
      document.getElementById("gql_stop").disabled = false;
      setStatus("Capturing...");
    });
    document.getElementById("gql_stop").addEventListener("click", () => {
      capturing = false;
      document.getElementById("gql_start").disabled = false;
      document.getElementById("gql_stop").disabled = true;
      setStatus("Stopped");
    });
    document.getElementById("gql_auto").addEventListener("click", () => {
      if (!latestGraphQL) {
        setStatus(
          "Perform a new car search or refresh the page to capture data again, then click Auto",
        );
        return;
      }
      if (latestGraphQL.loadMore?.searchPagination?.hasNextPage === false) {
        setStatus("All pages already captured. Press Clear to start fresh.");
        return;
      }
      autoLoadAll();
    });
    document.getElementById("gql_stopauto").addEventListener("click", () => {
      if (!autoLoading) {
        setStatus("Auto load is not running");
        return;
      }
      stopAutoLoad();
      resetProgress();
      setStatus("Stopping...");
    });
    document.getElementById("gql_clear").addEventListener("click", () => {
      stopAutoLoad();
      logs.length = 0;
      capturedPages.clear();
      latestGraphQL = null;
      capturing = false;
      document.getElementById("gql_start").disabled = false;
      document.getElementById("gql_stop").disabled = true;
      document.getElementById("gql_output").value = "";
      resetProgress();
      updateCounter();
      setStatus(
        "Cleared. Perform a new car search or refresh the page to start again.",
      );
      localStorage.removeItem(CONFIG.storageKey);
    });
    document.getElementById("gql_csv").addEventListener("click", exportCSV);

    // Initial state: capturing starts true, so Start disabled, Stop enabled
    if (capturing) {
      document.getElementById("gql_start").disabled = true;
      document.getElementById("gql_stop").disabled = false;
    }
  }

  function injectPanel() {
    if (document.getElementById("gql_panel")) return;
    if (!document.body) {
      requestAnimationFrame(injectPanel);
      return;
    }
    injectStyles();
    document.body.appendChild(panel);
    initButtons();
    updateCounter();
    loadState();
    setStatus(
      logs.length > 0 ? `Resumed – ${logs.length} pages` : "Capturing...",
    );
    if (logs.length > 0) {
      document.getElementById("gql_start").disabled = true;
      document.getElementById("gql_stop").disabled = false;
    }
  }

  injectPanel();

  // =============================
  // FETCH HOOK
  // =============================
  const originalFetch = window.fetch;

  window.fetch = async function (...args) {
    const request = args[0];
    const options = args[1] || {};

    let url = "";
    if (typeof request === "string") {
      url = request;
    } else if (request instanceof Request) {
      url = request.url;
    }

    if (!url.includes("/graphql")) {
      return originalFetch.apply(this, args);
    }

    const response = await originalFetch.apply(this, args);

    if (!capturing) return response;

    // Skip capture if this is our own replay request
    if (__replaying) return response;

    let requestBody = null;
    try {
      if (options.body) {
        requestBody = await parseBody(options.body);
      } else if (request instanceof Request && request.method !== "GET") {
        const clone = request.clone();
        const text = await clone.text();
        if (text.trim()) requestBody = JSON.parse(text);
      }
    } catch (e) {
      console.error("Failed to parse request body", e);
    }

    if (!requestBody || requestBody.operationName !== "CarSearchV3")
      return response;

    try {
      const json = await response.clone().json();

      const listings =
        json?.data?.carSearchOrRecommendations?.carSearchResults?.listings;
      const searchId =
        json?.data?.carSearchOrRecommendations?.carSearchResults
          ?.carsShoppingContext?.searchId;
      const loadMore =
        json?.data?.carSearchOrRecommendations?.carSearchResults
          ?.loadMoreAction;

      const entry = {
        time: new Date().toISOString(),
        operation: requestBody.operationName,
        url,
        searchId,
        listingCount: Array.isArray(listings) ? listings.length : 0,
        request: structuredClone(requestBody),
        response: structuredClone(json),
        loadMore,
        requestHeaders: captureHeaders(request, options),
        variables: structuredClone(requestBody.variables),
        query: requestBody.query,
      };

      // Dedup key: searchId + startingIndex from the response
      const pageKey = [
        entry.searchId,
        entry.loadMore?.searchPagination?.startingIndex ?? 0,
      ].join(":");

      if (capturedPages.has(pageKey)) return response;
      capturedPages.add(pageKey);

      logs.push(entry);
      saveState();

      latestGraphQL = entry;
      updateCounter();

      const pageOffset = loadMore?.searchPagination?.startingIndex ?? 0;
      setStatus(`Captured ${logs.length} pages (offset ${pageOffset})`);
      logUI(`✔ CarSearchV3 | ${entry.listingCount} listings`);

      if (loadMore?.searchPagination?.hasNextPage === false) {
        capturing = false;
        setStatus("Finished – all pages captured");
      }
    } catch (err) {
      console.error(err);
    }

    return response;
  };
})();
