
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const NASA_TEXTURE =
  "https://assets.science.nasa.gov/dynamicimage/assets/science/psd/lunar-science/2023/09/colormap.jpg?crop=faces%2Cfocalpoint&fit=clip&h=1200&w=3927";

const root = document.getElementById("moon");
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02050a);

const camera = new THREE.PerspectiveCamera(
  42, root.clientWidth / root.clientHeight, 0.1, 100
);
camera.position.set(0, 0, 3.2);

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(root.clientWidth, root.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
root.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 1.15;
controls.maxDistance = 6;
controls.enablePan = false;
controls.enableZoom = true;
controls.enableRotate = true;

const stars = new THREE.BufferGeometry();
const positions = [];

for (let i = 0; i < 1300; i++) {
  const r = 20 + Math.random() * 25;
  const a = Math.random() * Math.PI * 2;
  const z = Math.random() * 2 - 1;
  const q = Math.sqrt(1 - z * z);
  positions.push(r * q * Math.cos(a), r * q * Math.sin(a), r * z);
}

stars.setAttribute(
  "position",
  new THREE.Float32BufferAttribute(positions, 3)
);
scene.add(new THREE.Points(
  stars,
  new THREE.PointsMaterial({
    color: 0x9db5c9, size: 0.018, transparent: true, opacity: 0.7
  })
));

const moonGroup = new THREE.Group();
scene.add(moonGroup);

const loader = new THREE.TextureLoader();
loader.setCrossOrigin("anonymous");

const texture = loader.load(
  NASA_TEXTURE,
  () => setText("dataStatus", "NASA LUNAR MOSAIC LOADED"),
  undefined,
  () => setText("dataStatus", "LUNAR TEXTURE UNAVAILABLE")
);

const moon = new THREE.Mesh(
  new THREE.SphereGeometry(1, 160, 160),
  new THREE.MeshStandardMaterial({
    map: texture,
    bumpMap: texture,
    bumpScale: 0.035,
    roughness: 0.96,
    metalness: 0
  })
);
moonGroup.add(moon);

const halo = new THREE.Mesh(
  new THREE.SphereGeometry(1.025, 64, 64),
  new THREE.MeshBasicMaterial({
    color: 0x6ea9c8,
    transparent: true,
    opacity: 0.025,
    side: THREE.BackSide
  })
);
moonGroup.add(halo);

const sun = new THREE.DirectionalLight(0xffffff, 2.2);
sun.position.set(3, 1.5, 2.5);
scene.add(sun);
scene.add(new THREE.AmbientLight(0x53677c, 0.12));

let marker = null;
let selected = { lat: -5, lon: 20 };
let nasaSite = null;
let nasaBusy = false;
let requestVersion = 0;
let activeController = null;
let autoRotate = false;
let selectedSites = [];

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = String(value);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function xyzToLatLon(p) {
  const lat = Math.asin(clamp(p.y, -1, 1)) * 180 / Math.PI;
  const lon = Math.atan2(p.x, p.z) * 180 / Math.PI;
  return { lat, lon };
}

function latLonToXYZ(lat, lon, radius = 1.025) {
  const a = lat * Math.PI / 180;
  const b = lon * Math.PI / 180;

  return new THREE.Vector3(
    radius * Math.cos(a) * Math.sin(b),
    radius * Math.sin(a),
    radius * Math.cos(a) * Math.cos(b)
  );
}

function placeMarker() {
  if (marker) moonGroup.remove(marker);

  marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.018, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0x72f5a5 })
  );

  marker.position.copy(latLonToXYZ(selected.lat, selected.lon));
  moonGroup.add(marker);
}

function focusSelectedSite() {
  // Rotate the selected lunar location toward the front.
  moonGroup.rotation.y = -selected.lon * Math.PI / 180;

  camera.position.set(0, selected.lat * Math.PI / 180 * -0.9, 2.5);
  camera.lookAt(0, 0, 0);
  controls.target.set(0, 0, 0);
  controls.update();
}

function selectFromPointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();

  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);

  const hits = raycaster.intersectObject(moon, false);
  if (!hits.length) return;

  // hit.point is in world coordinates. Convert it to the
  // Moon's local coordinate system before calculating lat/lon.
  const localPoint = moon.worldToLocal(hits[0].point.clone()).normalize();
  const location = xyzToLatLon(localPoint);

  selectSite(location.lat, location.lon);

  const projected = hits[0].point.clone().project(camera);
  const cross = document.getElementById("crosshair");

  if (cross) {
    cross.style.display = "block";
    cross.style.left = `${(projected.x * 0.5 + 0.5) * 100}%`;
    cross.style.top = `${(-projected.y * 0.5 + 0.5) * 100}%`;
  }
}

// Distinguish a click from dragging the Moon.
let pointerStart = null;

renderer.domElement.addEventListener("pointerdown", event => {
  pointerStart = { x: event.clientX, y: event.clientY };
});

renderer.domElement.addEventListener("pointerup", event => {
  if (!pointerStart) return;

  const distance = Math.hypot(
    event.clientX - pointerStart.x,
    event.clientY - pointerStart.y
  );

  pointerStart = null;

  if (distance < 5) selectFromPointer(event);
});

function addNavigationControls() {
  const panel = document.createElement("section");
  panel.className = "lunar-controls";
  panel.innerHTML = `
    <h3>PRECISE SITE SELECTION</h3>
    <p>Click the Moon or enter coordinates directly.</p>
    <div class="coordinate-fields">
      <label>Latitude (°)
        <input id="lunarLat" type="number" min="-90" max="90"
          step="any" value="-5">
      </label>
      <label>Longitude (°)
        <input id="lunarLon" type="number" min="-180" max="180"
          step="any" value="20">
      </label>
    </div>
    <div class="control-buttons">
      <button id="locateSite">LOCATE SITE</button>
      <button id="focusSite">FOCUS SITE</button>
      <button id="zoomIn">+ ZOOM</button>
      <button id="zoomOut">− ZOOM</button>
      <button id="rotationToggle">START ROTATION</button>
    </div>
    <p id="selectionStatus" role="status">Ready to select a location.</p>
    <h3>NASA OBSERVATION SOURCES</h3>
    <div id="liveSources">
      <p>Select a site to request NASA observations.</p>
    </div>
    <h3>COMPARE TWO SITES</h3>
    <button id="saveCompare">SAVE CURRENT SITE</button>
    <div id="comparisonResults"></div>
  `;

  const missionPanel = document.querySelector(".mission-panel");
  const simButton = document.getElementById("startSim");

  if (missionPanel && simButton) {
    missionPanel.insertBefore(panel, simButton);
  }

  document.getElementById("locateSite").onclick = () => {
    selectSite(
      document.getElementById("lunarLat").value,
      document.getElementById("lunarLon").value
    );
    focusSelectedSite();
  };

  document.getElementById("focusSite").onclick = focusSelectedSite;

  document.getElementById("zoomIn").onclick = () => changeZoom(0.75);
  document.getElementById("zoomOut").onclick = () => changeZoom(1.25);

  document.getElementById("rotationToggle").onclick = event => {
    autoRotate = !autoRotate;
    event.currentTarget.textContent =
      autoRotate ? "PAUSE ROTATION" : "START ROTATION";
  };

  document.getElementById("saveCompare").onclick = saveComparisonSite;
}

function changeZoom(factor) {
  const nextDistance = clamp(
    camera.position.length() * factor,
    controls.minDistance,
    controls.maxDistance
  );

  camera.position.setLength(nextDistance);
  controls.update();
}

function selectSite(lat, lon) {
  lat = Number(lat);
  lon = Number(lon);

  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lon) ||
    lat < -90 || lat > 90 ||
    lon < -180 || lon > 180
  ) {
    setText("selectionStatus", "Invalid coordinates. Check the allowed ranges.");
    return;
  }

  selected = { lat, lon };
  nasaSite = null;

  setText("lunarLat", lat.toFixed(4));
  setText("lunarLon", lon.toFixed(4));
  setText("selectionStatus", "Location selected. Requesting NASA data…");

  placeMarker();
  updateSite();
  queryNASA(lat, lon);
}

function fallbackMetrics(lat, lon) {
  // These values are illustrative estimates, not NASA measurements.
  const r = Math.PI / 180;

  return {
    elevation: 650 + 1850 * Math.abs(Math.sin(lat * r)),
    slope: 1.2 + 11 * Math.abs(Math.sin((lat * 1.7 + lon) * r)),
    temp: -165 + 80 * Math.max(0, Math.cos(lat * r)),
    sunAlt: 42 * Math.cos(lat * r),
    sunAz: (180 + lon * 0.8 - lat * 0.2 + 360) % 360,
    illum: Math.round(50 + 50 * Math.cos((lon - 25) * r)),
    score: null,
    source: "ILLUSTRATIVE ESTIMATE — NOT NASA DATA"
  };
}

function metrics() {
  const f = fallbackMetrics(selected.lat, selected.lon);
  const l = nasaSite?.lola || {};
  const d = nasaSite?.diviner || {};

  const elevation = Number.isFinite(l.elevation_m)
    ? l.elevation_m : f.elevation;

  const slope = Number.isFinite(l.slope_deg)
    ? l.slope_deg : f.slope;

  const temp = Number.isFinite(d.brightness_temp_K)
    ? d.brightness_temp_K - 273.15 : f.temp;

  const sunAlt = Number.isFinite(d.solar_incidence_deg)
    ? 90 - d.solar_incidence_deg : f.sunAlt;

  const sunAz = Number.isFinite(d.solar_azimuth_deg)
    ? d.solar_azimuth_deg : f.sunAz;

  const illum = Number.isFinite(d.solar_incidence_deg)
    ? Math.round(clamp(
        100 * Math.cos(d.solar_incidence_deg * Math.PI / 180), 0, 100
      ))
    : f.illum;

  const hasElevation = Number.isFinite(l.elevation_m);
  const hasSlope = Number.isFinite(l.slope_deg);
  const hasTemp = Number.isFinite(d.brightness_temp_K);
  const hasSolar = Number.isFinite(d.solar_incidence_deg);

  // Do not present a full NASA-based score if the required
  // measurements are missing.
  const score = hasElevation && hasSlope && hasTemp && hasSolar
    ? Math.round(
        0.5 * clamp(100 - slope * 5, 0, 100) +
        0.3 * clamp(100 - Math.abs(temp + 80) * 0.25, 0, 100) +
        0.2 * illum
      )
    : null;

  const realSources = [];
  if (hasElevation) realSources.push("LOLA elevation");
  if (hasSlope) realSources.push("LOLA-derived slope");
  if (hasTemp) realSources.push("Diviner brightness temperature");
  if (hasSolar) realSources.push("Diviner solar incidence");

  return {
    elevation, slope, temp, sunAlt, sunAz, illum, score,
    source: realSources.length
      ? "NASA OBSERVATIONS + POSSIBLE ESTIMATES"
      : "ILLUSTRATIVE ESTIMATES — NASA DATA UNAVAILABLE",
    realSources
  };
}

function earth(m) {
  if (m.temp < -120) return ["Antarctic interior", "Thermal/terrain candidate"];
  if (m.temp < -60) return ["High-altitude Andes", "Cold, dry terrain candidate"];
  if (m.temp < -20) return ["Atacama Desert", "Dry, high-solar terrain candidate"];
  return ["Namib Desert", "Dry terrestrial terrain candidate"];
}

function updateSite() {
  const m = metrics();
  const e = earth(m);
  const ns = selected.lat >= 0 ? "N" : "S";
  const ew = selected.lon >= 0 ? "E" : "W";

  setText(
    "location",
    `${Math.abs(selected.lat).toFixed(3)}° ${ns} • ` +
    `${Math.abs(selected.lon).toFixed(3)}° ${ew}`
  );

  setText(
    "locationSub",
    nasaBusy ? "Querying NASA LOLA + Diviner…" : m.source
  );

  setText("elev", `${Math.round(m.elevation)} m${Number.isFinite(nasaSite?.lola?.elevation_m) ? "" : " *"}`);
  setText("slope", `${m.slope.toFixed(1)}°${Number.isFinite(nasaSite?.lola?.slope_deg) ? "" : " *"}`);
  setText("temp", `${Math.round(m.temp)} °C${Number.isFinite(nasaSite?.diviner?.brightness_temp_K) ? "" : " *"}`);
  setText("sunAlt", `${m.sunAlt.toFixed(1)}°`);
  setText("illum", `${m.illum}%`);

  setText("riskScore", m.score === null ? "—" : m.score);
  setText(
    "siteClass",
    m.score === null ? "INSUFFICIENT DATA" :
      m.score >= 80 ? "HIGH PROTOTYPE SCORE" :
      m.score >= 60 ? "MODERATE PROTOTYPE SCORE" :
      "LOW PROTOTYPE SCORE"
  );

  const ring = document.getElementById("riskRing");
  if (ring) ring.style.borderColor =
    m.score === null ? "var(--amber)" :
    m.score >= 80 ? "var(--green)" :
    m.score >= 60 ? "var(--amber)" : "var(--red)";

  setText("earthName", e[0]);
  setText(
    "earthDesc",
    `${e[1]}. Prototype analogy only, not a validated NASA Earth match.`
  );
  setText("earthScore", "N/A");

  setText("aTemp", `${Math.round(m.temp)} °C`);
  setText("aElev", `${Math.round(m.elevation)} m`);
  setText("aSlope", `${m.slope.toFixed(1)}°`);
  setText("aSunAlt", `${m.sunAlt.toFixed(1)}°`);
  setText("aSunAz", `${m.sunAz.toFixed(0)}°`);
  setText("aIllum", `${m.illum}%`);

  setText("hSlope", m.slope <= 8 ? "FAVOURABLE ESTIMATE" : m.slope <= 12 ? "WATCH" : "STEEP");
  setText("hLight", m.illum >= 35 ? "ILLUMINATION ESTIMATE ADEQUATE" : "LOW LIGHT ESTIMATE");
  setText("hTemp", Number.isFinite(nasaSite?.diviner?.brightness_temp_K)
    ? "DIVINER BRIGHTNESS TEMPERATURE" : "ESTIMATE — NOT MEASURED");

  const thermal = Number.isFinite(nasaSite?.diviner?.brightness_temp_K)
    ? clamp(Math.round(100 - Math.abs(m.temp + 80) * 0.25), 0, 100) : 0;
  const terrain = Number.isFinite(nasaSite?.lola?.slope_deg)
    ? clamp(Math.round(100 - m.slope * 5), 0, 100) : 0;
  const solar = Number.isFinite(nasaSite?.diviner?.solar_incidence_deg)
    ? clamp(Math.round(m.illum), 0, 100) : 0;

  [["bt", thermal], ["bterr", terrain], ["bsol", solar]].forEach(([id, value]) => {
    const element = document.getElementById(id);
    if (element) element.style.width = value + "%";
  });

  setText("btv", thermal + "%");
  setText("bterrv", terrain + "%");
  setText("bsolv", solar + "%");
}

function safeSourceLink(url) {
  if (typeof url !== "string") return null;

  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

function renderSources() {
  const container = document.getElementById("liveSources");
  if (!container) return;

  container.replaceChildren();

  const sources = [
    {
      title: "LOLA — Lunar topography",
      data: nasaSite?.lola,
      reference: "https://pds-geosciences.wustl.edu/missions/lro/lola.htm"
    },
    {
      title: "Diviner — Thermal and solar observations",
      data: nasaSite?.diviner,
      reference: "https://pds.nasa.gov/ds-view/pds/viewProfile.jsp?dsid=LRO-L-DLRE-5-GDR-V1.0"
    }
  ];

  for (const source of sources) {
    const card = document.createElement("div");
    card.className = "source-entry";

    const title = document.createElement("strong");
    title.textContent = source.title;
    card.appendChild(title);

    const data = source.data;
    const status = document.createElement("p");

    status.textContent = !data
      ? "No response received"
      : `${data.status || "Response received"} • ` +
        `${Number.isFinite(data.sample_count) ? data.sample_count + " samples" : "sample count unavailable"}`;

    card.appendChild(status);

    const url = safeSourceLink(data?.product_url);
    const link = document.createElement("a");
    link.href = url || source.reference;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = url ? "Open returned NASA data product" : "Open dataset documentation";
    card.appendChild(link);

    container.appendChild(card);
  }

  const docs = document.createElement("a");
  docs.href = "https://pds.nasa.gov/";
  docs.target = "_blank";
  docs.rel = "noopener noreferrer";
  docs.textContent = "NASA Planetary Data System";
  container.appendChild(docs);
}

async function queryNASA(lat, lon) {
  const version = ++requestVersion;

  if (activeController) activeController.abort();
  activeController = new AbortController();

  nasaBusy = true;
  nasaSite = null;
  updateSite();

  setText("dataStatus", "QUERYING NASA DATA…");
  setText("pdsStatus", "REQUESTING LOLA + DIVINER OBSERVATIONS");

  try {
    const response = await fetch(
      `/api/site?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`,
      { signal: activeController.signal }
    );

    if (!response.ok) {
      throw new Error(`Backend returned HTTP ${response.status}`);
    }

    const result = await response.json();

    // Ignore responses belonging to an older selection.
    if (version !== requestVersion) return;

    nasaSite = result;

    const hasData =
      result?.lola?.status === "OK" ||
      result?.diviner?.status === "OK";

    setText(
      "dataStatus",
      hasData ? "NASA OBSERVATIONS RECEIVED" : "NO NASA OBSERVATIONS FOR THIS SITE"
    );

    setText(
      "pdsStatus",
      hasData ? "NASA PRODUCT RESPONSE RECEIVED" : "DATA UNAVAILABLE — CHECK SOURCES"
    );

    setText(
      "selectionStatus",
      hasData
        ? "Response received. Review individual source status and sample counts."
        : "No usable measurements returned. Estimates are clearly marked."
    );

    renderSources();

  } catch (error) {
    if (error.name === "AbortError" || version !== requestVersion) return;

    console.error("NASA query failed:", error);
    nasaSite = null;

    setText("dataStatus", "NASA DATA UNAVAILABLE");
    setText("pdsStatus", "REQUEST FAILED — SEE DATASET DOCUMENTATION");
    setText("selectionStatus", "NASA request failed. Displayed estimates are not measurements.");

    renderSources();

  } finally {
    if (version === requestVersion) {
      nasaBusy = false;
      updateSite();
    }
  }
}

function saveComparisonSite() {
  const m = metrics();

  selectedSites.push({
    lat: selected.lat,
    lon: selected.lon,
    elevation: Number.isFinite(nasaSite?.lola?.elevation_m) ? m.elevation : null,
    slope: Number.isFinite(nasaSite?.lola?.slope_deg) ? m.slope : null,
    temp: Number.isFinite(nasaSite?.diviner?.brightness_temp_K) ? m.temp : null,
    score: m.score
  });

  if (selectedSites.length > 2) selectedSites.shift();

  const output = document.getElementById("comparisonResults");
  if (!output) return;

  output.replaceChildren();

  if (selectedSites.length < 2) {
    output.textContent = "Site A saved. Select a second site and save it.";
    return;
  }

  for (const site of selectedSites) {
    const card = document.createElement("div");
    card.className = "source-entry";

    const heading = document.createElement("strong");
    heading.textContent = `${site.lat.toFixed(3)}°, ${site.lon.toFixed(3)}°`;
    card.appendChild(heading);

    const details = document.createElement("p");
    details.textContent =
      `Elevation: ${site.elevation === null ? "N/A" : site.elevation + " m"} | ` +
      `Slope: ${site.slope === null ? "N/A" : site.slope + "°"} | ` +
      `Diviner brightness temperature: ${site.temp === null ? "N/A" : site.temp.toFixed(1) + " °C"}`;

    card.appendChild(details);
    output.appendChild(card);
  }
}

addNavigationControls();
placeMarker();
updateSite();
renderSources();
queryNASA(selected.lat, selected.lon);

function resize() {
  const w = root.clientWidth;
  const h = root.clientHeight;

  if (!w || !h) return;

  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h);
}

window.addEventListener("resize", resize);

// Automatic rotation is OFF by default.
function animate() {
  requestAnimationFrame(animate);

  if (autoRotate) {
    moonGroup.rotation.y += 0.00035;
  }

  controls.update();
  renderer.render(scene, camera);
}
animate();

document.querySelectorAll(".tab").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(item => item.classList.remove("active"));
    document.querySelectorAll(".tabpage").forEach(page => page.classList.remove("active"));

    button.classList.add("active");

    const page = document.getElementById(button.dataset.tab);
    if (page) page.classList.add("active");
  });
});

document.getElementById("startSim").addEventListener("click", () => {
  document.querySelector('[data-tab="sim"]').click();
});

const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

function resizeCanvas() {
  const d = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  canvas.width = rect.width * d;
  canvas.height = rect.height * d;
  ctx.setTransform(d, 0, 0, d, 0, 0);
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

let running = false;

function drawLander(y, angle, terrain, status) {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;

  ctx.clearRect(0, 0, w, h);

  const gradient = ctx.createLinearGradient(0, 0, 0, h);
  gradient.addColorStop(0, "#01040a");
  gradient.addColorStop(1, "#101923");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);

  ctx.fillStyle = "#8ea8bd";

  for (let i = 0; i < 75; i++) {
    ctx.globalAlpha = 0.15 + (i % 5) * 0.08;
    ctx.fillRect((i * 79) % w, (i * 43) % Math.max(1, terrain - 15), 1, 1);
  }

  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.moveTo(0, terrain);

  for (let x = 0; x <= w; x += 14) {
    ctx.lineTo(x, terrain + 10 * Math.sin(x * 0.025) + 4 * Math.sin(x * 0.073));
  }

  ctx.lineTo(w, h);
  ctx.lineTo(0, h);
  ctx.closePath();
  ctx.fillStyle = "#575d63";
  ctx.fill();

  ctx.save();
  ctx.translate(w / 2, y);
  ctx.rotate(angle * Math.PI / 180);
  ctx.fillStyle = "#d8e3ea";
  ctx.fillRect(-18, -12, 36, 23);
  ctx.fillStyle = "#9aabb8";
  ctx.fillRect(-11, -20, 22, 7);
  ctx.strokeStyle = "#d8e3ea";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(-14, 10);
  ctx.lineTo(-25, 22);
  ctx.moveTo(14, 10);
  ctx.lineTo(25, 22);
  ctx.stroke();
  ctx.restore();

  if (status) {
    ctx.font = "900 16px system-ui";
    ctx.fillStyle = status === "success" ? "#72f5a5" : "#ff6675";
    ctx.fillText(status === "success" ? "SOFT LANDING" : "LANDING FAILED", 16, 25);
  }
}

function runSim() {
  if (running) return;

  running = true;

  let alt = Number(document.getElementById("alt").value);
  let vel = Number(document.getElementById("vel").value);
  let fuel = Number(document.getElementById("fuel").value);

  if (!Number.isFinite(alt) || alt <= 0) alt = 2500;
  if (!Number.isFinite(vel)) vel = -55;
  if (!Number.isFinite(fuel)) fuel = 100;

  fuel = clamp(fuel, 0, 100);

  let t = 0;
  const slope = metrics().slope;
  const terrain = canvas.clientHeight - 42;
  const dt = 0.05;

  function step() {
    const burn = Math.min(8, Math.max(0, (Math.abs(vel) - 2) * 0.13));
    const thrust = fuel > 0 ? burn : 0;

    vel += (1.62 - thrust) * dt;
    alt += vel * dt;
    fuel = Math.max(0, fuel - thrust * 0.008);
    t += dt;

    drawLander(
      terrain - (Math.max(0, alt) / 2500) * (terrain - 35),
      Number(document.getElementById("angle").value) || 12,
      terrain
    );

    setText("clock", `00:${t.toFixed(1).padStart(4, "0")}`);
    setText("tAlt", `${Math.max(0, Math.round(alt))} m`);
    setText("tVel", `${vel.toFixed(1)} m/s`);
    setText("tFuel", `${Math.round(fuel)}%`);
    setText("tSlope", `${slope.toFixed(1)}°`);
    setText("status", "DESCENDING");

    if (alt <= 0) {
      running = false;

      const ok = Math.abs(vel) <= 6 && slope <= 12 && fuel > 1;

      setText("status", ok ? "SUCCESS — SIMULATION" : "FAILED — SIMULATION");
      drawLander(terrain - 16, 0, terrain, ok ? "success" : "failure");

      setText(
        "simresult",
        ok
          ? `Prototype touchdown result: ${vel.toFixed(1)} m/s vertical speed; slope ${slope.toFixed(1)}°.`
          : `Prototype limits not met: ${vel.toFixed(1)} m/s vertical speed; slope ${slope.toFixed(1)}°.`
      );

      return;
    }

    if (t > 90) {
      running = false;
      setText("status", "TIMEOUT");
      return;
    }

    requestAnimationFrame(step);
  }

  setText("simresult", "Educational descent simulation running…");
  step();
}

document.getElementById("run").addEventListener("click", runSim);

document.getElementById("demoMode")?.addEventListener("click", () => {
  document.getElementById("demoOverlay").hidden = false;
});

document.getElementById("demoClose")?.addEventListener("click", () => {
  document.getElementById("demoOverlay").hidden = true;
});

document.getElementById("demoStart")?.addEventListener("click", () => {
  document.getElementById("demoOverlay").hidden = true;

  document.querySelector('[data-tab="analysis"]').click();

  window.setTimeout(() => {
    document.querySelector('[data-tab="sim"]').click();
    window.setTimeout(() => document.getElementById("run").click(), 500);
  }, 1600);
});
