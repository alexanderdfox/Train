const SAFE_DISTANCE_KM = 0.1; // 100 m
const DEFAULT_TRACK_LENGTH = 240;
const DEFAULT_CROSSINGS = [60, 120, 180, 220];
const MAX_TRAINS = 1000;
const TRACK_PADDING_X = 80;
const VIEWBOX_WIDTH = 1200;
const TRACK_VIEW_WIDTH = VIEWBOX_WIDTH - TRACK_PADDING_X * 2;
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
const trackBase = document.getElementById("track-base");
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

trainCountInput.max = MAX_TRAINS;

let stationNames = { ...DEFAULT_STATIONS };
let trackLengthKm = DEFAULT_TRACK_LENGTH;
let crossingState = DEFAULT_CROSSINGS.map((km, index) => ({
    ratio: km / DEFAULT_TRACK_LENGTH,
    label: `Crossing ${index + 1}`
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

const updateTrackPath = () => {
    trackPathElement = null;
    trackPathLength = 0;
    usingCustomTrackPath = false;

    if (!mapLayer) {
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

    let candidate = null;
    for (const selector of prioritizedSelectors) {
        candidate = mapLayer.querySelector(selector);
        if (candidate && typeof candidate.getTotalLength === "function") {
            break;
        }
        candidate = null;
    }

    if (!candidate) {
        candidate = Array.from(mapLayer.querySelectorAll("path, polyline")).find(el =>
            typeof el.getTotalLength === "function"
        ) || null;
    }

    if (candidate) {
        const length = candidate.getTotalLength?.() || 0;
        if (length > 0) {
            trackPathElement = candidate;
            trackPathLength = length;
            usingCustomTrackPath = true;
            const override =
                parseFloat(candidate.getAttribute("data-track-length-km")) ||
                parseFloat(candidate.getAttribute("data-track-length")) ||
                parseFloat(candidate.dataset?.trackLengthKm);
            if (Number.isFinite(override) && override > 0 && Math.abs(override - trackLengthKm) > 0.01) {
                trackLengthInput.value = override;
                handleTrackLengthChange();
            }
            return;
        }
    }
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

const getTrackPoint = (distanceKm, laneIndex = 0) => {
    const clampedDistance = clampDistance(distanceKm);
    const ratio = trackLengthKm > 0 ? clampedDistance / trackLengthKm : 0;
    const clampedRatio = Math.min(Math.max(ratio, 0), 1);

    if (usingCustomTrackPath && trackPathElement && trackPathLength > 0) {
        const lengthAlongPath = clampedRatio * trackPathLength;
        const rawPoint = trackPathElement.getPointAtLength(lengthAlongPath);
        const { x, y } = transformPathPoint(rawPoint, trackPathElement);
        return { x, y, ratio: clampedRatio };
    }

    const minY = 70;
    const maxY = 220;
    const laneSpacing = trains.length > 1 ? (maxY - minY) / (trains.length - 1) : 0;
    const x = TRACK_PADDING_X + clampedRatio * TRACK_VIEW_WIDTH;
    const y = minY + laneIndex * laneSpacing;
    return { x, y, ratio: clampedRatio };
};

const projectPointToTrackPath = point => {
    if (!usingCustomTrackPath || !trackPathElement || trackPathLength <= 0 || !point) {
        return null;
    }

    const samples = 256;
    let closestLength = 0;
    let minDistSq = Number.POSITIVE_INFINITY;

    for (let i = 0; i <= samples; i += 1) {
        const length = (i / samples) * trackPathLength;
        const raw = trackPathElement.getPointAtLength(length);
        const transformed = transformPathPoint(raw, trackPathElement);
        const dx = point.x - transformed.x;
        const dy = point.y - transformed.y;
        const distSq = dx * dx + dy * dy;
        if (distSq < minDistSq) {
            minDistSq = distSq;
            closestLength = length;
        }
    }

    let step = trackPathLength / samples;
    while (step > 1) {
        let improved = false;
        for (const offset of [-step, step]) {
            const candidateLength = Math.min(
                Math.max(closestLength + offset, 0),
                trackPathLength
            );
            const raw = trackPathElement.getPointAtLength(candidateLength);
            const transformed = transformPathPoint(raw, trackPathElement);
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

    const finalPoint = transformPathPoint(
        trackPathElement.getPointAtLength(closestLength),
        trackPathElement
    );
    const km = trackLengthKm > 0 ? (closestLength / trackPathLength) * trackLengthKm : 0;
    return {
        km: clampDistance(km),
        point: finalPoint
    };
};

const recalcCrossings = () => {
    crossingState = crossingState
        .map(state => {
            const km = clampDistance(state.ratio * trackLengthKm);
            const ratio = trackLengthKm > 0 ? km / trackLengthKm : 0;
            return {
                ratio,
                label: state.label || "Crossing"
            };
        })
        .sort((a, b) => a.ratio - b.ratio);

    crossings = crossingState.map(state => ({
        km: state.ratio * trackLengthKm,
        label: state.label
    }));
};

const resetCrossingsToDefault = () => {
    crossingState = DEFAULT_CROSSINGS.map((km, index) => ({
        ratio: km / DEFAULT_TRACK_LENGTH,
        label: `Crossing ${index + 1}`
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

const deriveCrossingRatiosFromSvg = svg => {
    try {
        const candidates = Array.from(svg.querySelectorAll("*")).filter(el =>
            isRedColor(el.getAttribute("stroke")) || isRedColor(el.getAttribute("fill"))
        );
        if (!candidates.length) {
            return [];
        }

        const viewBox = svg.viewBox && svg.viewBox.baseVal;
        const width = viewBox && viewBox.width
            ? viewBox.width
            : parseFloat(svg.getAttribute("width")) || svg.getBBox().width || VIEWBOX_WIDTH;
        const offsetX = viewBox ? viewBox.x : 0;

        if (!width) {
            return [];
        }

        const ratios = candidates.map(el => {
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
        }).filter(value => value != null);

        const unique = [];
        ratios.sort((a, b) => a - b).forEach(value => {
            if (!unique.some(existing => Math.abs(existing - value) < 0.01)) {
                unique.push(value);
            }
        });
        return unique;
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
        row.innerHTML = `
            <strong>Train ${train.name}</strong>
            <label>Departure<input type="time" value="${train.departure}" data-field="departure"></label>
            <label>Speed (km/h)<input type="number" min="10" max="200" value="${train.speed}" data-field="speed"></label>
            <label>Distance (km)<input type="number" min="1" value="${train.distance}" data-field="distance"></label>
            <label>Cars<input type="number" min="1" max="20" value="${train.cars}" data-field="cars"></label>
            <label>Car Length (m)<input type="number" min="5" max="40" value="${train.carLength}" data-field="carLength"></label>
            <label>Color<input type="color" value="${colorValue}" data-field="color"></label>
            <label>Tag / Icon<input type="text" maxlength="20" placeholder="optional" value="${tagValue}" data-field="tag"></label>
            <label>Manual Pos (km)<input type="number" min="0" step="0.1" placeholder="auto" value="${manualAttrValue}" data-field="manualPositionKm"></label>
        `;

        row.querySelectorAll("input").forEach(input => {
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

    if (field === "manualPositionKm") {
        if (event.target.value === "") {
            trains[index].manualPositionKm = null;
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

const deriveTrainState = train => {
    const departureMinutes = parseTimeToMinutes(train.departure);
    const distanceKm = clampDistance(Number(train.distance) || 0);
    const speed = Math.max(Number(train.speed) || 1, 1);
    const travelMinutes = (distanceKm / speed) * 60;
    return {
        ...train,
        distance: distanceKm,
        speed,
        departureMinutes,
        arrivalMinutes: departureMinutes + travelMinutes,
        lengthKm: (train.cars * train.carLength) / 1000,
        manualPositionKm: train.manualPositionKm != null ? clampDistance(train.manualPositionKm) : null,
        color: train.color,
        tag: train.tag
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
            const distance = clampDistance(train.speed * elapsedHours);

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
            const gap = Math.abs(trainA.distance - trainB.distance) - (trainA.state.lengthKm + trainB.state.lengthKm);
            const nearCrossing = crossings.some(crossing =>
                Math.abs(trainA.distance - crossing.km) < 0.01 && Math.abs(trainB.distance - crossing.km) < 0.01
            );

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
        const deficitMeters = Math.max(0, SAFE_DISTANCE * 1000 - warning.gapMeters);
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
        const { x, y } = getTrackPoint(train.distance, lane);
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

        const highlight = trackPathElement.cloneNode(true);
        highlight.removeAttribute("id");
        highlight.classList.add("track-path-highlight");
        highlight.setAttribute("fill", "none");
        highlight.setAttribute("stroke", "rgba(109, 248, 255, 0.5)");
        highlight.setAttribute("stroke-width", "8");
        highlight.setAttribute("stroke-linecap", "round");
        highlight.setAttribute("stroke-linejoin", "round");
        highlight.setAttribute("pointer-events", "none");
        trackBase.appendChild(highlight);

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
            const point = getTrackPoint(crossing.km, 0);
            const markerGroup = createSvgElement("g", {
                transform: "translate(" + point.x + ", " + point.y + ")"
            });
            const marker = createSvgElement("circle", {
                r: 8,
                fill: "rgba(255, 79, 139, 0.88)",
                stroke: "rgba(255, 79, 139, 0.35)",
                "stroke-width": "2"
            });
            const label = createSvgElement("text", {
                y: -16,
                fill: "rgba(9, 14, 28, 0.95)",
                "font-size": "11",
                "font-weight": "600",
                "text-anchor": "middle",
                "letter-spacing": "0.05em"
            });
            label.textContent = crossing.label || "Crossing " + (index + 1);
            const distanceLabel = createSvgElement("text", {
                y: 20,
                fill: "rgba(15, 23, 42, 0.72)",
                "font-size": "10",
                "text-anchor": "middle",
                "letter-spacing": "0.05em"
            });
            distanceLabel.textContent = crossing.km.toFixed(1) + " km";
            markerGroup.append(marker, label, distanceLabel);
            trackBase.appendChild(markerGroup);
            attachTooltip(markerGroup, () =>
                "<strong>" + (crossing.label || "Crossing " + (index + 1)) + "</strong><br>Distance: " +
                crossing.km.toFixed(1) +
                " km"
            );
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
        const x = TRACK_PADDING_X + (trackLengthKm > 0 ? (crossing.km / trackLengthKm) * TRACK_VIEW_WIDTH : 0);
        const line = createSvgElement("line", {
            x1: x,
            x2: x,
            y1: 100,
            y2: 200,
            stroke: "rgba(255, 255, 255, 0.22)",
            "stroke-width": "2",
            "stroke-dasharray": "6 6"
        });
        trackBase.appendChild(line);

        const label = createSvgElement("text", {
            x: x,
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
            cx: x,
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
                crossingState = derivedRatios.map((ratio, index) => ({
                    ratio,
                    label: `Crossing ${index + 1}`
                }));
                recalcCrossings();
                renderCrossingControls();
                statusMessage = `Loaded: ${file.name} • ${crossings.length} map crossings`;
            } else {
                resetCrossingsToDefault();
                statusMessage = `Loaded: ${file.name} • No red crossings detected (using defaults)`;
            }

            if (usingCustomTrackPath) {
                statusMessage += " • Track path detected for live animation.";
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

    const localPoint = getLocalPointFromClient(event.clientX, event.clientY);
    let km;
    if (usingCustomTrackPath && trackPathElement && trackPathLength > 0) {
        const projection = projectPointToTrackPath(localPoint);
        if (!projection) {
            return;
        }
        km = projection.km;
    } else {
        const normalized = (localPoint.x - TRACK_PADDING_X) / TRACK_VIEW_WIDTH;
        if (normalized < 0 || normalized > 1) {
            return;
        }
        km = clampDistance(normalized * trackLengthKm);
        if (!Number.isFinite(km)) {
            return;
        }
    }

    const train = trains[activeTrainIndex];
    if (!train) {
        return;
    }
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

const serializeScenario = () => ({
    version: 1,
    generatedAt: new Date().toISOString(),
    trackLengthKm,
    stationNames,
    crossingState: crossingState.map(state => ({ ratio: state.ratio, label: state.label })),
    playbackSpeed: playbackMultiplier,
    trains: trains.map(train => ({
        name: train.name,
        departure: train.departure,
        speed: train.speed,
        distance: train.distance,
        cars: train.cars,
        carLength: train.carLength,
        manualPositionKm: train.manualPositionKm,
        color: train.color,
        tag: train.tag
    }))
});

const applyScenario = scenario => {
    if (!scenario || typeof scenario !== "object") {
        throw new Error("Scenario payload is invalid.");
    }

    clearConflictLog();

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
                return { ratio, label };
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
        label: state.label
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
                return { ratio, label };
            })
            .filter(Boolean);
        if (!crossingState.length) {
            resetCrossingsToDefault();
        } else {
            recalcCrossings();
        }
    }

    renderCrossingControls();
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
applyViewportTransform();
if (playbackSpeedInput) {
    playbackSpeedInput.value = playbackMultiplier;
}
updatePlaybackSpeedLabel();
buildTrack();
applyViewportTransform();
buildTrainControls(Number(trainCountInput.value));
render();

