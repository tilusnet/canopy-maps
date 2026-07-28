const LAYER_STATE_STORAGE_KEY = "london-tree-layers:layerState:v1";
const MAP_VIEW_STORAGE_KEY = "london-tree-layers:mapView:v1";
const APP_VERSION = "v1.01";

// Built-in fallbacks, used if config.json is missing or a field is absent.
const DEFAULT_SETTINGS = {
  appTitle: "Canopy Maps",
  appDescription: "Stacking maps with transparency",
  map: {
    center: [51.5074, -0.1278],
    defaultZoom: 12,
    locateZoom: 15,
  },
  search: {
    bbox: "-0.61,51.28,0.32,51.70",
    debounceMs: 300,
    minQueryLength: 3,
    resultLimit: 5,
  },
  geolocation: {
    timeoutMs: 10000,
    watchMaxAgeMs: 5000,
  },
};

let settings = DEFAULT_SETTINGS;

// layerState[0] = top of stack & top of the displayed list, layerState[length-1] = bottom
const layerState = [];
let map;
let dragCtx = null;
let layerConfigs = [];
let locationMarker = null;
let accuracyCircle = null;
let watchId = null;

const USER_LOCATION_ICON = L.divIcon({
  className: "user-location-marker",
  html: '<span class="user-location-pulse"></span><span class="user-location-dot"></span>',
  iconSize: [16, 16],
  iconAnchor: [8, 8],
});

function showFatalError(message) {
  const el = document.getElementById("fatal-error");
  el.textContent = message;
  el.hidden = false;
}

function setStatus(elId, message, isError) {
  const el = document.getElementById(elId);
  if (!message) {
    el.hidden = true;
    el.textContent = "";
    return;
  }
  el.textContent = message;
  el.hidden = false;
  el.classList.toggle("error", Boolean(isError));
}

async function loadAppSettings() {
  try {
    const response = await fetch("config.json");
    if (!response.ok) {
      throw new Error(`config.json fetch failed: ${response.status}`);
    }
    const loaded = await response.json();
    return {
      ...DEFAULT_SETTINGS,
      ...loaded,
      map: { ...DEFAULT_SETTINGS.map, ...loaded.map },
      search: { ...DEFAULT_SETTINGS.search, ...loaded.search },
      geolocation: { ...DEFAULT_SETTINGS.geolocation, ...loaded.geolocation },
    };
  } catch (err) {
    console.warn("Could not load config.json, using built-in defaults:", err);
    return DEFAULT_SETTINGS;
  }
}

function applyBrandingSettings() {
  document.title = settings.appTitle;
  document.getElementById("app-title").textContent = settings.appTitle;
  document.getElementById("app-description").textContent = settings.appDescription;
  document.getElementById("app-footer").innerHTML =
    'tilusNet Labs · <a href="https://github.com/tilusnet/canopy-maps" target="_blank" rel="noopener">Canopy Maps</a> ' +
    APP_VERSION;
}

function createMap(center, zoom) {
  const m = L.map("map", { zoomControl: false }).setView(center, zoom);
  L.control.zoom({ position: "topleft" }).addTo(m);
  return m;
}

function saveMapView() {
  try {
    const center = map.getCenter();
    const view = {
      lat: Number(center.lat.toFixed(5)),
      lng: Number(center.lng.toFixed(5)),
      zoom: map.getZoom(),
    };
    localStorage.setItem(MAP_VIEW_STORAGE_KEY, JSON.stringify(view));
  } catch (err) {
    console.warn("Could not save map view to localStorage:", err);
  }
}

function loadSavedMapView() {
  try {
    const raw = localStorage.getItem(MAP_VIEW_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn("Could not read saved map view from localStorage:", err);
    return null;
  }
}

async function loadLayerConfigs() {
  const response = await fetch("layers.json");
  if (!response.ok) {
    throw new Error(`layers.json fetch failed: ${response.status}`);
  }
  return response.json();
}

function resolveUrl(url) {
  const token = window.APP_CONFIG && window.APP_CONFIG.mapboxAccessToken;
  return url.replace("{mapboxAccessToken}", token || "");
}

function saveLayerState() {
  try {
    const saved = layerState.map((entry) => ({
      id: entry.id,
      visible: entry.visible,
      opacity: entry.opacity,
    }));
    localStorage.setItem(LAYER_STATE_STORAGE_KEY, JSON.stringify(saved));
  } catch (err) {
    console.warn("Could not save layer state to localStorage:", err);
  }
}

function loadSavedLayerState() {
  try {
    const raw = localStorage.getItem(LAYER_STATE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.warn("Could not read saved layer state from localStorage:", err);
    return null;
  }
}

// Applies a previously saved order/visibility/opacity to the freshly built
// layerState. Saved entries whose id no longer exists in layers.json are
// ignored; layers newly added to layers.json (not in the saved state) keep
// their default position/visibility so config edits degrade gracefully.
function applySavedLayerState(saved) {
  if (!Array.isArray(saved) || saved.length === 0) {
    return;
  }

  const byId = new Map(layerState.map((entry) => [entry.id, entry]));
  const reordered = [];
  saved.forEach((savedEntry) => {
    const entry = byId.get(savedEntry.id);
    if (!entry) {
      return;
    }
    entry.visible = Boolean(savedEntry.visible);
    entry.opacity = typeof savedEntry.opacity === "number" ? savedEntry.opacity : entry.opacity;
    byId.delete(savedEntry.id);
    reordered.push(entry);
  });
  // Any layers not present in the saved state (newly added to layers.json)
  // keep their default relative order, appended after the restored ones.
  layerState.forEach((entry) => {
    if (byId.has(entry.id)) {
      reordered.push(entry);
    }
  });

  layerState.length = 0;
  layerState.push(...reordered);

  layerState.forEach((entry) => {
    entry.leafletLayer.setOpacity(entry.opacity);
    const onMap = map.hasLayer(entry.leafletLayer);
    if (entry.visible && !onMap) {
      entry.leafletLayer.addTo(map);
    } else if (!entry.visible && onMap) {
      map.removeLayer(entry.leafletLayer);
    }
  });

  restackLayers();
}

function resetToDefaults() {
  const byId = new Map(layerState.map((entry) => [entry.id, entry]));
  const defaults = [];
  // configs are bottom-to-top; unshift builds the top-to-bottom layerState order.
  layerConfigs.forEach((cfg) => {
    const entry = byId.get(cfg.id);
    if (!entry) {
      return;
    }
    entry.opacity = cfg.defaultOpacity ?? 1;
    entry.visible = Boolean(cfg.defaultVisible);
    defaults.unshift(entry);
  });

  layerState.length = 0;
  layerState.push(...defaults);

  layerState.forEach((entry) => {
    entry.leafletLayer.setOpacity(entry.opacity);
    const onMap = map.hasLayer(entry.leafletLayer);
    if (entry.visible && !onMap) {
      entry.leafletLayer.addTo(map);
    } else if (!entry.visible && onMap) {
      map.removeLayer(entry.leafletLayer);
    }
  });

  restackLayers();
  renderLayerPanel();

  try {
    localStorage.removeItem(LAYER_STATE_STORAGE_KEY);
  } catch (err) {
    console.warn("Could not clear saved layer state from localStorage:", err);
  }
}

function buildLayers(configs) {
  configs.forEach((cfg) => {
    if (!cfg.id || !cfg.url || !cfg.title) {
      console.warn("Skipping invalid layer config (missing id/url/title):", cfg);
      return;
    }

    const options = {
      attribution: cfg.attribution || "",
      tileSize: cfg.tileSize || 256,
      maxZoom: cfg.maxZoom || 19,
      opacity: cfg.defaultOpacity ?? 1,
    };
    if (cfg.subdomains) {
      options.subdomains = cfg.subdomains;
    }

    const leafletLayer = L.tileLayer(resolveUrl(cfg.url), options);

    const entry = {
      id: cfg.id,
      title: cfg.title,
      caption: cfg.caption || "",
      leafletLayer,
      opacity: cfg.defaultOpacity ?? 1,
      visible: Boolean(cfg.defaultVisible),
    };
    // configs are given bottom-to-top; layerState is kept top-to-bottom
    // (matching the displayed list order), so new entries go to the front.
    layerState.unshift(entry);

    if (entry.visible) {
      leafletLayer.addTo(map);
    }
  });

  restackLayers();
}

function restackLayers() {
  // layerState[0] is the topmost entry. Iterate back-to-front (bottom to
  // top) calling bringToFront() so each call supersedes the previous one —
  // the final call (layerState[0]) ends up frontmost.
  for (let i = layerState.length - 1; i >= 0; i--) {
    const entry = layerState[i];
    if (map.hasLayer(entry.leafletLayer)) {
      entry.leafletLayer.bringToFront();
    }
  }
}

function toggleVisibility(entry) {
  entry.visible = !entry.visible;
  if (entry.visible) {
    entry.leafletLayer.addTo(map);
  } else {
    map.removeLayer(entry.leafletLayer);
  }
  restackLayers();
  renderLayerPanel();
  saveLayerState();
}

function findIndexById(id) {
  return layerState.findIndex((entry) => entry.id === id);
}

function moveEntryById(id, toIndex) {
  const fromIndex = findIndexById(id);
  if (fromIndex === -1 || fromIndex === toIndex) {
    return;
  }
  const [entry] = layerState.splice(fromIndex, 1);
  layerState.splice(toIndex, 0, entry);
}

function focusHandle(entryId) {
  const handle = document.querySelector(`li[data-entry-id="${entryId}"] .drag-handle`);
  if (handle) {
    handle.focus();
  }
}

function onHandleKeydown(e, entry) {
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") {
    return;
  }
  e.preventDefault();
  const fromIndex = findIndexById(entry.id);
  const toIndex = e.key === "ArrowUp" ? fromIndex - 1 : fromIndex + 1;
  if (toIndex < 0 || toIndex >= layerState.length) {
    return;
  }
  moveEntryById(entry.id, toIndex);
  restackLayers();
  renderLayerPanel();
  focusHandle(entry.id);
  saveLayerState();
}

function onDragPointerMove(e) {
  if (!dragCtx || e.pointerId !== dragCtx.pointerId) {
    return;
  }
  e.preventDefault();
  dragCtx.ghost.style.top = `${e.clientY - dragCtx.offsetY}px`;

  const items = Array.from(document.querySelectorAll("#layer-list > li"));
  const fromIndex = findIndexById(dragCtx.entryId);
  for (let i = 0; i < items.length; i++) {
    const rect = items[i].getBoundingClientRect();
    if (e.clientY >= rect.top && e.clientY <= rect.bottom && i !== fromIndex) {
      moveEntryById(dragCtx.entryId, i);
      restackLayers();
      renderLayerPanel();
      saveLayerState();
      break;
    }
  }
}

function endDrag() {
  if (!dragCtx) {
    return;
  }
  const draggedId = dragCtx.entryId;
  dragCtx.ghost.remove();
  document.removeEventListener("pointermove", onDragPointerMove);
  document.removeEventListener("pointerup", endDrag);
  document.removeEventListener("pointercancel", endDrag);
  dragCtx = null;
  renderLayerPanel();
  focusHandle(draggedId);
}

function startDrag(e, entry, li) {
  e.preventDefault();
  const rect = li.getBoundingClientRect();

  const ghost = li.cloneNode(true);
  ghost.classList.add("drag-ghost");
  ghost.style.width = `${rect.width}px`;
  ghost.style.left = `${rect.left}px`;
  ghost.style.top = `${rect.top}px`;
  ghost.querySelectorAll("button, input").forEach((el) => {
    el.disabled = true;
  });
  document.body.appendChild(ghost);

  dragCtx = {
    entryId: entry.id,
    pointerId: e.pointerId,
    ghost,
    offsetY: e.clientY - rect.top,
  };

  document.addEventListener("pointermove", onDragPointerMove);
  document.addEventListener("pointerup", endDrag);
  document.addEventListener("pointercancel", endDrag);
  renderLayerPanel();
}

function renderLayerPanel() {
  const list = document.getElementById("layer-list");
  list.innerHTML = "";

  layerState.forEach((entry) => {
    const li = document.createElement("li");
    li.dataset.entryId = entry.id;
    if (dragCtx && dragCtx.entryId === entry.id) {
      li.classList.add("dragging");
    }

    const controlsRow = document.createElement("div");
    controlsRow.className = "layer-controls-row";

    const handle = document.createElement("button");
    handle.type = "button";
    handle.className = "drag-handle";
    handle.setAttribute("aria-label", `Reorder ${entry.title} (drag, or use arrow keys)`);
    handle.innerHTML =
      '<svg viewBox="0 0 24 24" width="14" height="18" aria-hidden="true">' +
      '<circle cx="8" cy="6" r="1.6" fill="currentColor"/><circle cx="16" cy="6" r="1.6" fill="currentColor"/>' +
      '<circle cx="8" cy="12" r="1.6" fill="currentColor"/><circle cx="16" cy="12" r="1.6" fill="currentColor"/>' +
      '<circle cx="8" cy="18" r="1.6" fill="currentColor"/><circle cx="16" cy="18" r="1.6" fill="currentColor"/>' +
      "</svg>";
    handle.addEventListener("pointerdown", (e) => startDrag(e, entry, li));
    handle.addEventListener("keydown", (e) => onHandleKeydown(e, entry));

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = entry.visible;
    checkbox.addEventListener("change", () => toggleVisibility(entry));

    const textDiv = document.createElement("div");
    textDiv.className = "layer-text";
    const titleDiv = document.createElement("div");
    titleDiv.className = "layer-title";
    titleDiv.textContent = entry.title;
    textDiv.appendChild(titleDiv);
    if (entry.caption) {
      const captionDiv = document.createElement("div");
      captionDiv.className = "layer-caption";
      captionDiv.textContent = entry.caption;
      textDiv.appendChild(captionDiv);
    }

    controlsRow.appendChild(handle);
    controlsRow.appendChild(checkbox);
    controlsRow.appendChild(textDiv);

    const slider = document.createElement("input");
    slider.type = "range";
    slider.className = "layer-opacity";
    slider.min = "0";
    slider.max = "100";
    slider.value = String(Math.round(entry.opacity * 100));
    slider.setAttribute("aria-label", `${entry.title} opacity`);
    slider.addEventListener("input", (e) => {
      const value = Number(e.target.value) / 100;
      entry.opacity = value;
      entry.leafletLayer.setOpacity(value);
    });
    slider.addEventListener("change", saveLayerState);

    li.appendChild(controlsRow);
    li.appendChild(slider);
    list.appendChild(li);
  });
}

function wireSearch() {
  const input = document.getElementById("search-input");
  const resultsEl = document.getElementById("search-results");
  let debounceTimer;

  input.addEventListener("input", () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(input.value), settings.search.debounceMs);
  });

  function clearResults() {
    resultsEl.innerHTML = "";
  }

  async function runSearch(query) {
    setStatus("search-status", null);
    if (!query || query.trim().length < settings.search.minQueryLength) {
      clearResults();
      return;
    }

    const token = window.APP_CONFIG && window.APP_CONFIG.mapboxAccessToken;
    if (!token) {
      setStatus("search-status", "Missing Mapbox token — see config.js.", true);
      return;
    }

    const url =
      `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(query)}.json` +
      `?access_token=${token}&autocomplete=true&limit=${settings.search.resultLimit}&bbox=${settings.search.bbox}`;

    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`Geocoding request failed: ${resp.status}`);
      }
      const data = await resp.json();
      renderResults(data.features || []);
    } catch (err) {
      setStatus("search-status", "Search failed — check your connection or Mapbox token.", true);
      clearResults();
    }
  }

  function renderResults(features) {
    clearResults();
    features.forEach((feature) => {
      const li = document.createElement("li");
      li.textContent = feature.place_name;
      li.addEventListener("click", () => {
        const [lon, lat] = feature.center;
        map.flyTo([lat, lon], settings.map.locateZoom);
        clearResults();
        input.value = feature.place_name;
      });
      resultsEl.appendChild(li);
    });
  }
}

function describeGeolocationError(err) {
  switch (err.code) {
    case err.PERMISSION_DENIED:
      return "Location permission denied.";
    case err.POSITION_UNAVAILABLE:
      return "Location unavailable.";
    case err.TIMEOUT:
      return "Location request timed out.";
    default:
      return "Unable to determine location.";
  }
}

function updateLocationMarker(lat, lng, accuracy) {
  const latlng = [lat, lng];
  if (!locationMarker) {
    locationMarker = L.marker(latlng, {
      icon: USER_LOCATION_ICON,
      interactive: false,
      zIndexOffset: 1000,
      keyboard: false,
    }).addTo(map);
  } else {
    locationMarker.setLatLng(latlng);
  }

  if (typeof accuracy === "number") {
    if (!accuracyCircle) {
      accuracyCircle = L.circle(latlng, {
        radius: accuracy,
        color: "#1a73e8",
        weight: 1,
        fillColor: "#1a73e8",
        fillOpacity: 0.12,
        interactive: false,
      }).addTo(map);
    } else {
      accuracyCircle.setLatLng(latlng);
      accuracyCircle.setRadius(accuracy);
    }
  }
}

function wireLocate() {
  document.getElementById("locate-btn").addEventListener("click", () => {
    if (!("geolocation" in navigator)) {
      setStatus("locate-status", "Geolocation not supported by this browser.", true);
      return;
    }

    setStatus("locate-status", "Locating…", false);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        updateLocationMarker(latitude, longitude, accuracy);
        map.flyTo([latitude, longitude], settings.map.locateZoom);
        setStatus("locate-status", null);
      },
      (err) => {
        setStatus("locate-status", describeGeolocationError(err), true);
      },
      { enableHighAccuracy: true, timeout: settings.geolocation.timeoutMs }
    );
  });
}

function startFollowingLocation() {
  if (!("geolocation" in navigator)) {
    setStatus("locate-status", "Geolocation not supported by this browser.", true);
    document.getElementById("follow-location-checkbox").checked = false;
    return;
  }

  setStatus("locate-status", "Following your location…", false);
  watchId = navigator.geolocation.watchPosition(
    (pos) => {
      const { latitude, longitude, accuracy } = pos.coords;
      updateLocationMarker(latitude, longitude, accuracy);
      map.panTo([latitude, longitude], { animate: true, duration: 0.5 });
      setStatus("locate-status", "Following your location…", false);
    },
    (err) => {
      setStatus("locate-status", describeGeolocationError(err), true);
      document.getElementById("follow-location-checkbox").checked = false;
      stopFollowingLocation();
    },
    { enableHighAccuracy: true, maximumAge: settings.geolocation.watchMaxAgeMs, timeout: settings.geolocation.timeoutMs }
  );
}

function stopFollowingLocation() {
  if (watchId !== null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
  setStatus("locate-status", null);
}

function wireFollowLocation() {
  document.getElementById("follow-location-checkbox").addEventListener("change", (e) => {
    if (e.target.checked) {
      startFollowingLocation();
    } else {
      stopFollowingLocation();
    }
  });
}

function wirePanelToggle() {
  const toggleBtn = document.getElementById("panel-toggle");
  const panel = document.getElementById("panel");
  toggleBtn.addEventListener("click", () => {
    const hidden = panel.classList.toggle("panel-hidden");
    toggleBtn.textContent = hidden ? "☰" : "✕";
    toggleBtn.setAttribute("aria-label", hidden ? "Show panel" : "Hide panel");
    toggleBtn.setAttribute("aria-expanded", String(!hidden));
  });
}

function wireResetButton() {
  document.getElementById("reset-layers-btn").addEventListener("click", resetToDefaults);
}

function parseSharedStateFromHash() {
  const match = location.hash.match(/^#state=(.+)$/);
  if (!match) {
    return null;
  }
  try {
    const parsed = JSON.parse(decodeURIComponent(match[1]));
    if (!parsed || !Array.isArray(parsed.v) || !Array.isArray(parsed.c) || typeof parsed.z !== "number") {
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn("Could not parse shared state from URL:", err);
    return null;
  }
}

function buildShareableStateParam() {
  const center = map.getCenter();
  const state = {
    v: layerState.map((entry) => ({ id: entry.id, visible: entry.visible, opacity: entry.opacity })),
    c: [Number(center.lat.toFixed(5)), Number(center.lng.toFixed(5))],
    z: map.getZoom(),
  };
  return encodeURIComponent(JSON.stringify(state));
}

const COPY_LINK_CHECK_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">' +
  '<path d="M5 12.5 L10 17.5 L19 6.5" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>' +
  "</svg>";

function wireCopyLink() {
  const btn = document.getElementById("copy-link-btn");
  const originalIcon = btn.innerHTML;
  btn.addEventListener("click", async () => {
    const url = `${location.origin}${location.pathname}#state=${buildShareableStateParam()}`;
    try {
      await navigator.clipboard.writeText(url);
      btn.innerHTML = COPY_LINK_CHECK_ICON;
      btn.setAttribute("title", "Copied!");
      setTimeout(() => {
        btn.innerHTML = originalIcon;
        btn.setAttribute("title", "Copy shareable link");
      }, 1500);
    } catch (err) {
      console.warn("Could not copy link to clipboard:", err);
    }
  });
}

async function init() {
  wirePanelToggle();

  settings = await loadAppSettings();
  applyBrandingSettings();

  if (!window.APP_CONFIG) {
    showFatalError("Missing config.js — copy config.example.js to config.js and add your Mapbox token.");
    return;
  }

  const sharedState = parseSharedStateFromHash();
  const savedView = sharedState ? null : loadSavedMapView();
  const initialCenter = sharedState ? sharedState.c : savedView ? [savedView.lat, savedView.lng] : settings.map.center;
  const initialZoom = sharedState ? sharedState.z : savedView ? savedView.zoom : settings.map.defaultZoom;

  map = createMap(initialCenter, initialZoom);
  map.on("moveend", saveMapView);

  let configs;
  try {
    configs = await loadLayerConfigs();
  } catch (err) {
    showFatalError("Failed to load layers.json — check the file exists and is valid JSON.");
    return;
  }

  layerConfigs = configs;
  buildLayers(configs);

  if (sharedState) {
    // A shared link takes priority over — and becomes — the new local baseline.
    applySavedLayerState(sharedState.v);
    saveLayerState();
    saveMapView();
  } else {
    applySavedLayerState(loadSavedLayerState());
  }

  renderLayerPanel();
  wireSearch();
  wireLocate();
  wireFollowLocation();
  wireResetButton();
  wireCopyLink();
}

window.addEventListener("DOMContentLoaded", init);
