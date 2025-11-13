/**
 * @fileoverview Main application logic for the Rail Flow visual calculator.
 *
 * Responsibilities include:
 * - Bootstrapping DOM references and managing UI interactions.
 * - Parsing/stylising uploaded SVG maps and computing track geometry.
 * - Simulating train motion, detecting spacing conflicts, and rendering the viewport.
 * - Importing/exporting scenarios, metadata, and generating reports.
 *
 * The file is organised into sections separated by banner comments. When adding new
 * features, prefer to extend the relevant section to keep the code navigable.
 */

// ============================================================================
// Constants & Configuration
// ============================================================================

const SAFE_DISTANCE_KM = 0.1; // 100 m
const DEFAULT_TRACK_LENGTH = 240;
const DEFAULT_CROSSINGS = [60, 120, 180, 220];
const MAX_TRAINS = 1000;
const TRACK_PADDING_X = 80;
const VIEWBOX_WIDTH = 1200;
const TRACK_VIEW_WIDTH = VIEWBOX_WIDTH - TRACK_PADDING_X * 2;
const DEFAULT_VERTICAL_MIN = 70;
const DEFAULT_VERTICAL_MAX = 220;
const DEFAULT_DIAGONAL_TOP = 90;
const DEFAULT_DIAGONAL_BOTTOM = 210;
const DEFAULT_PATH_DEFINITIONS = [
    {
        id: "east-west",
        label: "East–West",
        shortLabel: "E/W",
        stroke: "rgba(109, 248, 255, 0.82)",
        width: 6,
        computePoint: ratio => ({
            x: TRACK_PADDING_X + ratio * TRACK_VIEW_WIDTH,
            y: 150
        })
    },
    {
        id: "north-south",
        label: "North–South",
        shortLabel: "N/S",
        stroke: "rgba(99, 242, 210, 0.75)",
        width: 5,
        computePoint: ratio => ({
            x: TRACK_PADDING_X + TRACK_VIEW_WIDTH / 2,
            y: DEFAULT_VERTICAL_MIN + ratio * (DEFAULT_VERTICAL_MAX - DEFAULT_VERTICAL_MIN)
        })
    },
    {
        id: "diagonal-ne",
        label: "Diagonal NE",
        shortLabel: "Diag NE",
        stroke: "rgba(255, 146, 108, 0.7)",
        width: 5,
        computePoint: ratio => ({
            x: TRACK_PADDING_X + ratio * TRACK_VIEW_WIDTH,
            y: DEFAULT_DIAGONAL_BOTTOM - ratio * (DEFAULT_DIAGONAL_BOTTOM - DEFAULT_DIAGONAL_TOP)
        })
    },
    {
        id: "diagonal-se",
        label: "Diagonal SE",
        shortLabel: "Diag SE",
        stroke: "rgba(147, 197, 253, 0.68)",
        width: 5,
        computePoint: ratio => ({
            x: TRACK_PADDING_X + ratio * TRACK_VIEW_WIDTH,
            y: DEFAULT_DIAGONAL_TOP + ratio * (DEFAULT_DIAGONAL_BOTTOM - DEFAULT_DIAGONAL_TOP)
        })
    }
];

// ============================================================================
// Geometry Helpers
// ============================================================================

const getFallbackPathPoint = (pathIndex, ratio) => {
    const definition = DEFAULT_PATH_DEFINITIONS[pathIndex] || DEFAULT_PATH_DEFINITIONS[0];
    const clamped = Math.min(Math.max(ratio, 0), 1);
    return definition.computePoint(clamped);
};

const projectOntoSegment = (startPoint, endPoint, targetPoint) => {
    const dx = endPoint.x - startPoint.x;
    const dy = endPoint.y - startPoint.y;
    const lengthSq = dx * dx + dy * dy || 1;
    const t = ((targetPoint.x - startPoint.x) * dx + (targetPoint.y - startPoint.y) * dy) / lengthSq;
    const ratio = Math.min(Math.max(t, 0), 1);
    const projectionX = startPoint.x + dx * ratio;
    const projectionY = startPoint.y + dy * ratio;
    const distX = targetPoint.x - projectionX;
    const distY = targetPoint.y - projectionY;
    return {
        ratio,
        distanceSq: distX * distX + distY * distY
    };
};

const projectPointToFallbackPaths = point => {
    let best = null;
    DEFAULT_PATH_DEFINITIONS.forEach((pathDef, idx) => {
        const start = pathDef.computePoint(0);
        const end = pathDef.computePoint(1);
        const projection = projectOntoSegment(start, end, point);
        if (!best || projection.distanceSq < best.distanceSq) {
            best = {
                pathIndex: idx,
                ratio: projection.ratio,
                distanceSq: projection.distanceSq
            };
        }
    });
    return best;
};

// ============================================================================
// Map Styling & SVG Management
// ============================================================================

const stylizeCustomTrackElement = (element, index) => {
    if (!element || element.dataset.railStyled === "true" || !element.parentNode) {
        return;
    }
    const parent = mapTrackGroupRef || element.parentNode;
    const ballast = element.cloneNode(true);
    ballast.removeAttribute("id");
    ballast.classList.add("map-track-ballast");
    ballast.setAttribute("fill", "none");
    ballast.setAttribute(
        "stroke",
        index === 0 ? "rgba(15, 23, 42, 0.65)" : "rgba(20, 32, 52, 0.55)"
    );
    ballast.setAttribute("stroke-width", index === 0 ? "14" : "10");
    ballast.setAttribute("stroke-linecap", "round");
    ballast.setAttribute("stroke-linejoin", "round");
    ballast.setAttribute("pointer-events", "none");

    const rail = element.cloneNode(true);
    rail.removeAttribute("id");
    rail.classList.add("map-track-rail");
    rail.setAttribute("fill", "none");
    rail.setAttribute(
        "stroke",
        index === 0 ? "rgba(109, 248, 255, 0.75)" : "rgba(128, 178, 255, 0.55)"
    );
    rail.setAttribute("stroke-width", index === 0 ? "6" : "4");
    rail.setAttribute("stroke-linecap", "round");
    rail.setAttribute("stroke-linejoin", "round");
    rail.setAttribute("pointer-events", "none");

    if (parent && typeof parent.appendChild === "function") {
        parent.appendChild(ballast);
        parent.appendChild(rail);
    } else if (element.parentNode) {
        element.parentNode.insertBefore(ballast, element);
        element.parentNode.insertBefore(rail, element);
    }
    element.setAttribute("stroke", "none");
    element.setAttribute("fill", "none");
    element.setAttribute("opacity", "0");
    element.dataset.railStyled = "true";
};

const ensureMapTrackGroup = rootSvg => {
    if (!rootSvg) {
        mapTrackGroupRef = null;
        return null;
    }
    let trackGroup = rootSvg.querySelector("#track-base");
    if (!trackGroup) {
        trackGroup = document.createElementNS("http://www.w3.org/2000/svg", "g");
        trackGroup.setAttribute("id", "track-base");
        rootSvg.insertBefore(trackGroup, rootSvg.firstChild);
    }
    mapTrackGroupRef = trackGroup;
    return trackGroup;
};
const DEFAULT_STATIONS = {
    start: "Origin Terminal",
    end: "Summit Station"
};

const DEFAULT_TRAINS = [
    { name: "A", departure: "08:00", speed: 80, distance: 240, cars: 8, carLength: 20, color: "#6df8ff", tag: "Express" },
    { name: "B", departure: "08:30", speed: 60, distance: 240, cars: 10, carLength: 25, color: "#ff926c", tag: "Local" },
    { name: "C", departure: "09:00", speed: 100, distance: 240, cars: 6, carLength: 18, color: "#63f5b2", tag: "Rapid" },
    { name: "D", departure: "09:15", speed: 90, distance: 240, cars: 12, carLength: 22, color: "#ff4f8b", tag: "Intermodal" },
    { name: "E", departure: "09:45", speed: 85, distance: 240, cars: 9, carLength: 21, color: "#ffd166", tag: "Regional" },
    { name: "F", departure: "10:10", speed: 95, distance: 240, cars: 7, carLength: 19, color: "#9a6bff", tag: "Freight" },
    { name: "G", departure: "10:25", speed: 70, distance: 240, cars: 10, carLength: 20, color: "#38a3a5", tag: "Commuter" },
    { name: "H", departure: "10:40", speed: 105, distance: 240, cars: 5, carLength: 23, color: "#ff6f61", tag: "Bullet" },
    { name: "I", departure: "11:05", speed: 88, distance: 240, cars: 11, carLength: 21, color: "#00b4d8", tag: "Coastal" },
    { name: "J", departure: "11:25", speed: 75, distance: 240, cars: 8, carLength: 22, color: "#f72585", tag: "Night" }
];

// ============================================================================
// DOM References
// ============================================================================

const trainCountInput = document.getElementById("train-count");
const trainCountLabel = document.getElementById("train-count-label");
const trainControlsContainer = document.getElementById("train-controls");
const timeSlider = document.getElementById("time-slider");
const timeLabel = document.getElementById("time-label");
const timeOffsetLabel = document.getElementById("time-offset-label");
const playToggle = document.getElementById("play-toggle");
const resetTimeBtn = document.getElementById("reset-time");
const trackLengthInput = document.getElementById("track-length-input");
const stationStartInput = document.getElementById("station-start-input");
const stationEndInput = document.getElementById("station-end-input");
const mapUploadInput = document.getElementById("map-upload");
const clearMapBtn = document.getElementById("clear-map");
const resetCrossingsBtn = document.getElementById("reset-crossings");
const mapStatus = document.getElementById("map-status");
const trackLengthSummary = document.getElementById("track-length-summary");
const trackLabels = document.getElementById("track-labels");
const crossingList = document.getElementById("crossing-list");
const trackSvg = document.getElementById("track-svg");
const mapLayer = document.getElementById("map-layer");
const trackBase = document.getElementById("track-base-root");
const trainLayer = document.getElementById("train-layer");
const warningsPanel = document.getElementById("warnings-panel");
const scenarioSaveBtn = document.getElementById("scenario-save");
const scenarioLoadBtn = document.getElementById("scenario-load");
const scenarioLoadInput = document.getElementById("scenario-load-input");
const metadataExportBtn = document.getElementById("metadata-export");
const metadataImportBtn = document.getElementById("metadata-import");
const metadataImportInput = document.getElementById("metadata-import-input");
const scenarioStatus = document.getElementById("scenario-status");
const playbackSpeedInput = document.getElementById("playback-speed");
const playbackSpeedLabel = document.getElementById("playback-speed-label");
const scrubBackBtn = document.getElementById("scrub-back");
const scrubForwardBtn = document.getElementById("scrub-forward");
const viewportRoot = document.getElementById("viewport-root");
const zoomInBtn = document.getElementById("zoom-in");
const zoomOutBtn = document.getElementById("zoom-out");
const zoomResetBtn = document.getElementById("zoom-reset");
const conflictFilterSelect = document.getElementById("conflict-filter");
const conflictLogList = document.getElementById("conflict-log-list");
const conflictClearBtn = document.getElementById("conflict-clear");
const reportGenerateBtn = document.getElementById("report-generate");
const stationListContainer = document.getElementById("station-list");
const addStationBtn = document.getElementById("add-station");
const startNodesSelect = document.getElementById("start-nodes-select");
const startNodesApplyBtn = document.getElementById("start-nodes-apply");
const startNodesClearBtn = document.getElementById("start-nodes-clear");
const tabButtons = document.querySelectorAll(".tab-button");
const tabPanels = document.querySelectorAll(".tab-panel");
const controlsTabButtons = document.querySelectorAll(".controls-tab-button");
const controlsTabPanels = document.querySelectorAll(".controls-tab-panel");

trainCountInput.max = MAX_TRAINS;

// ============================================================================
// Mutable Application State
// ============================================================================

let stationNames = { ...DEFAULT_STATIONS };
let stationNodes = [];
let trackLengthKm = DEFAULT_TRACK_LENGTH;
let crossingState = DEFAULT_CROSSINGS.map((km, index) => ({
    ratio: km / DEFAULT_TRACK_LENGTH,
    label: `Crossing ${index + 1}`,
    pathIndex: 0
}));
let crossings = [];
let trains = [];
let activeTrainIndex = 0;
let baseDepartureMinutes = null;
let maxTimelineMinutes = 180;
let animationFrame = null;
let lastFrameTime = null;
let playing = false;
let trackPathElement = null;
let trackPathLength = 0;
let usingCustomTrackPath = false;
let trackPathElements = [];
let mapTrackGroupRef = null;
let playbackMultiplier = 1;
let zoomLevel = 1;
let panX = 0;
let panY = 0;
let isPanning = false;
let panPointerId = null;
let panStartLocal = { x: 0, y: 0 };
let panOrigin = { x: 0, y: 0 };

const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4;
const ZOOM_STEP = 1.2;
const CONFLICT_LOG_LIMIT = 500;

const conflictLog = [];
const conflictLogKeys = new Set();
let activeConflictFilter = "all";
const startNodes = [];
let scenarioStartNodeFallback = [];
const customStationNodes = [];
const tooltipElement = document.createElement("div");
tooltipElement.className = "track-tooltip";
document.body.appendChild(tooltipElement);
let tooltipVisible = false;

const createSvgElement = (tag, attributes = {}) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attributes).forEach(([key, value]) => {
        el.setAttribute(key, value);
    });
    return el;
};

const clampDistance = value => Math.max(0, Math.min(trackLengthKm, value));

const updateTrainCountLabel = count => {
    trainCountLabel.textContent = `${count} ${count === 1 ? "train" : "trains"}`;
};

const updatePlaybackSpeedLabel = () => {
    if (!playbackSpeedLabel) {
        return;
    }
    const formatted =
        playbackMultiplier % 1 === 0
            ? playbackMultiplier.toFixed(0)
            : playbackMultiplier.toFixed(2);
    playbackSpeedLabel.textContent = parseFloat(formatted).toString() + "×";
};

const escapeAttribute = value =>
    String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

const escapeHtml = value =>
    String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");

// ============================================================================
// Station & Start Node Management
// ============================================================================

const makeStationNodeId = (name, km) => makeStartNodeId(name, km);

const collectStationNodesFromMap = () => {
    if (!mapLayer) {
        return [];
    }

    const selectors = [
        "[data-station]",
        "[data-station-name]",
        "[data-distance-km]",
        "[data-start-node]",
        "[data-node='start']",
        ".station-node",
        ".station",
        ".stop"
    ];

    const elements = Array.from(mapLayer.querySelectorAll(selectors.join(",")));
    const results = [];
    const seenIds = new Set();

    elements.forEach((el, index) => {
        let name =
            el.getAttribute("data-station-name") ||
            el.getAttribute("data-station") ||
            el.getAttribute("data-name") ||
            el.getAttribute("id") ||
            el.textContent?.trim() ||
            "";
        name = (name || ("Station " + (index + 1))).trim();

        const distanceAttr =
            el.getAttribute("data-distance-km") ||
            el.getAttribute("data-km") ||
            el.dataset?.distanceKm ||
            el.dataset?.km;
        let km = Number(distanceAttr);
        let point = null;

        if (!Number.isFinite(km) && typeof el.getBBox === "function") {
            const bbox = el.getBBox();
            const center = {
                x: bbox.x + bbox.width / 2,
                y: bbox.y + bbox.height / 2
            };
            const projection = projectPointToTrackPath(center);
            if (projection) {
                km = projection.km;
                point = projection.point;
            }
        }

        if (!Number.isFinite(km)) {
            const bbox = typeof el.getBBox === "function" ? el.getBBox() : null;
            if (bbox) {
                const center = {
                    x: bbox.x + bbox.width / 2,
                    y: bbox.y + bbox.height / 2
                };
                const projection = projectPointToTrackPath(center);
                if (projection) {
                    km = projection.km;
                    point = projection.point;
                }
            }
        }

        if (!Number.isFinite(km)) {
            return;
        }

        km = clampDistance(km);
        if (!point) {
            point = getTrackPoint(km, 0);
        }

        const idAttr = el.getAttribute("data-station-id") || el.getAttribute("id");
        let id = idAttr ? idAttr : makeStationNodeId(name, km) + "-map-" + index;
        if (seenIds.has(id)) {
            id = id + "-" + index;
        }
        seenIds.add(id);

        results.push({
            id,
            name,
            km,
            point,
            pathIndex: Number.isFinite(point?.pathIndex) ? point.pathIndex : 0,
            source: "map",
            element: el
        });
    });

    return results;
};

const mergeStationNodes = (mapStations = []) => {
    const unique = new Map();
    const addEntry = node => {
        if (!node) {
            return;
        }
        const km = clampDistance(Number(node.km) || 0);
        const normalizedName = (node.name || "Station").trim() || "Station";
        const id = node.id || makeStationNodeId(normalizedName, km);
        const basePathIndex = Number.isFinite(node.pathIndex) ? node.pathIndex : 0;
        const point = node.point || getTrackPoint(km, 0, basePathIndex);
        const resolvedPathIndex = Number.isFinite(point?.pathIndex) ? point.pathIndex : basePathIndex;
        unique.set(id, {
            id,
            name: normalizedName,
            km,
            point,
            source: node.source || "map",
            pathIndex: resolvedPathIndex
        });
    };

    mapStations.forEach(addEntry);
    customStationNodes.forEach(node =>
        addEntry({
            ...node,
            source: "custom",
            point: getTrackPoint(node.km, 0, node.pathIndex)
        })
    );

    stationNodes = Array.from(unique.values()).sort((a, b) => a.km - b.km);
};

const renderStationList = () => {
    if (!stationListContainer) {
        return;
    }
    stationListContainer.innerHTML = "";

    if (!stationNodes.length) {
        const empty = document.createElement("div");
        empty.className = "conflict-empty";
        empty.textContent = "No additional stations defined.";
        stationListContainer.appendChild(empty);
        return;
    }

    stationNodes.forEach(node => {
        const row = document.createElement("div");
        row.className = "station-row";
        row.dataset.id = node.id;
        row.dataset.source = node.source || "map";

        const nameLabel = document.createElement("label");
        nameLabel.textContent = "Name";
        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.value = node.name;
        nameInput.dataset.field = "name";
        if (node.source !== "custom") {
            nameInput.disabled = true;
        }
        nameLabel.appendChild(nameInput);

        const kmLabel = document.createElement("label");
        kmLabel.textContent = "Distance (km)";
        const kmInput = document.createElement("input");
        kmInput.type = "number";
        kmInput.step = "0.1";
        kmInput.min = "0";
        kmInput.max = String(trackLengthKm);
        kmInput.value = node.km.toFixed(1);
        kmInput.dataset.field = "km";
        if (node.source !== "custom") {
            kmInput.disabled = true;
        }
        kmLabel.appendChild(kmInput);

        const removeBtn = document.createElement("button");
        removeBtn.type = "button";
        removeBtn.textContent = "✕";
        removeBtn.dataset.action = "remove-station";
        if (node.source !== "custom") {
            removeBtn.disabled = true;
        }

        row.appendChild(nameLabel);
        row.appendChild(kmLabel);
        row.appendChild(removeBtn);
        stationListContainer.appendChild(row);
    });
};

const addCustomStationNode = (name, km) => {
    const normalizedName = (name || "Station").trim() || "Station";
    const normalizedKm = clampDistance(Number.isFinite(km) ? km : 0);
    const id = makeStationNodeId(normalizedName, normalizedKm) + "-custom-" + Date.now();
    const node = {
        id,
        name: normalizedName,
        km: normalizedKm,
        point: getTrackPoint(normalizedKm, 0, 0),
        pathIndex: 0,
        source: "custom"
    };
    customStationNodes.push(node);
    return node;
};

const handleStationListInput = event => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) {
        return;
    }
    const row = target.closest(".station-row");
    if (!row) {
        return;
    }
    const id = row.dataset.id;
    const source = row.dataset.source;
    const field = target.dataset.field;

    if (source !== "custom") {
        const match = stationNodes.find(node => node.id === id);
        if (!match) {
            return;
        }
        if (field === "name") {
            target.value = match.name;
        } else if (field === "km") {
            target.value = match.km.toFixed(1);
        }
        return;
    }

    const node = customStationNodes.find(item => item.id === id);
    if (!node) {
        return;
    }

    if (field === "name") {
        node.name = target.value;
    } else if (field === "km") {
        const km = clampDistance(Number(target.value) || 0);
        node.km = km;
        node.point = getTrackPoint(km, 0, node.pathIndex);
        node.pathIndex = Number.isFinite(node.point?.pathIndex) ? node.point.pathIndex : node.pathIndex || 0;
        target.value = km.toFixed(1);
    }

    mergeStationNodes(collectStationNodesFromMap());
    renderStationList();
    collectStartNodes();
    buildTrack();
    render();
};

const handleStationListClick = event => {
    const button = event.target.closest("button[data-action='remove-station']");
    if (!button) {
        return;
    }
    const row = button.closest(".station-row");
    if (!row || row.dataset.source !== "custom") {
        return;
    }
    const id = row.dataset.id;
    const index = customStationNodes.findIndex(node => node.id === id);
    if (index >= 0) {
        customStationNodes.splice(index, 1);
        mergeStationNodes(collectStationNodesFromMap());
        renderStationList();
        collectStartNodes();
        buildTrack();
        render();
    }
};
const getStartNodeById = id => startNodes.find(node => node.id === id) || null;

const makeStartNodeId = (name, km) => {
    const normalizedName = (name || "node").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return normalizedName + "|" + km.toFixed(3);
};

const addStartNode = (name, km, point) => {
    const normalizedName = (name || "Start Node").trim() || "Start Node";
    const normalizedKm = clampDistance(Number.isFinite(km) ? km : 0);
    const nodePoint = point || getTrackPoint(normalizedKm, 0);
    const pathIndex = Number.isFinite(nodePoint?.pathIndex) ? nodePoint.pathIndex : 0;
    let id = makeStartNodeId(normalizedName, normalizedKm);
    if (
        startNodes.some(
            node => node.id === id && Number.isFinite(node.pathIndex) && node.pathIndex !== pathIndex
        )
    ) {
        id = id + "|p" + pathIndex;
    }
    const existingIndex = startNodes.findIndex(node => node.id === id);
    const node = {
        id,
        name: normalizedName,
        km: normalizedKm,
        point: nodePoint,
        pathIndex
    };
    if (existingIndex >= 0) {
        startNodes[existingIndex] = node;
    } else {
        startNodes.push(node);
    }
    return node;
};

const finalizeStartNodes = () => {
    startNodes.sort((a, b) => a.km - b.km);
    refreshStartNodeSelectOptions();
    scenarioStartNodeFallback = startNodes.map(node => ({
        id: node.id,
        name: node.name,
        km: node.km,
        pathIndex: Number.isFinite(node.pathIndex) ? node.pathIndex : 0
    }));
};

const buildStartNodeOptions = selectedId => {
    let options = '<option value="">Default Origin (0 km)</option>';
    startNodes.forEach(node => {
        options += '<option value="' + escapeHtml(node.id) + '"' + (node.id === selectedId ? " selected" : "") + ">" +
            escapeHtml(node.name) + " (" + node.km.toFixed(1) + " km)</option>";
    });
    return options;
};

const syncStartNodeSelections = () => {
    const selects = trainControlsContainer.querySelectorAll("select[data-field='startNodeId']");
    selects.forEach(select => {
        const row = select.closest(".train-row");
        if (!row) {
            return;
        }
        const index = Number(row.dataset.index);
        const train = trains[index];
        if (train && train.startNodeId && !getStartNodeById(train.startNodeId)) {
            train.startNodeId = null;
        }
        select.innerHTML = buildStartNodeOptions(train?.startNodeId || "");
    });
};

const refreshStartNodeSelectOptions = () => {
    if (startNodesSelect) {
        const preserved = new Set(Array.from(startNodesSelect.selectedOptions).map(option => option.value));
        startNodesSelect.innerHTML = startNodes
            .map(node => `<option value="${escapeHtml(node.id)}">${escapeHtml(node.name)} (${node.km.toFixed(1)} km)</option>`)
            .join("");
        Array.from(startNodesSelect.options).forEach(option => {
            option.selected = preserved.has(option.value);
        });
    }
    syncStartNodeSelections();
};

const collectStartNodes = () => {
    startNodes.length = 0;

    if (usingCustomTrackPath && trackPathElements.length) {
        trackPathElements.forEach((_, idx) => {
            const startLabel =
                idx === 0 ? stationNames.start || "Origin" : `${stationNames.start} (Path ${idx + 1})`;
            const endLabel =
                idx === 0 ? stationNames.end || "Destination" : `${stationNames.end} (Path ${idx + 1})`;
            addStartNode(startLabel, 0, getTrackPoint(0, 0, idx));
            addStartNode(endLabel, trackLengthKm, getTrackPoint(trackLengthKm, 0, idx));
        });
    } else {
        DEFAULT_PATH_DEFINITIONS.forEach((pathDef, idx) => {
            addStartNode(
                `${stationNames.start} (${pathDef.shortLabel})`,
                0,
                getTrackPoint(0, 0, idx)
            );
            addStartNode(
                `${stationNames.end} (${pathDef.shortLabel})`,
                trackLengthKm,
                getTrackPoint(trackLengthKm, 0, idx)
            );
        });
    }

    stationNodes.forEach(node => {
        if (!node) {
            return;
        }
        if (node.km <= 0.001 || Math.abs(node.km - trackLengthKm) <= 0.001) {
            return;
        }
        addStartNode(node.name, node.km, node.point || getTrackPoint(node.km, 0, node.pathIndex));
    });

    crossings.forEach((crossing, index) => {
        const point = getTrackPoint(crossing.km, 0, crossing.pathIndex);
        addStartNode(crossing.label || "Crossing " + (index + 1), crossing.km, point);
    });

    if (Array.isArray(scenarioStartNodeFallback)) {
        scenarioStartNodeFallback.forEach(node => {
            if (!node) {
                return;
            }
            const kmValue = node.km ?? 0;
            addStartNode(
                node.name || "Start Node",
                kmValue,
                getTrackPoint(kmValue, 0, node.pathIndex)
            );
        });
    }

    finalizeStartNodes();
};

const applyStartNodesSequentially = nodeIds => {
    if (!nodeIds || !nodeIds.length || !trains.length) {
        return;
    }
    let index = Number.isFinite(activeTrainIndex) ? activeTrainIndex : 0;
    if (index < 0) {
        index = 0;
    }
    if (index >= trains.length) {
        index = trains.length - 1;
    }
    nodeIds.forEach(nodeId => {
        const node = getStartNodeById(nodeId);
        if (!node) {
            return;
        }
        if (index >= trains.length) {
            index = trains.length - 1;
        }
        trains[index].startNodeId = nodeId;
        trains[index].pathIndex = Number.isFinite(node.pathIndex) ? node.pathIndex : 0;
        index += 1;
    });
    syncStartNodeSelections();
    render();
};

const clearActiveTrainStartNode = () => {
    if (!trains.length) {
        return;
    }
    const index = Number.isFinite(activeTrainIndex) ? activeTrainIndex : 0;
    if (trains[index]) {
        trains[index].startNodeId = null;
        trains[index].pathIndex = 0;
    }
    syncStartNodeSelections();
    render();
};

const showTooltip = (html, clientX, clientY) => {
    tooltipElement.innerHTML = html;
    tooltipElement.style.left = clientX + "px";
    tooltipElement.style.top = clientY + "px";
    if (!tooltipVisible) {
        tooltipElement.classList.add("is-visible");
        tooltipVisible = true;
    }
};

const moveTooltip = (clientX, clientY) => {
    if (!tooltipVisible) {
        return;
    }
    tooltipElement.style.left = clientX + "px";
    tooltipElement.style.top = clientY + "px";
};

const hideTooltip = () => {
    if (!tooltipVisible) {
        return;
    }
    tooltipElement.classList.remove("is-visible");
    tooltipVisible = false;
};

const attachTooltip = (target, getContent) => {
    if (!target) {
        return;
    }
    target.addEventListener("pointerenter", event => {
        const content = getContent();
        if (!content) {
            return;
        }
        showTooltip(content, event.clientX, event.clientY);
    });
    target.addEventListener("pointermove", event => {
        moveTooltip(event.clientX, event.clientY);
    });
    target.addEventListener("pointerleave", () => {
        hideTooltip();
    });
    target.addEventListener("pointercancel", () => {
        hideTooltip();
    });
};

const getLocalPointFromClient = (clientX, clientY) => {
    if (!trackSvg || !viewportRoot || typeof trackSvg.createSVGPoint !== "function") {
        return { x: clientX, y: clientY };
    }
    const point = trackSvg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const ctm = viewportRoot.getScreenCTM();
    if (!ctm) {
        return { x: clientX, y: clientY };
    }
    const local = point.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
};

const applyViewportTransform = () => {
    if (!viewportRoot) {
        return;
    }
    viewportRoot.setAttribute("transform", "translate(" + panX + ", " + panY + ") scale(" + zoomLevel + ")");
    if (!trackSvg) {
        return;
    }
    if (isPanning) {
        trackSvg.style.cursor = "grabbing";
    } else if (zoomLevel !== 1 || panX !== 0 || panY !== 0) {
        trackSvg.style.cursor = "grab";
    } else {
        trackSvg.style.cursor = "default";
    }
};

const getViewportCenterPoint = () => {
    if (!trackSvg) {
        return null;
    }
    const rect = trackSvg.getBoundingClientRect();
    if (!rect.width || !rect.height) {
        return null;
    }
    return getLocalPointFromClient(rect.left + rect.width / 2, rect.top + rect.height / 2);
};

const changeZoom = (factor, focusPoint) => {
    const newZoom = Math.min(Math.max(zoomLevel * factor, MIN_ZOOM), MAX_ZOOM);
    if (!Number.isFinite(newZoom) || newZoom === zoomLevel) {
        return;
    }
    const focus = focusPoint || getViewportCenterPoint();
    if (focus) {
        panX = focus.x - (focus.x - panX) * (newZoom / zoomLevel);
        panY = focus.y - (focus.y - panY) * (newZoom / zoomLevel);
    } else {
        panX *= newZoom / zoomLevel;
        panY *= newZoom / zoomLevel;
    }
    zoomLevel = newZoom;
    collectStartNodes();
    applyViewportTransform();
};

const resetViewport = () => {
    zoomLevel = 1;
    panX = 0;
    panY = 0;
    applyViewportTransform();
};

const handleWheel = event => {
    if (!trackSvg) {
        return;
    }
    event.preventDefault();
    const focus = getLocalPointFromClient(event.clientX, event.clientY);
    const factor = event.deltaY > 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
    changeZoom(factor, focus);
};

const handlePointerDown = event => {
    if (!(event.altKey || event.button === 1 || event.button === 2)) {
        return;
    }
    event.preventDefault();
    if (trackSvg && trackSvg.setPointerCapture) {
        trackSvg.setPointerCapture(event.pointerId);
    }
    isPanning = true;
    panPointerId = event.pointerId;
    panStartLocal = getLocalPointFromClient(event.clientX, event.clientY);
    panOrigin = { x: panX, y: panY };
    applyViewportTransform();
};

const handlePointerMove = event => {
    if (!isPanning || event.pointerId !== panPointerId) {
        return;
    }
    event.preventDefault();
    const current = getLocalPointFromClient(event.clientX, event.clientY);
    panX = panOrigin.x + (current.x - panStartLocal.x);
    panY = panOrigin.y + (current.y - panStartLocal.y);
    applyViewportTransform();
};

const handlePointerUp = event => {
    if (!isPanning || event.pointerId !== panPointerId) {
        return;
    }
    if (trackSvg && trackSvg.releasePointerCapture) {
        trackSvg.releasePointerCapture(event.pointerId);
    }
    isPanning = false;
    panPointerId = null;
    applyViewportTransform();
};

const setScenarioStatus = (message, isError = false) => {
    if (!scenarioStatus) {
        return;
    }
    scenarioStatus.textContent = message;
    scenarioStatus.style.color = isError ? "var(--accent-strong)" : "var(--text-secondary)";
};

/**
 * Parses the currently loaded SVG map, discovers track geometry, and prepares
 * state for train simulation and rendering. During processing the function:
 * - Resets previously cached path information.
 * - Ensures a dedicated `<g id="track-base">` exists for stylised rails.
 * - Adds each eligible path/polyline/line to `trackPathElements`.
 * - Stylises map geometry so uploaded tracks adopt the Rail Flow aesthetic.
 * - Rebuilds station annotations and start nodes derived from the SVG.
 */
const updateTrackPath = () => {
    trackPathElement = null;
    trackPathLength = 0;
    usingCustomTrackPath = false;
    trackPathElements = [];
    mapTrackGroupRef = null;

    if (!mapLayer) {
        mergeStationNodes([]);
        renderStationList();
        collectStartNodes();
        return;
    }

    const prioritizedSelectors = [
        '[data-track="true"]',
        '[data-track]',
        '[data-route="track"]',
        '.track-path',
        '#track-path',
        '#rail-track'
    ];

    const prioritizedMatches = prioritizedSelectors
        .map(selector =>
            Array.from(mapLayer.querySelectorAll(selector)).filter(
                el => typeof el.getTotalLength === "function"
            )
        )
        .flat();

    const fallbackMatches = Array.from(mapLayer.querySelectorAll("path, polyline, line")).filter(
        el => typeof el.getTotalLength === "function"
    );

    const combined = [...new Set([...prioritizedMatches, ...fallbackMatches])];
    const rootSvg = mapLayer.querySelector("svg");
    const mapTrackGroup = ensureMapTrackGroup(rootSvg);

    combined.forEach(el => {
        const length = el.getTotalLength?.() || 0;
        if (length > 0) {
            if (mapTrackGroup && el.parentNode !== mapTrackGroup) {
                mapTrackGroup.appendChild(el);
            }
            trackPathElements.push({
                element: el,
                length
            });
            stylizeCustomTrackElement(el, trackPathElements.length - 1);
        }
    });

    if (trackPathElements.length) {
        const primary = trackPathElements[0];
        trackPathElement = primary.element;
        trackPathLength = primary.length;
        usingCustomTrackPath = true;
        const override =
            parseFloat(trackPathElement.getAttribute("data-track-length-km")) ||
            parseFloat(trackPathElement.getAttribute("data-track-length")) ||
            parseFloat(trackPathElement.dataset?.trackLengthKm);
        if (Number.isFinite(override) && override > 0 && Math.abs(override - trackLengthKm) > 0.01) {
            trackLengthInput.value = override;
            handleTrackLengthChange();
        }
    }

    const mapStations = collectStationNodesFromMap();
    mergeStationNodes(mapStations);
    renderStationList();
    collectStartNodes();
};

const transformPathPoint = (point, element) => {
    let x = point.x;
    let y = point.y;

    if (!element || typeof element.getCTM !== "function") {
        return { x, y };
    }

    const matrix = element.getCTM();
    if (!matrix) {
        return { x, y };
    }

    if (typeof point.matrixTransform === "function") {
        const transformed = point.matrixTransform(matrix);
        return { x: transformed.x, y: transformed.y };
    }

    if (trackSvg && typeof trackSvg.createSVGPoint === "function") {
        const svgPoint = trackSvg.createSVGPoint();
        svgPoint.x = x;
        svgPoint.y = y;
        const transformed = svgPoint.matrixTransform(matrix);
        return { x: transformed.x, y: transformed.y };
    }

    return { x, y };
};

const getTrackPoint = (distanceKm, laneIndex = 0, pathIndexOverride = null) => {
    const clampedDistance = clampDistance(distanceKm);
    const ratio = trackLengthKm > 0 ? clampedDistance / trackLengthKm : 0;
    const clampedRatio = Math.min(Math.max(ratio, 0), 1);

    if (usingCustomTrackPath && trackPathElements.length) {
        const pathObj = trackPathElements[pathIndexOverride ?? 0] || trackPathElements[0];
        if (pathObj && pathObj.element && pathObj.length > 0) {
            const lengthAlongPath = Math.min(Math.max(clampedRatio * pathObj.length, 0), pathObj.length);
            const rawPoint = pathObj.element.getPointAtLength(lengthAlongPath);
            const { x, y } = transformPathPoint(rawPoint, pathObj.element);
            return { x, y, ratio: clampedRatio, pathIndex: trackPathElements.indexOf(pathObj) };
        }
    }

    const fallbackPathIndex = Number.isFinite(pathIndexOverride) ? pathIndexOverride : 0;
    const basePoint = getFallbackPathPoint(fallbackPathIndex, clampedRatio);
    let { x, y } = basePoint;

    if (fallbackPathIndex === 0) {
        const laneOffset = trains.length > 1
            ? 16 * (laneIndex - (trains.length - 1) / 2)
            : 0;
        y += laneOffset;
    } else if (fallbackPathIndex === 1) {
        const lateralOffset = trains.length > 1
            ? 12 * (laneIndex - (trains.length - 1) / 2)
            : 0;
        x += lateralOffset;
    } else {
        const offset = trains.length > 1
            ? 10 * (laneIndex - (trains.length - 1) / 2)
            : 0;
        const angle = fallbackPathIndex === 2 ? -Math.PI / 4 : Math.PI / 4;
        x += Math.cos(angle + Math.PI / 2) * offset;
        y += Math.sin(angle + Math.PI / 2) * offset;
    }

    return { x, y, ratio: clampedRatio, pathIndex: fallbackPathIndex };
};

const projectPointToSinglePath = (pathObj, point) => {
    if (!pathObj || !point || pathObj.length <= 0) {
        return null;
    }
    const element = pathObj.element;
    const totalLength = pathObj.length;
    const samples = 256;
    let closestLength = 0;
    let minDistSq = Number.POSITIVE_INFINITY;

    for (let i = 0; i <= samples; i += 1) {
        const length = (i / samples) * totalLength;
        const raw = element.getPointAtLength(length);
        const transformed = transformPathPoint(raw, element);
        const dx = point.x - transformed.x;
        const dy = point.y - transformed.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < minDistSq) {
            minDistSq = distSq;
            closestLength = length;
        }
    }

    let step = totalLength / samples;
    while (step > 1) {
        let improved = false;
        for (const offset of [-step, step]) {
            const candidateLength = Math.min(Math.max(closestLength + offset, 0), totalLength);
            const raw = element.getPointAtLength(candidateLength);
            const transformed = transformPathPoint(raw, element);
            const dx = point.x - transformed.x;
            const dy = point.y - transformed.y;
            const distSq = dx * dx + dy * dy;
            if (distSq < minDistSq) {
                minDistSq = distSq;
                closestLength = candidateLength;
                improved = true;
            }
        }
        if (!improved) {
            step /= 2;
        }
    }

    const finalPoint = transformPathPoint(element.getPointAtLength(closestLength), element);
    return {
        length: closestLength,
        point: finalPoint,
        distanceSq: minDistSq
    };
};

const projectPointToTrackPath = point => {
    if (!usingCustomTrackPath || !trackPathElements.length || !point) {
        return null;
    }

    let bestProjection = null;
    let bestIndex = 0;

    trackPathElements.forEach((pathObj, index) => {
        if (!pathObj.element || pathObj.length <= 0) {
            return;
        }
        const projection = projectPointToSinglePath(pathObj, point);
        if (!projection) {
            return;
        }
        if (!bestProjection || projection.distanceSq < bestProjection.distanceSq) {
            bestProjection = {
                ...projection,
                pathIndex: index
            };
            bestIndex = index;
        }
    });

    if (!bestProjection) {
        return null;
    }

    const targetPath = trackPathElements[bestIndex];
    const ratio =
        trackLengthKm > 0 && targetPath && targetPath.length > 0
            ? bestProjection.length / targetPath.length
            : 0;
    const km = clampDistance(ratio * trackLengthKm);

    return {
        km,
        point: bestProjection.point,
        pathIndex: bestIndex
    };
};

const recalcCrossings = () => {
    crossingState = crossingState
        .map(state => {
            const km = clampDistance(state.ratio * trackLengthKm);
            const ratio = trackLengthKm > 0 ? km / trackLengthKm : 0;
            const pathIndex = Number.isFinite(state.pathIndex) ? state.pathIndex : 0;
            return {
                ratio,
                label: state.label || "Crossing",
                pathIndex
            };
        })
        .sort((a, b) => a.ratio - b.ratio);

    crossings = crossingState.map(state => ({
        km: state.ratio * trackLengthKm,
        label: state.label,
        pathIndex: Number.isFinite(state.pathIndex) ? state.pathIndex : 0
    }));

    collectStartNodes();
};

const resetCrossingsToDefault = () => {
    crossingState = DEFAULT_CROSSINGS.map((km, index) => ({
        ratio: km / DEFAULT_TRACK_LENGTH,
        label: `Crossing ${index + 1}`,
        pathIndex: 0
    }));
    recalcCrossings();
    renderCrossingControls();
};

const isRedColor = value => {
    if (!value) {
        return false;
    }
    const normalized = value.replace(/\s+/g, "").toLowerCase();
    return normalized.includes("#ff0000") ||
        normalized.includes("#f00") ||
        normalized.includes("rgb(255,0,0)") ||
        normalized === "red";
};

/**
 * Derives crossing positions from an uploaded SVG by inspecting stylised
 * geometry and circle markers. The function projects candidates onto the
 * nearest known track path (custom or fallback) and returns normalised ratios.
 *
 * @param {SVGSVGElement} svg - Parsed SVG root containing the uploaded map.
 * @returns {Array<{ratio:number, pathIndex:number, label: string|null>>}
 */
const deriveCrossingRatiosFromSvg = svg => {
    try {
        const colorCandidates = Array.from(svg.querySelectorAll("*")).filter(el =>
            isRedColor(el.getAttribute("stroke")) || isRedColor(el.getAttribute("fill"))
        );
        const circleCandidates = Array.from(svg.querySelectorAll("circle"));

        const entries = [];

        const addEntry = entry => {
            if (!entry) {
                return;
            }
            const existing = entries.find(
                candidate =>
                    candidate.pathIndex === entry.pathIndex &&
                    Math.abs(candidate.ratio - entry.ratio) < 0.01
            );
            if (!existing) {
                entries.push(entry);
            } else if (!existing.label && entry.label) {
                existing.label = entry.label;
            }
        };

        colorCandidates.forEach(el => {
            let bbox;
            try {
                bbox = el.getBBox();
            } catch (error) {
                return;
            }
            if (!bbox || (bbox.width === 0 && bbox.height === 0)) {
                return;
            }
            const centerPoint = transformPathPoint(
                {
                    x: bbox.x + bbox.width / 2,
                    y: bbox.y + bbox.height / 2
                },
                el
            );
            let ratio = null;
            let pathIndex = 0;
            const projection = projectPointToTrackPath(centerPoint);
            if (projection) {
                ratio = trackLengthKm > 0 ? projection.km / trackLengthKm : 0;
                pathIndex = projection.pathIndex || 0;
            } else {
                const fallbackProjection = projectPointToFallbackPaths(centerPoint);
                if (fallbackProjection) {
                    ratio = fallbackProjection.ratio;
                    pathIndex = fallbackProjection.pathIndex || 0;
                }
            }
            if (!Number.isFinite(ratio)) {
                return;
            }
            addEntry({
                ratio: Math.min(Math.max(ratio, 0), 1),
                pathIndex,
                label: null
            });
        });

        circleCandidates.forEach((circle, idx) => {
            let cx = parseFloat(circle.getAttribute("cx"));
            let cy = parseFloat(circle.getAttribute("cy"));
            if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
                const bbox = circle.getBBox?.();
                if (bbox) {
                    cx = bbox.x + bbox.width / 2;
                    cy = bbox.y + bbox.height / 2;
                }
            }
            if (!Number.isFinite(cx) || !Number.isFinite(cy)) {
                return;
            }
            const center = transformPathPoint({ x: cx, y: cy }, circle);
            let ratio = null;
            let pathIndex = 0;
            const projection = projectPointToTrackPath(center);
            if (projection) {
                ratio = trackLengthKm > 0 ? projection.km / trackLengthKm : 0;
                pathIndex = projection.pathIndex || 0;
            } else {
                const fallbackProjection = projectPointToFallbackPaths(center);
                if (fallbackProjection) {
                    ratio = fallbackProjection.ratio;
                    pathIndex = fallbackProjection.pathIndex || 0;
                }
            }
            if (!Number.isFinite(ratio)) {
                return;
            }
            const label =
                circle.getAttribute("data-label") ||
                circle.getAttribute("data-crossing") ||
                circle.getAttribute("id") ||
                circle.getAttribute("name") ||
                `Circle ${idx + 1}`;
            addEntry({
                ratio: Math.min(Math.max(ratio, 0), 1),
                pathIndex,
                label
            });
        });

        if (entries.length) {
            return entries.sort((a, b) => a.ratio - b.ratio);
        }

        const viewBox = svg.viewBox && svg.viewBox.baseVal;
        const width = viewBox && viewBox.width
            ? viewBox.width
            : parseFloat(svg.getAttribute("width")) || svg.getBBox().width || VIEWBOX_WIDTH;
        const offsetX = viewBox ? viewBox.x : 0;

        if (!width) {
            return [];
        }

        const ratios = colorCandidates
            .map(el => {
                const bbox = el.getBBox();
                if (!bbox || (bbox.width === 0 && bbox.height === 0)) {
                    return null;
                }
                const centerX = bbox.x + bbox.width / 2;
                const normalized = (centerX - offsetX) / width;
                if (!Number.isFinite(normalized)) {
                    return null;
                }
                return Math.min(Math.max(normalized, 0), 1);
            })
            .filter(value => value != null);

        const uniqueRatios = [];
        ratios
            .sort((a, b) => a - b)
            .forEach(value => {
                if (!uniqueRatios.some(existing => Math.abs(existing - value) < 0.01)) {
                    uniqueRatios.push(value);
                }
            });
        return uniqueRatios.map(ratio => ({
            ratio,
            pathIndex: 0,
            label: null
        }));
    } catch (error) {
        console.warn("Failed to derive crossings from SVG", error);
        return [];
    }
};

const updateTrackLengthSummary = () => {
    trackLengthSummary.textContent =
        `${stationNames.start} → ${stationNames.end} (${trackLengthKm.toFixed(1)} km)`;
};

const renderTrackLabels = () => {
    trackLabels.innerHTML = "";
    const divisions = 5;
    for (let i = 0; i <= divisions; i += 1) {
        const km = (trackLengthKm / divisions) * i;
        const span = document.createElement("span");
        if (i === 0) {
            span.textContent = `${stationNames.start} • ${km.toFixed(0)} km`;
        } else if (i === divisions) {
            span.textContent = `${stationNames.end} • ${km.toFixed(0)} km`;
        } else {
            span.textContent = `${Math.round(km)} km`;
        }
        trackLabels.appendChild(span);
    }
};

const setActiveTrain = index => {
    activeTrainIndex = index;
    const rows = trainControlsContainer.querySelectorAll(".train-row");
    rows.forEach(row => {
        row.classList.toggle("active", Number(row.dataset.index) === index);
    });
};

const syncManualInputForTrain = index => {
    const train = trains[index];
    if (!train) {
        return;
    }
    const input = trainControlsContainer.querySelector(
        `.train-row[data-index="${index}"] input[data-field="manualPositionKm"]`
    );
    if (input) {
        input.value = train.manualPositionKm != null ? train.manualPositionKm.toFixed(2) : "";
    }
};

const applyTrackLengthToTrains = () => {
    trains.forEach((train, index) => {
        train.distance = clampDistance(train.distance);
        if (train.manualPositionKm != null) {
            train.manualPositionKm = clampDistance(train.manualPositionKm);
        }
        const row = trainControlsContainer.querySelector(`.train-row[data-index="${index}"]`);
        if (row) {
            const distanceInput = row.querySelector('input[data-field="distance"]');
            const manualInput = row.querySelector('input[data-field="manualPositionKm"]');
            if (distanceInput) {
                distanceInput.max = trackLengthKm;
                if (Number(distanceInput.value) > trackLengthKm) {
                    distanceInput.value = trackLengthKm.toFixed(1);
                }
            }
            if (manualInput) {
                manualInput.max = trackLengthKm;
                manualInput.value = train.manualPositionKm != null ? train.manualPositionKm.toFixed(2) : "";
            }
        }
    });
};

const renderCrossingControls = () => {
    crossingList.innerHTML = "";
    if (!crossings.length) {
        const empty = document.createElement("small");
        empty.className = "hint-text";
        empty.textContent = "No crossings detected. Upload a map with red segments or reset defaults.";
        crossingList.appendChild(empty);
        return;
    }

    crossings.forEach((crossing, index) => {
        const item = document.createElement("div");
        item.className = "crossing-item";

        const input = document.createElement("input");
        input.type = "text";
        input.value = crossingState[index]?.label ?? `Crossing ${index + 1}`;
        input.maxLength = 60;
        input.addEventListener("input", () => {
            crossingState[index].label = input.value || `Crossing ${index + 1}`;
            crossings[index].label = crossingState[index].label;
            buildTrack();
        });

        const position = document.createElement("small");
        position.textContent = `${crossing.km.toFixed(1)} km`;

        item.appendChild(input);
        item.appendChild(position);
        crossingList.appendChild(item);
    });
};

const cloneDefaultTrain = index => {
    const template = DEFAULT_TRAINS[index] ?? DEFAULT_TRAINS[DEFAULT_TRAINS.length - 1];
    const prefix = String.fromCharCode(65 + (index % 26));
    const suffix = index >= 26 ? String(Math.floor(index / 26)) : "";
    return {
        ...template,
        name: `${prefix}${suffix}`,
        manualPositionKm: null,
        startNodeId: null,
        pathIndex: 0,
        color: template.color || "#1c8ef9",
        tag: template.tag || ""
    };
};

const prepareTrainPreset = (preset, index) => {
    const fallback = cloneDefaultTrain(index);
    if (!preset || typeof preset !== "object") {
        return { ...fallback };
    }

    const normalized = {
        ...fallback,
        ...preset
    };

    normalized.name = preset.name || fallback.name;
    normalized.departure = preset.departure || fallback.departure;
    normalized.speed = Number.isFinite(Number(preset.speed)) ? Number(preset.speed) : fallback.speed;
    normalized.distance = clampDistance(Number.isFinite(Number(preset.distance)) ? Number(preset.distance) : fallback.distance);
    normalized.cars = Number.isFinite(Number(preset.cars)) ? Number(preset.cars) : fallback.cars;
    normalized.carLength = Number.isFinite(Number(preset.carLength)) ? Number(preset.carLength) : fallback.carLength;
    normalized.manualPositionKm = preset.manualPositionKm != null
        ? clampDistance(Number(preset.manualPositionKm))
        : null;
    normalized.color = typeof preset.color === "string" && preset.color ? preset.color : fallback.color;
    normalized.tag = typeof preset.tag === "string" ? preset.tag.trim() : fallback.tag;
    normalized.startNodeId = preset.startNodeId || fallback.startNodeId || null;
    const startNode = getStartNodeById(normalized.startNodeId);
    const defaultPathIndex = startNode && Number.isFinite(startNode.pathIndex) ? startNode.pathIndex : fallback.pathIndex;
    const presetPathIndex = Number.isFinite(preset.pathIndex) ? preset.pathIndex : null;
    normalized.pathIndex = presetPathIndex != null ? presetPathIndex : (Number.isFinite(defaultPathIndex) ? defaultPathIndex : 0);

    return normalized;
};

const buildTrainControls = (count, presetTrains = null) => {
    trainControlsContainer.innerHTML = "";
    trains = [];

    for (let i = 0; i < count; i += 1) {
        const train = presetTrains && presetTrains[i]
            ? prepareTrainPreset(presetTrains[i], i)
            : cloneDefaultTrain(i);
        train.distance = clampDistance(train.distance);
        trains.push(train);

        const row = document.createElement("div");
        row.className = "train-row";
        row.dataset.index = i;

        train.color = train.color || "#1c8ef9";
        train.tag = typeof train.tag === "string" ? train.tag : "";
        const manualValue = train.manualPositionKm != null ? train.manualPositionKm.toFixed(2) : "";
        const manualAttrValue = escapeAttribute(manualValue);
        const colorValue = escapeAttribute(train.color || "#1c8ef9");
        const tagValue = escapeAttribute(train.tag || "");
        const startNodeOptions = buildStartNodeOptions(train.startNodeId);
        row.innerHTML = `
            <strong>Train ${train.name}</strong>
            <label>Departure<input type="time" value="${train.departure}" data-field="departure"></label>
            <label>Speed (km/h)<input type="number" min="10" max="200" value="${train.speed}" data-field="speed"></label>
            <label>Distance (km)<input type="number" min="1" value="${train.distance}" data-field="distance"></label>
            <label>Cars<input type="number" min="1" max="20" value="${train.cars}" data-field="cars"></label>
            <label>Car Length (m)<input type="number" min="5" max="40" value="${train.carLength}" data-field="carLength"></label>
            <label>Start Node<select data-field="startNodeId">${startNodeOptions}</select></label>
            <label>Color<input type="color" value="${colorValue}" data-field="color"></label>
            <label>Tag / Icon<input type="text" maxlength="20" placeholder="optional" value="${tagValue}" data-field="tag"></label>
            <label>Manual Pos (km)<input type="number" min="0" step="0.1" placeholder="auto" value="${manualAttrValue}" data-field="manualPositionKm"></label>
        `;

        row.querySelectorAll("input, select").forEach(input => {
            input.addEventListener("input", handleTrainInput);
        });
        row.addEventListener("click", () => setActiveTrain(i));

        const distanceInput = row.querySelector('input[data-field="distance"]');
        const manualInput = row.querySelector('input[data-field="manualPositionKm"]');
        if (distanceInput) {
            distanceInput.max = trackLengthKm;
        }
        if (manualInput) {
            manualInput.max = trackLengthKm;
        }

        trainControlsContainer.appendChild(row);
    }

    if (activeTrainIndex >= trains.length) {
        activeTrainIndex = Math.max(0, trains.length - 1);
    }
    setActiveTrain(activeTrainIndex);

    updateTrainCountLabel(trains.length);
    refreshConflictFilterOptions();
    recalcTimeline();
    render();
};

const handleTrainInput = event => {
    const row = event.target.closest(".train-row");
    const index = Number(row.dataset.index);
    setActiveTrain(index);
    const field = event.target.dataset.field;

    if (field === "color") {
        trains[index].color = event.target.value || "#1c8ef9";
        render();
        return;
    }

    if (field === "tag") {
        trains[index].tag = event.target.value.trim();
        render();
        return;
    }

    if (field === "startNodeId") {
        const nodeId = event.target.value || null;
        let node = null;
        if (nodeId && !getStartNodeById(nodeId)) {
            trains[index].startNodeId = null;
            trains[index].pathIndex = 0;
        } else {
            trains[index].startNodeId = nodeId;
            node = nodeId ? getStartNodeById(nodeId) : null;
            trains[index].pathIndex = node && Number.isFinite(node.pathIndex) ? node.pathIndex : 0;
        }
        recalcTimeline();
        render();
        return;
    }

    if (field === "manualPositionKm") {
        if (event.target.value === "") {
            trains[index].manualPositionKm = null;
            const node = getStartNodeById(trains[index].startNodeId);
            trains[index].pathIndex = node && Number.isFinite(node.pathIndex) ? node.pathIndex : 0;
        } else {
            const manualValue = clampDistance(Number(event.target.value));
            trains[index].manualPositionKm = Number.isFinite(manualValue) ? manualValue : null;
            event.target.value = trains[index].manualPositionKm != null
                ? trains[index].manualPositionKm.toFixed(2)
                : "";
        }
        render();
        return;
    }

    const value = event.target.type === "time" ? event.target.value : Number(event.target.value);

    if (field === "distance") {
        trains[index][field] = clampDistance(value);
        event.target.value = trains[index][field];
    } else if (field === "departure") {
        trains[index].departure = value;
    } else {
        trains[index][field] = value;
    }

    recalcTimeline();
    render();
};

const parseTimeToMinutes = hhmm => {
    const [h, m] = hhmm.split(":").map(Number);
    return h * 60 + m;
};

// ============================================================================
// Train State & Simulation Calculations
// ============================================================================

const deriveTrainState = train => {
    const departureMinutes = parseTimeToMinutes(train.departure);
    const distanceKm = clampDistance(Number(train.distance) || 0);
    const speed = Math.max(Number(train.speed) || 1, 1);
    const travelMinutes = (distanceKm / speed) * 60;
    const startNode = getStartNodeById(train.startNodeId);
    const startOffsetKm = startNode ? startNode.km : 0;
    const pathIndex = Number.isFinite(train.pathIndex)
        ? train.pathIndex
        : (startNode && Number.isFinite(startNode.pathIndex) ? startNode.pathIndex : 0);
    return {
        ...train,
        distance: distanceKm,
        speed,
        departureMinutes,
        arrivalMinutes: departureMinutes + travelMinutes,
        lengthKm: (train.cars * train.carLength) / 1000,
        manualPositionKm: train.manualPositionKm != null ? clampDistance(train.manualPositionKm) : null,
        startOffsetKm,
        color: train.color,
        tag: train.tag,
        pathIndex
    };
};

const recalcTimeline = () => {
    const states = trains.map(deriveTrainState);
    const departures = states.map(t => t.departureMinutes);
    const arrivals = states.map(t => t.arrivalMinutes);
    baseDepartureMinutes = Math.min(...departures);
    maxTimelineMinutes = Math.ceil(Math.max(...arrivals) - baseDepartureMinutes);
    timeSlider.max = Math.max(maxTimelineMinutes, 60);
    if (Number(timeSlider.value) > Number(timeSlider.max)) {
        timeSlider.value = timeSlider.max;
    }
    updateTimeLabels();
};

const formatTime = minutes => {
    const totalMinutes = (baseDepartureMinutes ?? 0) + minutes;
    const hours = Math.floor(totalMinutes / 60) % 24;
    const mins = totalMinutes % 60;
    return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
};

const updateTimeLabels = () => {
    const minutes = Number(timeSlider.value);
    timeLabel.textContent = formatTime(minutes);
    const offset = minutes;
    timeOffsetLabel.textContent = offset === 0 ? "+0 min" : `+${offset} min`;
};

const calculatePositions = minutes => {
    const states = trains.map(deriveTrainState);
    const currentMinute = (baseDepartureMinutes ?? 0) + minutes;

    return states
        .map((train, idx) => {
            if (train.manualPositionKm != null) {
                return {
                    index: idx,
                    name: train.name,
                    distance: clampDistance(train.manualPositionKm),
                    state: { ...train, isManual: true }
                };
            }

            if (currentMinute < train.departureMinutes || currentMinute > train.arrivalMinutes) {
                return null;
            }

            const elapsedHours = (currentMinute - train.departureMinutes) / 60;
            const traveledKm = Math.min(train.speed * elapsedHours, train.distance);
            const distance = clampDistance((train.startOffsetKm || 0) + traveledKm);

            return {
                index: idx,
                name: train.name,
                distance,
                state: train
            };
        })
        .filter(Boolean);
};

const checkWarnings = positions => {
    const warnings = [];

    for (let i = 0; i < positions.length; i += 1) {
        for (let j = i + 1; j < positions.length; j += 1) {
            const trainA = positions[i];
            const trainB = positions[j];
            const pathIndexA = Number.isFinite(trainA.state.pathIndex) ? trainA.state.pathIndex : 0;
            const pathIndexB = Number.isFinite(trainB.state.pathIndex) ? trainB.state.pathIndex : 0;
            const crossingMatch = crossings.find(crossing =>
                Math.abs(trainA.distance - crossing.km) < 0.01 &&
                Math.abs(trainB.distance - crossing.km) < 0.01
            );

            if (pathIndexA !== pathIndexB && !crossingMatch) {
                continue;
            }

            const gap = Math.abs(trainA.distance - trainB.distance) - (trainA.state.lengthKm + trainB.state.lengthKm);
            const nearCrossing = crossingMatch
                ? (
                    (Number.isFinite(crossingMatch.pathIndex) &&
                        crossingMatch.pathIndex === pathIndexA &&
                        crossingMatch.pathIndex === pathIndexB) ||
                    pathIndexA !== pathIndexB
                )
                : false;

            if (gap < SAFE_DISTANCE_KM && !nearCrossing) {
                warnings.push({
                    trains: [trainA, trainB],
                    gapKm: gap,
                    gapMeters: Math.max(gap * 1000, 0)
                });
            }
        }
    }

    return warnings;
};

const renderWarnings = warnings => {
    warningsPanel.innerHTML = "";

    if (!warnings.length) {
        warningsPanel.innerHTML = `<div class="no-warnings">All clear — no spacing conflicts detected.</div>`;
        return;
    }

    warnings.forEach(warning => {
        const item = document.createElement("div");
        item.className = "warning-item";
        const [trainA, trainB] = warning.trains;
        item.innerHTML = `
            <strong>Spacing Alert</strong>
            <span>${trainA.name} ↔ ${trainB.name}</span>
            <em>${warning.gapMeters.toFixed(1)} m</em>
        `;
        warningsPanel.appendChild(item);
    });
};

const recordConflicts = (warnings, minute) => {
    if (!Number.isFinite(minute)) {
        return false;
    }
    const normalizedMinute = Math.max(0, Math.round(minute));
    let added = false;

    warnings.forEach(warning => {
        const names = [warning.trains[0].name, warning.trains[1].name].sort();
        const key = names.join("|") + "@" + normalizedMinute;
        if (conflictLogKeys.has(key)) {
            return;
        }
        conflictLogKeys.add(key);
        const deficitMeters = Math.max(0, SAFE_DISTANCE_KM * 1000 - warning.gapMeters);
        let suggestion = "";
        if (deficitMeters > 0) {
            const trailing =
                warning.trains[0].distance <= warning.trains[1].distance
                    ? warning.trains[0]
                    : warning.trains[1];
            const trailingSpeed = Math.max(trailing.state.speed || 0, 1);
            const delayMinutes = Math.ceil((deficitMeters / 1000) / trailingSpeed * 60);
            if (Number.isFinite(delayMinutes) && delayMinutes > 0) {
                suggestion = "Delay " + trailing.name + " by " + delayMinutes + " min";
            } else {
                suggestion = "Reduce " + trailing.name + " speed briefly";
            }
        }
        const entry = {
            key,
            minute: normalizedMinute,
            trains: names,
            gapMeters: warning.gapMeters,
            suggestion
        };
        conflictLog.push(entry);
        if (conflictLog.length > CONFLICT_LOG_LIMIT) {
            const removed = conflictLog.shift();
            if (removed) {
                conflictLogKeys.delete(removed.key);
            }
        }
        added = true;
    });

    return added;
};

const refreshConflictFilterOptions = () => {
    if (!conflictFilterSelect) {
        return;
    }
    const previousValue = conflictFilterSelect.value || "all";
    conflictFilterSelect.innerHTML = "";

    const allOption = document.createElement("option");
    allOption.value = "all";
    allOption.textContent = "All trains";
    conflictFilterSelect.appendChild(allOption);

    trains.forEach(train => {
        const option = document.createElement("option");
        option.value = train.name;
        option.textContent = train.name;
        conflictFilterSelect.appendChild(option);
    });

    const availableValues = Array.from(conflictFilterSelect.options).map(option => option.value);
    if (availableValues.includes(previousValue)) {
        conflictFilterSelect.value = previousValue;
        activeConflictFilter = previousValue;
    } else {
        conflictFilterSelect.value = "all";
        activeConflictFilter = "all";
    }
};

const renderConflictLog = (currentMinute = null) => {
    if (!conflictLogList) {
        return;
    }
    const filterValue = conflictFilterSelect ? conflictFilterSelect.value : "all";
    activeConflictFilter = filterValue;
    conflictLogList.innerHTML = "";

    const normalizedMinute = Number.isFinite(currentMinute) ? Math.max(0, Math.round(currentMinute)) : null;
    const filtered = conflictLog
        .filter(entry => filterValue === "all" || entry.trains.includes(filterValue))
        .sort((a, b) => a.minute - b.minute);

    if (!filtered.length) {
        const empty = document.createElement("div");
        empty.className = "conflict-empty";
        empty.textContent = "No conflicts recorded yet.";
        conflictLogList.appendChild(empty);
        return;
    }

    filtered.forEach(entry => {
        const item = document.createElement("button");
        item.type = "button";
        item.className = "conflict-log-item";
        if (normalizedMinute !== null && entry.minute === normalizedMinute) {
            item.classList.add("is-active");
        }
        const suggestionHtml = entry.suggestion
            ? `<span class="conflict-log-suggestion">${entry.suggestion}</span>`
            : "";
        item.innerHTML = `
            <span class="conflict-log-time">${formatTime(entry.minute)}</span>
            <span class="conflict-log-trains">${entry.trains.join(" ↔ ")}</span>
            <span class="conflict-log-gap">${entry.gapMeters.toFixed(0)} m</span>
            ${suggestionHtml}
        `;
        item.addEventListener("click", () => {
            if (playing) {
                togglePlay();
            }
            const max = Number(timeSlider.max);
            const targetMinute = Math.min(entry.minute, Number.isFinite(max) ? max : entry.minute);
            timeSlider.value = targetMinute;
            render();
        });
        conflictLogList.appendChild(item);
    });
};

const clearConflictLog = () => {
    conflictLog.length = 0;
    conflictLogKeys.clear();
    if (conflictFilterSelect) {
        conflictFilterSelect.value = "all";
    }
    activeConflictFilter = "all";
    refreshConflictFilterOptions();
    renderConflictLog(Math.round(Number(timeSlider.value) || 0));
};

const buildReportTableRows = scenario => {
    const scenarioStartNodes = scenario.startNodes || [];
    const resolveOriginLabel = train => {
        if (train.startNodeId) {
            const node = getStartNodeById(train.startNodeId) ||
                scenarioStartNodes.find(item => item.id === train.startNodeId);
            if (node) {
                return node.name + " (" + Number(node.km || 0).toFixed(1) + " km)";
            }
        }
        return (stationNames.start || "Origin") + " (0 km)";
    };

    return scenario.trains
        .map(train => {
            const colorBlock =
                '<span style="display:inline-block;width:14px;height:14px;border-radius:50%;background:' +
                escapeHtml(train.color || "#1c8ef9") +
                ';border:1px solid rgba(0,0,0,0.18);margin-right:8px;"></span>';
            return (
                "<tr>" +
                "<td>" +
                colorBlock +
                escapeHtml(train.name) +
                (train.tag ? " <small>(" + escapeHtml(train.tag) + ")</small>" : "") +
                "</td>" +
                "<td>" +
                escapeHtml(resolveOriginLabel(train)) +
                "</td>" +
                "<td>" +
                escapeHtml(train.departure) +
                "</td>" +
                "<td>" +
                Number(train.speed || 0).toFixed(0) +
                " km/h</td>" +
                "<td>" +
                Number(train.distance || 0).toFixed(1) +
                " km</td>" +
                "<td>" +
                escapeHtml(String(train.cars || "")) +
                "</td>" +
                "<td>" +
                escapeHtml(String(train.carLength || "")) +
                " m</td>" +
                "</tr>"
            );
        })
        .join("");
};

const buildConflictReportRows = () => {
    if (!conflictLog.length) {
        return '<tr><td colspan="4">No conflicts recorded.</td></tr>';
    }
    const rows = conflictLog
        .slice()
        .sort((a, b) => a.minute - b.minute)
        .map(entry => {
            return (
                "<tr>" +
                "<td>" +
                escapeHtml(formatTime(entry.minute)) +
                "</td>" +
                "<td>" +
                escapeHtml(entry.trains.join(" ↔ ")) +
                "</td>" +
                "<td>" +
                Math.max(0, Math.round(entry.gapMeters)) +
                " m</td>" +
                "<td>" +
                escapeHtml(entry.suggestion || "Review spacing") +
                "</td>" +
                "</tr>"
            );
        })
        .join("");
    return rows;
};

const generateReport = () => {
    const reportWindow = window.open("", "_blank", "width=1000,height=760");
    if (!reportWindow) {
        alert("Unable to open report window. Please allow popups for this site.");
        return;
    }

    const scenarioSnapshot = serializeScenario();
    const trainsRows = buildReportTableRows(scenarioSnapshot);
    const conflictRows = buildConflictReportRows();

    const reportStyles = `
        body {
            font-family: "Space Grotesk", system-ui, sans-serif;
            margin: 40px;
            color: #091020;
        }
        h1, h2, h3 {
            letter-spacing: 0.08em;
        }
        h1 {
            margin-bottom: 12px;
        }
        h2 {
            margin-top: 32px;
            margin-bottom: 12px;
        }
        table {
            width: 100%;
            border-collapse: collapse;
            margin-bottom: 24px;
        }
        th, td {
            border: 1px solid rgba(9, 16, 32, 0.08);
            padding: 10px 12px;
            text-align: left;
        }
        th {
            background: rgba(9, 16, 32, 0.06);
            letter-spacing: 0.06em;
        }
        .meta-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
            gap: 10px;
            margin-bottom: 24px;
        }
        .meta-item {
            padding: 12px 16px;
            border-radius: 12px;
            background: rgba(9, 16, 32, 0.06);
        }
        .meta-item strong {
            display: block;
            font-size: 0.9rem;
            letter-spacing: 0.08em;
            margin-bottom: 6px;
        }
        .footer-note {
            margin-top: 32px;
            font-size: 0.85rem;
            color: rgba(9, 16, 32, 0.6);
        }
        @media print {
            body {
                margin: 20px;
            }
            .no-print {
                display: none !important;
            }
        }
    `;

    const reportHtml = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="utf-8">
            <title>Rail Flow Scenario Report</title>
            <style>${reportStyles}</style>
        </head>
        <body>
            <h1>Rail Flow Scenario Report</h1>
            <div class="meta-grid">
                <div class="meta-item">
                    <strong>Generated</strong>
                    <span>${escapeHtml(new Date().toLocaleString())}</span>
                </div>
                <div class="meta-item">
                    <strong>Track Length</strong>
                    <span>${Number(scenarioSnapshot.trackLengthKm || 0).toFixed(1)} km</span>
                </div>
                <div class="meta-item">
                    <strong>Stations</strong>
                    <span>${escapeHtml(stationNames.start)} → ${escapeHtml(stationNames.end)}</span>
                </div>
                <div class="meta-item">
                    <strong>Playback Speed</strong>
                    <span>${playbackMultiplier.toFixed(2)}×</span>
                </div>
                <div class="meta-item">
                    <strong>Viewport</strong>
                    <span>${usingCustomTrackPath ? "Custom SVG path" : "Default straight line"}</span>
                </div>
            </div>
            <h2>Train Roster</h2>
            <table>
                <thead>
                    <tr>
                        <th>Train</th>
                        <th>Origin</th>
                        <th>Departure</th>
                        <th>Speed</th>
                        <th>Distance</th>
                        <th>Cars</th>
                        <th>Car Length</th>
                    </tr>
                </thead>
                <tbody>
                    ${trainsRows || '<tr><td colspan="6">No trains defined.</td></tr>'}
                </tbody>
            </table>
            <h2>Conflict Log</h2>
            <table>
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>Trains</th>
                        <th>Gap</th>
                        <th>Suggested Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${conflictRows}
                </tbody>
            </table>
            <h2>Crossings</h2>
            <table>
                <thead>
                    <tr>
                        <th>Label</th>
                        <th>Distance</th>
                    </tr>
                </thead>
                <tbody>
                    ${crossings.length
                        ? crossings
                              .map(
                                  crossing =>
                                      "<tr><td>" +
                                      escapeHtml(crossing.label || "Crossing") +
                                      "</td><td>" +
                                      crossing.km.toFixed(1) +
                                      " km</td></tr>"
                              )
                              .join("")
                        : '<tr><td colspan="2">No crossings defined.</td></tr>'}
                </tbody>
            </table>
            <button class="no-print" onclick="window.print()">Print Report</button>
            <div class="footer-note">
                Generated by Rail Flow Visual Calculator.
            </div>
        </body>
        </html>
    `;

    reportWindow.document.open();
    reportWindow.document.write(reportHtml);
    reportWindow.document.close();
    reportWindow.focus();
    try {
        setTimeout(() => reportWindow.print(), 250);
    } catch (error) {
        console.warn("Auto print failed:", error);
    }
};

// ============================================================================
// Rendering Pipeline
// ============================================================================

const render = () => {
    const minutes = Number(timeSlider.value);
    updateTimeLabels();

    trainLayer.innerHTML = "";
    hideTooltip();
    trains.forEach((_, idx) => {
        const previousGroup = document.getElementById(`train-icon-${idx}`);
        if (previousGroup) {
            previousGroup.remove();
        }
    });
    const positions = calculatePositions(minutes);
    const warnings = checkWarnings(positions);
    const minuteStamp = Math.max(0, Math.round(minutes));
    recordConflicts(warnings, minuteStamp);
    renderConflictLog(minuteStamp);
    const warningIndexes = new Set();

    warnings.forEach(w => {
        w.trains.forEach(train => warningIndexes.add(train.index));
    });

    positions.forEach(train => {
        const lane = train.index;
        const pathIndex = Number.isFinite(train.state.pathIndex) ? train.state.pathIndex : 0;
        const { x, y } = getTrackPoint(train.distance, lane, pathIndex);
        const lengthPx = Math.max(24, trackLengthKm > 0 ? (train.state.lengthKm / trackLengthKm) * TRACK_VIEW_WIDTH : 24);
        const isWarning = warningIndexes.has(train.index);
        const color = train.state.color || "#1c8ef9";
        const tagSuffix = train.state.tag ? " • " + train.state.tag : "";

        if (usingCustomTrackPath) {
            const iconGroup = createSvgElement("g", {
                id: `train-icon-${train.index}`,
                transform: "translate(" + x + ", " + y + ")"
            });
            const halo = createSvgElement("circle", {
                r: 12,
                fill: "rgba(255, 255, 255, 0.94)"
            });
            const dot = createSvgElement("circle", {
                r: 6,
                fill: isWarning ? "#ff4f8b" : color,
                stroke: isWarning ? "#c81b62" : "#0b466c",
                "stroke-width": "2"
            });
            const iconLabel = createSvgElement("text", {
                y: -18,
                "text-anchor": "middle",
                "font-size": "12",
                "font-weight": "600",
                fill: "#0b0f1f",
                "letter-spacing": "0.05em"
            });
            iconLabel.textContent = train.name + tagSuffix;
            const infoLabel = createSvgElement("text", {
                y: 22,
                "text-anchor": "middle",
                "font-size": "10",
                fill: "rgba(15, 23, 42, 0.7)",
                "letter-spacing": "0.04em"
            });
            infoLabel.textContent = `${train.distance.toFixed(1)} km`;
            iconGroup.append(halo, dot, iconLabel, infoLabel);
            attachTooltip(iconGroup, () =>
                "<strong>" +
                train.name +
                "</strong><br>" +
                "Speed: " +
                train.state.speed.toFixed(0) +
                " km/h" +
                (tagSuffix ? "<br>" + tagSuffix.slice(3) : "")
            );
            trainLayer.appendChild(iconGroup);
            return;
        }

        const group = createSvgElement("g", { transform: "translate(" + x + ", " + y + ")" });
        group.dataset.index = train.index;
        group.addEventListener("click", event => {
            event.stopPropagation();
            setActiveTrain(train.index);
        });

        const rect = createSvgElement("rect", {
            x: -lengthPx / 2,
            y: -16,
            width: lengthPx,
            height: 32,
            rx: 10,
            fill: isWarning ? "url(#warningGradient)" : color
        });
        if (isWarning) {
            rect.setAttribute("filter", "url(#glow)");
        }

        const labelBg = createSvgElement("rect", {
            x: -Math.max(70, lengthPx) / 2,
            y: -44,
            width: Math.max(70, lengthPx),
            height: 26,
            rx: 8,
            fill: "rgba(3, 9, 22, 0.85)"
        });

        const label = createSvgElement("text", {
            fill: "#f0f7ff",
            "font-size": "14",
            "font-weight": "600",
            "text-anchor": "middle",
            y: -26
        });
        label.textContent =
            train.name +
            " • " +
            train.state.speed +
            " km/h" +
            (train.state.isManual ? " • manual" : "") +
            tagSuffix;

        const nose = createSvgElement("polygon", {
            points: "0,-18 18,0 0,18",
            fill: isWarning ? "#ff4f8b" : color,
            opacity: "0.75"
        });

        const positionTag = createSvgElement("text", {
            fill: "rgba(255,255,255,0.7)",
            "font-size": "12",
            "text-anchor": "middle",
            y: 28
        });
        positionTag.textContent = `${train.distance.toFixed(1)} km`;

        group.append(labelBg, label, rect, nose, positionTag);
        attachTooltip(group, () =>
            "<strong>" +
            train.name +
            "</strong><br>Speed: " +
            train.state.speed.toFixed(0) +
            " km/h<br>Distance: " +
            train.distance.toFixed(1) +
            " km" +
            (tagSuffix ? "<br>" + tagSuffix.slice(3) : "")
        );
        trainLayer.appendChild(group);
    });

    renderWarnings(warnings);
};

const buildTrack = () => {
    trackBase.innerHTML = "";

    if (usingCustomTrackPath && trackPathElement && trackPathLength > 0) {
        const startPoint = getTrackPoint(0, 0);
        const endPoint = getTrackPoint(trackLengthKm, 0);

        trackPathElements.forEach((pathObj, index) => {
            if (!pathObj.element) {
                return;
            }
            const ballast = pathObj.element.cloneNode(true);
            ballast.removeAttribute("id");
            ballast.setAttribute("fill", "none");
            ballast.setAttribute(
                "stroke",
                index === 0 ? "rgba(15, 23, 42, 0.65)" : "rgba(20, 32, 52, 0.55)"
            );
            ballast.setAttribute("stroke-width", index === 0 ? "14" : "10");
            ballast.setAttribute("stroke-linecap", "round");
            ballast.setAttribute("stroke-linejoin", "round");
            ballast.setAttribute("pointer-events", "none");

            const rail = pathObj.element.cloneNode(true);
            rail.removeAttribute("id");
            rail.classList.add("track-path-highlight");
            rail.setAttribute("fill", "none");
            rail.setAttribute(
                "stroke",
                index === 0 ? "rgba(109, 248, 255, 0.75)" : "rgba(128, 178, 255, 0.55)"
            );
            rail.setAttribute("stroke-width", index === 0 ? "6" : "4");
            rail.setAttribute("stroke-linecap", "round");
            rail.setAttribute("stroke-linejoin", "round");
            rail.setAttribute("pointer-events", "none");

            trackBase.appendChild(ballast);
            trackBase.appendChild(rail);
        });

        const createStationMarker = (point, label, distanceKm, align = "end") => {
            const group = createSvgElement("g", {
                transform: "translate(" + point.x + ", " + point.y + ")"
            });
            const outer = createSvgElement("circle", {
                r: 18,
                fill: "rgba(6, 10, 28, 0.92)",
                stroke: align === "end" ? "rgba(109, 248, 255, 0.85)" : "rgba(255, 79, 139, 0.9)",
                "stroke-width": "3"
            });
            const inner = createSvgElement("circle", {
                r: 9,
                fill: align === "end" ? "rgba(99, 242, 210, 0.95)" : "rgba(255, 146, 108, 0.95)"
            });
            const nameLabel = createSvgElement("text", {
                x: align === "end" ? -28 : 28,
                y: -26,
                fill: "rgba(9, 14, 28, 0.95)",
                "font-size": "13",
                "font-weight": "600",
                "text-anchor": align === "end" ? "end" : "start",
                "letter-spacing": "0.06em"
            });
            nameLabel.textContent = label;
            const distanceLabel = createSvgElement("text", {
                x: align === "end" ? -28 : 28,
                y: -10,
                fill: "rgba(15, 23, 42, 0.68)",
                "font-size": "12",
                "text-anchor": align === "end" ? "end" : "start",
                "letter-spacing": "0.04em"
            });
            distanceLabel.textContent = distanceKm.toFixed(1) + " km";
            group.append(outer, inner, nameLabel, distanceLabel);
            trackBase.appendChild(group);
            attachTooltip(group, () =>
                "<strong>" + label + "</strong><br>Distance: " + distanceKm.toFixed(1) + " km"
            );
        };

        createStationMarker(startPoint, stationNames.start, 0, "end");
        createStationMarker(endPoint, stationNames.end, trackLengthKm, "start");

        crossings.forEach((crossing, index) => {
            const point = getTrackPoint(crossing.km, 0, crossing.pathIndex);
            const markerGroup = createSvgElement("g", {
                transform: "translate(" + point.x + ", " + point.y + ")"
            });
            const crossShape = createSvgElement("g", { "pointer-events": "none" });
            const crossHorizontal = createSvgElement("rect", {
                x: -10,
                y: -2,
                width: 20,
                height: 4,
                fill: "rgba(255, 79, 139, 0.85)",
                rx: 2
            });
            const crossVertical = createSvgElement("rect", {
                x: -2,
                y: -10,
                width: 4,
                height: 20,
                fill: "rgba(255, 79, 139, 0.85)",
                rx: 2
            });
            const crossDiagA = createSvgElement("rect", {
                x: -2,
                y: -10,
                width: 4,
                height: 20,
                fill: "rgba(255, 79, 139, 0.65)",
                rx: 2,
                transform: "rotate(45)"
            });
            const crossDiagB = createSvgElement("rect", {
                x: -2,
                y: -10,
                width: 4,
                height: 20,
                fill: "rgba(255, 79, 139, 0.65)",
                rx: 2,
                transform: "rotate(-45)"
            });
            crossShape.append(crossHorizontal, crossVertical, crossDiagA, crossDiagB);
            const label = createSvgElement("text", {
                y: -18,
                fill: "rgba(9, 14, 28, 0.95)",
                "font-size": "11",
                "font-weight": "600",
                "text-anchor": "middle",
                "letter-spacing": "0.05em"
            });
            label.textContent = crossing.label || "Crossing " + (index + 1);
            const distanceLabel = createSvgElement("text", {
                y: 24,
                fill: "rgba(15, 23, 42, 0.72)",
                "font-size": "10",
                "text-anchor": "middle",
                "letter-spacing": "0.05em"
            });
            distanceLabel.textContent = crossing.km.toFixed(1) + " km";
            markerGroup.append(crossShape, label, distanceLabel);
            trackBase.appendChild(markerGroup);
            attachTooltip(markerGroup, () =>
                "<strong>" + (crossing.label || "Crossing " + (index + 1)) + "</strong><br>Distance: " +
                crossing.km.toFixed(1) +
                " km"
            );
        });

    stationNodes.forEach(node => {
            if (!node || node.km <= 0.001 || Math.abs(node.km - trackLengthKm) <= 0.001) {
                return;
            }
        const markerPoint = getTrackPoint(node.km, 0, node.pathIndex);
            createStationMarker(markerPoint, node.name, node.km, "end");
        });

        applyViewportTransform();
        return;
    }
    const ballast = createSvgElement("rect", {
        x: TRACK_PADDING_X - 10,
        y: 118,
        width: TRACK_VIEW_WIDTH + 20,
        height: 64,
        rx: 26,
        fill: "rgba(30, 55, 77, 0.45)",
        stroke: "rgba(109, 248, 255, 0.12)",
        "stroke-width": "2"
    });
    trackBase.appendChild(ballast);

    const tieCount = 34;
    const tieSpacing = TRACK_VIEW_WIDTH / (tieCount - 1);
    for (let i = 0; i < tieCount; i += 1) {
        const tieX = TRACK_PADDING_X + i * tieSpacing;
        const tie = createSvgElement("rect", {
            x: tieX - 9,
            y: 128,
            width: 18,
            height: 44,
            rx: 6,
            fill: "rgba(12, 20, 36, 0.85)",
            stroke: "rgba(109, 248, 255, 0.08)",
            "stroke-width": "1",
            opacity: i % 2 === 0 ? "0.6" : "0.45"
        });
        trackBase.appendChild(tie);
    }

    const upperRail = createSvgElement("line", {
        x1: TRACK_PADDING_X,
        x2: TRACK_PADDING_X + TRACK_VIEW_WIDTH,
        y1: 134,
        y2: 134,
        stroke: "rgba(109, 248, 255, 0.85)",
        "stroke-width": "6",
        "stroke-linecap": "round"
    });
    trackBase.appendChild(upperRail);

    const lowerRail = createSvgElement("line", {
        x1: TRACK_PADDING_X,
        x2: TRACK_PADDING_X + TRACK_VIEW_WIDTH,
        y1: 166,
        y2: 166,
        stroke: "rgba(99, 242, 210, 0.85)",
        "stroke-width": "6",
        "stroke-linecap": "round"
    });
    trackBase.appendChild(lowerRail);

    const centerHighlight = createSvgElement("line", {
        x1: TRACK_PADDING_X,
        x2: TRACK_PADDING_X + TRACK_VIEW_WIDTH,
        y1: 150,
        y2: 150,
        stroke: "rgba(255, 255, 255, 0.12)",
        "stroke-width": "3",
        "stroke-linecap": "round",
        "stroke-dasharray": "14 18"
    });
    trackBase.appendChild(centerHighlight);

    DEFAULT_PATH_DEFINITIONS.forEach((pathDef, idx) => {
        if (idx === 0) {
            return;
        }
        const start = pathDef.computePoint(0);
        const end = pathDef.computePoint(1);
        const supplementalLine = createSvgElement("line", {
            x1: start.x,
            y1: start.y,
            x2: end.x,
            y2: end.y,
            stroke: pathDef.stroke,
            "stroke-width": pathDef.width,
            "stroke-linecap": "round",
            "pointer-events": "none"
        });
        trackBase.appendChild(supplementalLine);
    });

    const startStation = createSvgElement("g", { transform: "translate(" + TRACK_PADDING_X + ", 150)" });
    const startMarker = createSvgElement("circle", {
        r: 18,
        fill: "rgba(6, 10, 28, 0.92)",
        stroke: "rgba(109, 248, 255, 0.85)",
        "stroke-width": "3"
    });
    const startInner = createSvgElement("circle", {
        r: 9,
        fill: "rgba(99, 242, 210, 0.95)"
    });
    const startLabel = createSvgElement("text", {
        x: -26,
        y: -34,
        fill: "rgba(247, 251, 255, 0.9)",
        "font-size": "13",
        "font-weight": "600",
        "text-anchor": "end",
        "letter-spacing": "0.08em"
    });
    startLabel.textContent = stationNames.start + " • 0 km";
    startStation.append(startMarker, startInner, startLabel);
    trackBase.appendChild(startStation);
    attachTooltip(startStation, () =>
        "<strong>" + stationNames.start + "</strong><br>Distance: 0 km"
    );

    const endStation = createSvgElement("g", {
        transform: "translate(" + (TRACK_PADDING_X + TRACK_VIEW_WIDTH) + ", 150)"
    });
    const endMarker = createSvgElement("circle", {
        r: 18,
        fill: "rgba(6, 10, 28, 0.92)",
        stroke: "rgba(255, 79, 139, 0.9)",
        "stroke-width": "3"
    });
    const endInner = createSvgElement("circle", {
        r: 9,
        fill: "rgba(255, 146, 108, 0.95)"
    });
    const endLabel = createSvgElement("text", {
        x: 26,
        y: -34,
        fill: "rgba(247, 251, 255, 0.9)",
        "font-size": "13",
        "font-weight": "600",
        "text-anchor": "start",
        "letter-spacing": "0.08em"
    });
    endLabel.textContent = stationNames.end + " • " + trackLengthKm.toFixed(1) + " km";
    endStation.append(endMarker, endInner, endLabel);
    trackBase.appendChild(endStation);
    attachTooltip(endStation, () =>
        "<strong>" + stationNames.end + "</strong><br>Distance: " + trackLengthKm.toFixed(1) + " km"
    );

    crossings.forEach((crossing, idx) => {
        const point = getTrackPoint(crossing.km, 0, crossing.pathIndex);

        const crossGroup = createSvgElement("g", {
            transform: "translate(" + point.x + ", 150)"
        });
        const crossShape = createSvgElement("g", { "pointer-events": "none" });
        const crossHorizontal = createSvgElement("rect", {
            x: -10,
            y: -2,
            width: 20,
            height: 4,
            fill: "rgba(255, 79, 139, 0.85)",
            rx: 2
        });
        const crossVertical = createSvgElement("rect", {
            x: -2,
            y: -10,
            width: 4,
            height: 20,
            fill: "rgba(255, 79, 139, 0.85)",
            rx: 2
        });
        const crossDiagA = createSvgElement("rect", {
            x: -2,
            y: -10,
            width: 4,
            height: 20,
            fill: "rgba(255, 79, 139, 0.65)",
            rx: 2,
            transform: "rotate(45)"
        });
        const crossDiagB = createSvgElement("rect", {
            x: -2,
            y: -10,
            width: 4,
            height: 20,
            fill: "rgba(255, 79, 139, 0.65)",
            rx: 2,
            transform: "rotate(-45)"
        });
        crossShape.append(crossHorizontal, crossVertical, crossDiagA, crossDiagB);
        crossGroup.appendChild(crossShape);
        trackBase.appendChild(crossGroup);

        const label = createSvgElement("text", {
            x: point.x,
            y: 92,
            fill: "rgba(247, 251, 255, 0.75)",
            "font-size": "12",
            "text-anchor": "middle",
            "letter-spacing": "0.08em"
        });
        const labelText = crossing.label || ("Crossing " + (idx + 1));
        label.textContent = labelText + " • " + crossing.km.toFixed(1) + " km";
        trackBase.appendChild(label);

        const hotspot = createSvgElement("circle", {
            cx: point.x,
            cy: 150,
            r: 12,
            fill: "rgba(0,0,0,0)",
            "pointer-events": "all"
        });
        trackBase.appendChild(hotspot);
        attachTooltip(hotspot, () =>
            "<strong>" + labelText + "</strong><br>Distance: " + crossing.km.toFixed(1) + " km"
        );
    });

    stationNodes.forEach(node => {
        if (!node || node.km <= 0.001 || Math.abs(node.km - trackLengthKm) <= 0.001) {
            return;
        }
        const point = getTrackPoint(node.km, 0, node.pathIndex);
        const markerGroup = createSvgElement("g", {
            transform: "translate(" + point.x + ", " + point.y + ")"
        });
        const marker = createSvgElement("circle", {
            r: 10,
            fill: "rgba(109, 248, 255, 0.85)",
            stroke: "rgba(0, 32, 54, 0.6)",
            "stroke-width": "2"
        });
        const label = createSvgElement("text", {
            y: -18,
            fill: "rgba(9, 14, 28, 0.95)",
            "font-size": "11",
            "font-weight": "600",
            "text-anchor": "middle",
            "letter-spacing": "0.05em"
        });
        label.textContent = node.name;
        markerGroup.append(marker, label);
        trackBase.appendChild(markerGroup);
        attachTooltip(markerGroup, () =>
            "<strong>" + node.name + "</strong><br>Distance: " + node.km.toFixed(1) + " km"
        );
    });

    applyViewportTransform();
};

const handleMapUpload = event => {
    const file = event.target.files?.[0];

    if (!file) {
        return;
    }

    if (!file.type.includes("svg") && !file.name.toLowerCase().endsWith(".svg")) {
        mapStatus.textContent = "Unsupported file type. Please select an SVG file.";
        mapStatus.style.color = "var(--accent-strong)";
        return;
    }

    const reader = new FileReader();

    reader.onload = () => {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(reader.result, "image/svg+xml");
            const parseError = doc.querySelector("parsererror");

            if (parseError) {
                throw new Error("Invalid SVG content.");
            }

            const uploadedSvg = doc.documentElement;
            const nestedSvg = document.importNode(uploadedSvg, true);

            nestedSvg.removeAttribute("width");
            nestedSvg.removeAttribute("height");
            nestedSvg.setAttribute("x", nestedSvg.getAttribute("x") ?? "0");
            nestedSvg.setAttribute("y", nestedSvg.getAttribute("y") ?? "0");

            mapLayer.innerHTML = "";
            mapLayer.appendChild(nestedSvg);
            updateTrackPath();
            resetViewport();

            const derivedRatios = deriveCrossingRatiosFromSvg(nestedSvg);
            let statusMessage;
            if (derivedRatios.length) {
                crossingState = derivedRatios.map((entry, index) => {
                    const ratio = typeof entry === "number" ? entry : entry.ratio;
                    const pathIndex = typeof entry === "object" && Number.isFinite(entry.pathIndex) ? entry.pathIndex : 0;
                    const label =
                        typeof entry === "object" && entry.label
                            ? entry.label
                            : `Crossing ${index + 1}`;
                    return {
                        ratio,
                        label,
                        pathIndex
                    };
                });
                recalcCrossings();
                renderCrossingControls();
                statusMessage = `Loaded: ${file.name} • ${crossings.length} map crossings`;
            } else {
                resetCrossingsToDefault();
                statusMessage = `Loaded: ${file.name} • No crossings detected (using defaults)`;
            }

            if (usingCustomTrackPath) {
                const pathCount = trackPathElements.length;
                if (pathCount > 1) {
                    statusMessage += ` • ${pathCount} track paths detected for animation.`;
                } else {
                    statusMessage += " • Track path detected for live animation.";
                }
            } else {
                statusMessage += " • Add data-track=\"true\" to your SVG path to animate trains along it.";
            }

            buildTrack();
            applyViewportTransform();
            render();

            mapStatus.textContent = statusMessage;
            mapStatus.style.color = "var(--text-secondary)";
        } catch (error) {
            mapLayer.innerHTML = "";
            mapStatus.textContent = `Error loading SVG: ${error.message}`;
            mapStatus.style.color = "var(--accent-strong)";
        }
    };

    reader.onerror = () => {
        mapStatus.textContent = "Failed to read file.";
        mapStatus.style.color = "var(--accent-strong)";
    };

    reader.readAsText(file);
};

const clearMap = () => {
    mapLayer.innerHTML = "";
    mapUploadInput.value = "";
    mapStatus.textContent = "No map uploaded.";
    mapStatus.style.color = "var(--text-secondary)";
    mapTrackGroupRef = null;
    resetCrossingsToDefault();
    updateTrackPath();
    buildTrack();
    applyViewportTransform();
    render();
};

const handleTrackLengthChange = () => {
    const value = Number(trackLengthInput.value);
    if (!Number.isFinite(value) || value <= 0) {
        return;
    }
    trackLengthKm = Math.max(1, value);
    trackLengthInput.value = trackLengthKm;
    applyTrackLengthToTrains();
    recalcCrossings();
    renderCrossingControls();
    updateTrackLengthSummary();
    renderTrackLabels();
    customStationNodes.forEach(node => {
        node.km = clampDistance(node.km);
    });
    mergeStationNodes(collectStationNodesFromMap());
    renderStationList();
    collectStartNodes();
    buildTrack();
    recalcTimeline();
    render();
};

const handleTrackClick = event => {
    if (!trains.length || isPanning || event.altKey) {
        return;
    }

    const trainLayerNode = event.target.closest("#train-layer");
    if (trainLayerNode) {
        return;
    }

    if (event.shiftKey) {
        const localPoint = getLocalPointFromClient(event.clientX, event.clientY);
        let kmValue = null;
        let projectedPoint = null;

        if (usingCustomTrackPath && trackPathElement && trackPathLength > 0) {
            const projection = projectPointToTrackPath(localPoint);
            if (projection) {
                kmValue = projection.km;
                projectedPoint = projection.point;
            }
        } else {
            const normalized = (localPoint.x - TRACK_PADDING_X) / TRACK_VIEW_WIDTH;
            if (normalized >= 0 && normalized <= 1) {
                kmValue = clampDistance(normalized * trackLengthKm);
                projectedPoint = getTrackPoint(kmValue, 0);
            }
        }

        if (kmValue == null) {
            return;
        }

        const defaultLabel = "Start Node " + (startNodes.length + 1);
        const nameInput = window.prompt("Label for new start node:", defaultLabel);
        if (nameInput !== null) {
            const newNode = addStartNode(nameInput.trim(), kmValue, projectedPoint);
            finalizeStartNodes();
            if (startNodesSelect && newNode) {
                const option = Array.from(startNodesSelect.options).find(opt => opt.value === newNode.id);
                if (option) {
                    option.selected = true;
                }
            }
        }
        return;
    }

    const localPoint = getLocalPointFromClient(event.clientX, event.clientY);
    let km;
    let pathIndexForTrain = 0;
    if (usingCustomTrackPath && trackPathElement && trackPathLength > 0) {
        const projection = projectPointToTrackPath(localPoint);
        if (!projection) {
            return;
        }
        km = projection.km;
        pathIndexForTrain = projection.pathIndex;
    } else {
        const fallbackProjection = projectPointToFallbackPaths(localPoint);
        if (!fallbackProjection) {
            return;
        }
        km = clampDistance(fallbackProjection.ratio * trackLengthKm);
        pathIndexForTrain = fallbackProjection.pathIndex;
    }

    if (!Number.isFinite(km)) {
        return;
    }

    const train = trains[activeTrainIndex];
    if (!train) {
        return;
    }
    train.pathIndex = pathIndexForTrain;
    train.manualPositionKm = km;
    syncManualInputForTrain(activeTrainIndex);
    render();
};

const stepAnimation = timestamp => {
    if (!playing) {
        return;
    }

    if (lastFrameTime === null) {
        lastFrameTime = timestamp;
    }

    const delta = timestamp - lastFrameTime;
    lastFrameTime = timestamp;

    const advanceMinutes = (delta / 1000) * 5 * playbackMultiplier;
    let newValue = Number(timeSlider.value) + advanceMinutes;

    if (newValue > Number(timeSlider.max)) {
        newValue = 0;
    }

    timeSlider.value = newValue;
    render();

    animationFrame = requestAnimationFrame(stepAnimation);
};

const togglePlay = () => {
    playing = !playing;
    playToggle.textContent = playing ? "Pause" : "Play";

    if (playing) {
        lastFrameTime = null;
        animationFrame = requestAnimationFrame(stepAnimation);
    } else if (animationFrame) {
        cancelAnimationFrame(animationFrame);
        animationFrame = null;
    }
};

const resetTime = () => {
    timeSlider.value = 0;
    updateTimeLabels();
    render();
};

const scrubTimeline = deltaMinutes => {
    const current = Number(timeSlider.value);
    const max = Number(timeSlider.max);
    if (!Number.isFinite(current) || !Number.isFinite(max)) {
        return;
    }
    let newValue = current + deltaMinutes;
    if (newValue < 0) {
        newValue = 0;
    } else if (newValue > max) {
        newValue = max;
    }
    timeSlider.value = newValue;
    if (playing) {
        lastFrameTime = null;
    }
    render();
};

const handleStationInput = () => {
    stationNames = {
        start: stationStartInput.value.trim() || DEFAULT_STATIONS.start,
        end: stationEndInput.value.trim() || DEFAULT_STATIONS.end
    };
    updateTrackLengthSummary();
    renderTrackLabels();
    collectStartNodes();
    buildTrack();
};

trainCountInput.addEventListener("input", event => {
    const count = Number(event.target.value);
    updateTrainCountLabel(count);
    buildTrainControls(count);
});

timeSlider.addEventListener("input", () => {
    if (playing) {
        togglePlay();
    }
    render();
});

if (playbackSpeedInput) {
    playbackSpeedInput.addEventListener("input", () => {
        const parsed = Number(playbackSpeedInput.value);
        const clamped = Math.min(Math.max(Number.isFinite(parsed) ? parsed : 1, 0.25), 4);
        playbackMultiplier = clamped;
        updatePlaybackSpeedLabel();
    });
}

if (scrubBackBtn) {
    scrubBackBtn.addEventListener("click", event => {
        const delta = event.shiftKey ? -5 : -1;
        scrubTimeline(delta);
    });
}

if (scrubForwardBtn) {
    scrubForwardBtn.addEventListener("click", event => {
        const delta = event.shiftKey ? 5 : 1;
        scrubTimeline(delta);
    });
}

playToggle.addEventListener("click", togglePlay);
resetTimeBtn.addEventListener("click", resetTime);
mapUploadInput.addEventListener("change", handleMapUpload);
clearMapBtn.addEventListener("click", clearMap);
resetCrossingsBtn.addEventListener("click", () => {
    resetCrossingsToDefault();
    mapStatus.textContent = "Crossings reset to defaults.";
    mapStatus.style.color = "var(--text-secondary)";
    buildTrack();
    render();
});
trackLengthInput.addEventListener("change", handleTrackLengthChange);
trackLengthInput.addEventListener("input", handleTrackLengthChange);
stationStartInput.addEventListener("input", handleStationInput);
stationEndInput.addEventListener("input", handleStationInput);
trackSvg.addEventListener("click", handleTrackClick);
if (trackSvg) {
    trackSvg.addEventListener("wheel", handleWheel, { passive: false });
    trackSvg.addEventListener("pointerdown", handlePointerDown);
    trackSvg.addEventListener("pointermove", handlePointerMove);
    trackSvg.addEventListener("pointerup", handlePointerUp);
    trackSvg.addEventListener("pointercancel", handlePointerUp);
}
if (zoomInBtn) {
    zoomInBtn.addEventListener("click", () => {
        changeZoom(ZOOM_STEP, getViewportCenterPoint());
    });
}
if (zoomOutBtn) {
    zoomOutBtn.addEventListener("click", () => {
        changeZoom(1 / ZOOM_STEP, getViewportCenterPoint());
    });
}
if (zoomResetBtn) {
    zoomResetBtn.addEventListener("click", resetViewport);
}
if (conflictFilterSelect) {
    conflictFilterSelect.addEventListener("change", () => {
        activeConflictFilter = conflictFilterSelect.value || "all";
        renderConflictLog(Math.round(Number(timeSlider.value) || 0));
    });
}
if (conflictClearBtn) {
    conflictClearBtn.addEventListener("click", () => {
        clearConflictLog();
    });
}
if (reportGenerateBtn) {
    reportGenerateBtn.addEventListener("click", generateReport);
}
if (stationListContainer) {
    stationListContainer.addEventListener("input", handleStationListInput);
    stationListContainer.addEventListener("click", handleStationListClick);
}
if (addStationBtn) {
    addStationBtn.addEventListener("click", () => {
        const defaultName = "Station " + (customStationNodes.length + 1);
        const defaultKm = clampDistance(trackLengthKm / Math.max(customStationNodes.length + 2, 2));
        addCustomStationNode(defaultName, defaultKm);
        mergeStationNodes(collectStationNodesFromMap());
        renderStationList();
        collectStartNodes();
        buildTrack();
        render();
    });
}
if (startNodesApplyBtn) {
    startNodesApplyBtn.addEventListener("click", () => {
        if (!startNodesSelect) {
            return;
        }
        const nodeIds = Array.from(startNodesSelect.selectedOptions)
            .map(option => option.value)
            .filter(Boolean);
        applyStartNodesSequentially(nodeIds);
    });
}
if (startNodesClearBtn) {
    startNodesClearBtn.addEventListener("click", () => {
        if (startNodesSelect) {
            startNodesSelect.selectedIndex = -1;
        }
        clearActiveTrainStartNode();
    });
}

// ============================================================================
// Scenario Serialization & Metadata
// ============================================================================

const serializeScenario = () => ({
    version: 1,
    generatedAt: new Date().toISOString(),
    trackLengthKm,
    stationNames,
    stations: customStationNodes.map(node => ({
        id: node.id,
        name: node.name,
        km: node.km,
        pathIndex: Number.isFinite(node.pathIndex) ? node.pathIndex : 0
    })),
    startNodes: startNodes.map(node => ({
        id: node.id,
        name: node.name,
        km: node.km,
        pathIndex: Number.isFinite(node.pathIndex) ? node.pathIndex : 0
    })),
    crossingState: crossingState.map(state => ({
        ratio: state.ratio,
        label: state.label,
        pathIndex: Number.isFinite(state.pathIndex) ? state.pathIndex : 0
    })),
    playbackSpeed: playbackMultiplier,
    trains: trains.map(train => ({
        name: train.name,
        departure: train.departure,
        speed: train.speed,
        distance: train.distance,
        cars: train.cars,
        carLength: train.carLength,
        manualPositionKm: train.manualPositionKm,
        startNodeId: train.startNodeId,
        pathIndex: Number.isFinite(train.pathIndex) ? train.pathIndex : 0,
        color: train.color,
        tag: train.tag
    }))
});

const applyScenario = scenario => {
    if (!scenario || typeof scenario !== "object") {
        throw new Error("Scenario payload is invalid.");
    }

    clearConflictLog();
    scenarioStartNodeFallback = Array.isArray(scenario.startNodes)
        ? scenario.startNodes.map(node => ({
            name: node?.name || "Start Node",
            km: clampDistance(Number.isFinite(node?.km) ? node.km : 0),
            pathIndex: Number.isFinite(node?.pathIndex) ? node.pathIndex : 0
        }))
        : [];

    if (Number.isFinite(Number(scenario.trackLengthKm)) && Number(scenario.trackLengthKm) > 0) {
        trackLengthKm = Number(scenario.trackLengthKm);
        trackLengthInput.value = trackLengthKm;
    }

    if (scenario.stationNames) {
        stationNames = {
            start: scenario.stationNames.start?.trim() || DEFAULT_STATIONS.start,
            end: scenario.stationNames.end?.trim() || DEFAULT_STATIONS.end
        };
    } else {
        stationNames = { ...DEFAULT_STATIONS };
    }
    stationStartInput.value = stationNames.start;
    stationEndInput.value = stationNames.end;

    customStationNodes.length = 0;
    if (Array.isArray(scenario.stations)) {
        scenario.stations.forEach((station, index) => {
            if (!station) {
                return;
            }
            const km = clampDistance(Number(station.km) || 0);
            const name =
                (station.name && String(station.name).trim()) ||
                "Station " + (index + 1);
            const id =
                station.id ||
                makeStationNodeId(name, km) + "-custom-" + index;
            customStationNodes.push({
                id,
                name,
                km,
                point: getTrackPoint(km, 0, Number.isFinite(station.pathIndex) ? station.pathIndex : 0),
                pathIndex: Number.isFinite(station.pathIndex) ? station.pathIndex : 0,
                source: "custom"
            });
        });
    }

    const importedCrossings = scenario.crossingState || scenario.crossings;
    if (Array.isArray(importedCrossings)) {
        crossingState = importedCrossings
            .map((entry, index) => {
                if (!entry) {
                    return null;
                }
                const label = entry.label || `Crossing ${index + 1}`;
                let ratio = null;
                if (Number.isFinite(Number(entry.ratio))) {
                    ratio = Math.min(Math.max(Number(entry.ratio), 0), 1);
                } else if (Number.isFinite(Number(entry.km)) && trackLengthKm > 0) {
                    ratio = clampDistance(Number(entry.km)) / trackLengthKm;
                }
                if (ratio === null) {
                    return null;
                }
                return {
                    ratio,
                    label,
                    pathIndex: Number.isFinite(entry.pathIndex) ? entry.pathIndex : 0
                };
            })
            .filter(Boolean);
        if (!crossingState.length) {
            resetCrossingsToDefault();
        } else {
            recalcCrossings();
        }
    } else {
        resetCrossingsToDefault();
    }
    renderCrossingControls();

    mergeStationNodes(collectStationNodesFromMap());
    renderStationList();
    collectStartNodes();

    if (Number.isFinite(Number(scenario.playbackSpeed))) {
        const parsedSpeed = Number(scenario.playbackSpeed);
        playbackMultiplier = Math.min(Math.max(parsedSpeed, 0.25), 4);
    } else {
        playbackMultiplier = 1;
    }
    if (playbackSpeedInput) {
        playbackSpeedInput.value = playbackMultiplier;
    }
    updatePlaybackSpeedLabel();

    if (Array.isArray(scenario.startNodes)) {
        scenario.startNodes.forEach(node => {
            const name = node.name || "Start Node";
            const km = clampDistance(Number.isFinite(node.km) ? node.km : 0);
            const id = node.id || makeStartNodeId(name, km);
            const pathIndex = Number.isFinite(node.pathIndex) ? node.pathIndex : 0;
            if (!startNodes.some(existing => existing.id === id)) {
                startNodes.push({
                    id,
                    name,
                    km,
                    point: getTrackPoint(km, 0, pathIndex),
                    pathIndex
                });
            }
        });
        startNodes.sort((a, b) => a.km - b.km);
        refreshStartNodeSelectOptions();
    }

    const scenarioTrains = Array.isArray(scenario.trains)
        ? scenario.trains.slice(0, MAX_TRAINS)
        : [];
    const count = Math.max(1, scenarioTrains.length || Number(trainCountInput.value) || 1);
    trainCountInput.value = count;
    updateTrainCountLabel(count);
    buildTrainControls(count, scenarioTrains.length ? scenarioTrains : null);

    applyTrackLengthToTrains();
    recalcTimeline();
    updateTrackLengthSummary();
    renderTrackLabels();
    buildTrack();
    render();
};

const handleScenarioSave = () => {
    try {
        const data = JSON.stringify(serializeScenario(), null, 2);
        const blob = new Blob([data], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `rail-scenario-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        setScenarioStatus("Scenario saved to your downloads.");
    } catch (error) {
        console.error(error);
        setScenarioStatus(`Failed to save scenario: ${error.message}`, true);
    }
};

const handleScenarioLoad = event => {
    const file = event.target.files?.[0];
    if (!file) {
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        try {
            const scenario = JSON.parse(reader.result);
            applyScenario(scenario);
            setScenarioStatus(`Loaded scenario: ${file.name}`);
        } catch (error) {
            console.error(error);
            setScenarioStatus(`Failed to load scenario: ${error.message}`, true);
        } finally {
            scenarioLoadInput.value = "";
        }
    };
    reader.onerror = () => {
        setScenarioStatus("Failed to read scenario file.", true);
        scenarioLoadInput.value = "";
    };
    reader.readAsText(file);
};

const serializeMetadata = () => ({
    version: 1,
    generatedAt: new Date().toISOString(),
    stationNames,
    crossingState: crossingState.map(state => ({
        ratio: state.ratio,
        label: state.label,
        pathIndex: Number.isFinite(state.pathIndex) ? state.pathIndex : 0
    }))
});

const applyMetadata = metadata => {
    if (!metadata || typeof metadata !== "object") {
        throw new Error("Metadata payload is invalid.");
    }

    if (metadata.stationNames) {
        stationNames = {
            start: metadata.stationNames.start?.trim() || DEFAULT_STATIONS.start,
            end: metadata.stationNames.end?.trim() || DEFAULT_STATIONS.end
        };
        stationStartInput.value = stationNames.start;
        stationEndInput.value = stationNames.end;
    }

    const imported = metadata.crossingState || metadata.crossings;
    if (Array.isArray(imported) && imported.length) {
        crossingState = imported
            .map((entry, index) => {
                if (!entry) {
                    return null;
                }
                const label = entry.label || `Crossing ${index + 1}`;
                let ratio = null;
                if (Number.isFinite(Number(entry.ratio))) {
                    ratio = Math.min(Math.max(Number(entry.ratio), 0), 1);
                } else if (Number.isFinite(Number(entry.km)) && trackLengthKm > 0) {
                    ratio = clampDistance(Number(entry.km)) / trackLengthKm;
                }
                if (ratio === null) {
                    return null;
                }
                return { ratio, label, pathIndex: Number.isFinite(entry.pathIndex) ? entry.pathIndex : 0 };
            })
            .filter(Boolean);
        if (!crossingState.length) {
            resetCrossingsToDefault();
        } else {
            recalcCrossings();
        }
    }

    renderCrossingControls();
    mergeStationNodes(collectStationNodesFromMap());
    renderStationList();
    collectStartNodes();
    buildTrack();
};

const handleMetadataExport = () => {
    try {
        const data = JSON.stringify(serializeMetadata(), null, 2);
        const blob = new Blob([data], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = url;
        anchor.download = `rail-map-metadata-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
        anchor.click();
        URL.revokeObjectURL(url);
        setScenarioStatus("Map metadata exported.");
    } catch (error) {
        console.error(error);
        setScenarioStatus(`Failed to export metadata: ${error.message}`, true);
    }
};

const handleMetadataImport = event => {
    const file = event.target.files?.[0];
    if (!file) {
        return;
    }

    const reader = new FileReader();
    reader.onload = () => {
        try {
            const metadata = JSON.parse(reader.result);
            applyMetadata(metadata);
            setScenarioStatus(`Imported map metadata: ${file.name}`);
        } catch (error) {
            console.error(error);
            setScenarioStatus(`Failed to import metadata: ${error.message}`, true);
        } finally {
            metadataImportInput.value = "";
        }
    };
    reader.onerror = () => {
        setScenarioStatus("Failed to read metadata file.", true);
        metadataImportInput.value = "";
    };
    reader.readAsText(file);
};

if (tabButtons.length && tabPanels.length) {
    tabButtons.forEach(button => {
        button.addEventListener("click", () => {
            const targetId = button.dataset.tabTarget;
            if (!targetId) {
                return;
            }
            tabButtons.forEach(btn => btn.classList.toggle("is-active", btn === button));
            tabPanels.forEach(panel => {
                panel.classList.toggle("is-active", panel.id === targetId);
            });
        });
    });
}

if (controlsTabButtons.length && controlsTabPanels.length) {
    controlsTabButtons.forEach(button => {
        button.addEventListener("click", () => {
            const targetId = button.dataset.tabTarget;
            if (!targetId) {
                return;
            }
            controlsTabButtons.forEach(btn => btn.classList.toggle("is-active", btn === button));
            controlsTabPanels.forEach(panel => {
                panel.classList.toggle("is-active", panel.id === targetId);
            });
        });
    });
}

// ============================================================================
// Event Wiring
// ============================================================================

scenarioSaveBtn.addEventListener("click", handleScenarioSave);
scenarioLoadBtn.addEventListener("click", () => scenarioLoadInput.click());
scenarioLoadInput.addEventListener("change", handleScenarioLoad);
metadataExportBtn.addEventListener("click", handleMetadataExport);
metadataImportBtn.addEventListener("click", () => metadataImportInput.click());
metadataImportInput.addEventListener("change", handleMetadataImport);

trackLengthInput.value = trackLengthKm;
stationStartInput.value = stationNames.start;
stationEndInput.value = stationNames.end;
recalcCrossings();
renderCrossingControls();
updateTrackLengthSummary();
renderTrackLabels();
updateTrackPath();
mergeStationNodes(collectStationNodesFromMap());
renderStationList();
collectStartNodes();
applyViewportTransform();
if (playbackSpeedInput) {
    playbackSpeedInput.value = playbackMultiplier;
}
updatePlaybackSpeedLabel();
buildTrack();
applyViewportTransform();
buildTrainControls(Number(trainCountInput.value));
render();

