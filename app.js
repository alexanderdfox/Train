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
    { name: "A", departure: "08:00", speed: 80, distance: 240, cars: 8, carLength: 20 },
    { name: "B", departure: "08:30", speed: 60, distance: 240, cars: 10, carLength: 25 },
    { name: "C", departure: "09:00", speed: 100, distance: 240, cars: 6, carLength: 18 },
    { name: "D", departure: "09:15", speed: 90, distance: 240, cars: 12, carLength: 22 },
    { name: "E", departure: "09:45", speed: 85, distance: 240, cars: 9, carLength: 21 },
    { name: "F", departure: "10:10", speed: 95, distance: 240, cars: 7, carLength: 19 },
    { name: "G", departure: "10:25", speed: 70, distance: 240, cars: 10, carLength: 20 },
    { name: "H", departure: "10:40", speed: 105, distance: 240, cars: 5, carLength: 23 },
    { name: "I", departure: "11:05", speed: 88, distance: 240, cars: 11, carLength: 21 },
    { name: "J", departure: "11:25", speed: 75, distance: 240, cars: 8, carLength: 22 }
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

const createSvgElement = (tag, attributes = {}) => {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    Object.entries(attributes).forEach(([key, value]) => {
        el.setAttribute(key, value);
    });
    return el;
};

const clampDistance = value => Math.max(0, Math.min(trackLengthKm, value));

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
        manualPositionKm: null
    };
};

const buildTrainControls = count => {
    trainControlsContainer.innerHTML = "";
    trains = [];

    for (let i = 0; i < count; i += 1) {
        const train = cloneDefaultTrain(i);
        train.distance = clampDistance(train.distance);
        trains.push(train);

        const row = document.createElement("div");
        row.className = "train-row";
        row.dataset.index = i;

        const manualValue = train.manualPositionKm != null ? train.manualPositionKm.toFixed(2) : "";
        row.innerHTML = `
            <strong>Train ${train.name}</strong>
            <label>Departure<input type="time" value="${train.departure}" data-field="departure"></label>
            <label>Speed (km/h)<input type="number" min="10" max="200" value="${train.speed}" data-field="speed"></label>
            <label>Distance (km)<input type="number" min="1" value="${train.distance}" data-field="distance"></label>
            <label>Cars<input type="number" min="1" max="20" value="${train.cars}" data-field="cars"></label>
            <label>Car Length (m)<input type="number" min="5" max="40" value="${train.carLength}" data-field="carLength"></label>
            <label>Manual Pos (km)<input type="number" min="0" step="0.1" placeholder="auto" value="${manualValue}" data-field="manualPositionKm"></label>
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

    recalcTimeline();
    render();
};

const handleTrainInput = event => {
    const row = event.target.closest(".train-row");
    const index = Number(row.dataset.index);
    setActiveTrain(index);
    const field = event.target.dataset.field;

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
        manualPositionKm: train.manualPositionKm != null ? clampDistance(train.manualPositionKm) : null
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

const render = () => {
    const minutes = Number(timeSlider.value);
    updateTimeLabels();

    trainLayer.innerHTML = "";
    const positions = calculatePositions(minutes);
    const warnings = checkWarnings(positions);
    const warningIndexes = new Set();

    warnings.forEach(w => {
        w.trains.forEach(train => warningIndexes.add(train.index));
    });

    const minY = 70;
    const maxY = 220;
    const laneSpacing = trains.length > 1 ? (maxY - minY) / (trains.length - 1) : 0;

    positions.forEach(train => {
        const lane = train.index;
        const x = TRACK_PADDING_X + (trackLengthKm > 0 ? (train.distance / trackLengthKm) * TRACK_VIEW_WIDTH : 0);
        const y = minY + lane * laneSpacing;
        const lengthPx = Math.max(24, trackLengthKm > 0 ? (train.state.lengthKm / trackLengthKm) * TRACK_VIEW_WIDTH : 24);
        const isWarning = warningIndexes.has(train.index);

        const group = createSvgElement("g", { transform: `translate(${x}, ${y})` });
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
            fill: isWarning ? "url(#warningGradient)" : "url(#trainGradient)"
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
        label.textContent = `${train.name} • ${train.state.speed} km/h${train.state.isManual ? " • manual" : ""}`;

        const nose = createSvgElement("polygon", {
            points: "0,-18 18,0 0,18",
            fill: isWarning ? "#ff4f8b" : "#6df8ff",
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
        trainLayer.appendChild(group);
    });

    renderWarnings(warnings);
};

const buildTrack = () => {
    trackBase.innerHTML = "";

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

    const startStation = createSvgElement("g", { transform: `translate(${TRACK_PADDING_X}, 150)` });
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
    startLabel.textContent = `${stationNames.start} • 0 km`;
    startStation.append(startMarker, startInner, startLabel);
    trackBase.appendChild(startStation);

    const endStation = createSvgElement("g", {
        transform: `translate(${TRACK_PADDING_X + TRACK_VIEW_WIDTH}, 150)`
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
    endLabel.textContent = `${stationNames.end} • ${trackLengthKm.toFixed(1)} km`;
    endStation.append(endMarker, endInner, endLabel);
    trackBase.appendChild(endStation);

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
        const labelText = crossing.label || `Crossing ${idx + 1}`;
        label.textContent = `${labelText} • ${crossing.km.toFixed(1)} km`;
        trackBase.appendChild(label);
    });
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

            if (!nestedSvg.getAttribute("width")) {
                nestedSvg.setAttribute("width", "1200");
            }
            if (!nestedSvg.getAttribute("height")) {
                nestedSvg.setAttribute("height", "280");
            }

            nestedSvg.setAttribute("x", nestedSvg.getAttribute("x") ?? "0");
            nestedSvg.setAttribute("y", nestedSvg.getAttribute("y") ?? "0");
            nestedSvg.setAttribute(
                "preserveAspectRatio",
                nestedSvg.getAttribute("preserveAspectRatio") || "xMidYMid meet"
            );

            mapLayer.innerHTML = "";
            mapLayer.appendChild(nestedSvg);

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

            buildTrack();
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
    buildTrack();
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
    if (!trains.length) {
        return;
    }

    const trainLayerNode = event.target.closest("#train-layer");
    if (trainLayerNode) {
        return;
    }

    const point = trackSvg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const matrix = trackSvg.getScreenCTM();
    if (!matrix) {
        return;
    }
    const svgPoint = point.matrixTransform(matrix.inverse());
    const normalized = (svgPoint.x - TRACK_PADDING_X) / TRACK_VIEW_WIDTH;
    if (normalized < 0 || normalized > 1) {
        return;
    }
    const km = clampDistance(normalized * trackLengthKm);
    if (!Number.isFinite(km)) {
        return;
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

    const advanceMinutes = (delta / 1000) * 5; // 5 minutes per second
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
    trainCountLabel.textContent = `${count} ${count === 1 ? "train" : "trains"}`;
    buildTrainControls(count);
});

timeSlider.addEventListener("input", () => {
    if (playing) {
        togglePlay();
    }
    render();
});

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

trackLengthInput.value = trackLengthKm;
stationStartInput.value = stationNames.start;
stationEndInput.value = stationNames.end;
recalcCrossings();
renderCrossingControls();
updateTrackLengthSummary();
renderTrackLabels();
buildTrack();
buildTrainControls(Number(trainCountInput.value));
render();

