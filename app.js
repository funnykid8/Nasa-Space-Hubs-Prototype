
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const NASA_TEXTURE =
  "https://assets.science.nasa.gov/dynamicimage/assets/science/psd/lunar-science/2023/09/colormap.jpg?crop=faces%2Cfocalpoint&fit=clip&h=1200&w=3927";

const root = document.getElementById("moon");
if (!root) throw new Error("Moon viewport #moon was not found.");

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x02050a);

const camera = new THREE.PerspectiveCamera(
  42,
  Math.max(root.clientWidth, 1) / Math.max(root.clientHeight, 1),
  0.1,
  100
);
camera.position.set(0, 0, 3.2);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(root.clientWidth, root.clientHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
root.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 1.65;
controls.maxDistance = 6;
controls.enablePan = false;

const stars = new THREE.BufferGeometry();
const starPositions = [];

for (let i = 0; i < 1300; i++) {
  const radius = 20 + Math.random() * 25;
  const angle = Math.random() * Math.PI * 2;
  const z = Math.random() * 2 - 1;
  const q = Math.sqrt(1 - z * z);

  starPositions.push(
    radius * q * Math.cos(angle),
    radius * q * Math.sin(angle),
    radius * z
  );
}

stars.setAttribute(
  "position",
  new THREE.Float32BufferAttribute(starPositions, 3)
);

scene.add(
  new THREE.Points(
    stars,
    new THREE.PointsMaterial({
      color: 0x9db5c9,
      size: 0.018,
      transparent: true,
      opacity: 0.7
    })
  )
);

const moonGroup = new THREE.Group();
scene.add(moonGroup);

const loader = new THREE.TextureLoader();
loader.setCrossOrigin("anonymous");

const texture = loader.load(
  NASA_TEXTURE,
  () => setText("dataStatus", "NASA LRO MOSAIC LOADED"),
  undefined,
  () => setText("dataStatus", "LUNAR TEXTURE COULD NOT LOAD")
);

const moon = new THREE.Mesh(
  new THREE.SphereGeometry(1, 160, 160),
  new THREE.MeshStandardMaterial({
    map: texture,
    bumpMap: texture,
    bumpScale: 0.055,
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
let nasaRequestId = 0;

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function xyzToLatLon(point) {
  const lat =
    Math.asin(THREE.MathUtils.clamp(point.y, -1, 1)) * 180 / Math.PI;
  const lon = Math.atan2(point.x, point.z) * 180 / Math.PI;

  return {
    lat: clamp(lat, -90, 90),
    lon: clamp(lon, -180, 180)
  };
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

function selectFromPointer(event) {
  const rect = renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);

  const hits = raycaster.intersectObject(moon, false);
  if (!hits.length) return;

  // The raycast hit is in world coordinates. Convert it to the
  // Moon mesh's local coordinates before calculating latitude/longitude.
  const localPoint = moon.worldToLocal(hits[0].point.clone()).normalize();
  selected = xyzToLatLon(localPoint);

  updateSite();
  queryNASA();

  const cross = document.getElementById("crosshair");
  if (cross) {
    const projected = hits[0].point.clone().project(camera);
    cross.style.display = "block";
    cross.style.left = `${(projected.x * 0.5 + 0.5) * 100}%`;
    cross.style.top = `${(-projected.y * 0.5 + 0.5) * 100}%`;
  }
}

renderer.domElement.addEventListener("click", selectFromPointer);

function fallbackMetrics(lat, lon) {
  const r = Math.PI / 180;

  // These are illustrative fallback estimates, not NASA measurements.
  const elevation =
    650 + 1850 * Math.abs(Math.sin(lat * r)) +
    280 * Math.cos((lon - 20) * r);

  const slope =
    1.2 + 11 * Math.abs(Math.sin((lat * 1.7 + lon) * r));

  const temp =
    -165 +
    92 * Math.max(0, Math.cos(lat * r)) *
    ((Math.sin((lon + 90) * r) + 1) / 2) +
    18 * Math.sin(lon * r);

  const sunAlt = 42 * Math.cos(lat * r) +
    20 * Math.sin((lon - 25) * r);

  const sunAz = (180 + lon * 0.8 - lat * 0.2 + 360) % 360;
  const illum = Math.round(
    clamp(50 + 50 * Math.cos((lon - 25) * r), 0, 100)
  );

  return {
    elevation,
    slope,
    temp,
    sunAlt,
    sunAz,
    illum,
    terrain: 50,
    thermal: 50,
    solar: 50,
    score: 50,
    source: "ILLUSTRATIVE FALLBACK — NOT NASA DATA"
  };
}

function metrics() {
  const fallback = fallbackMetrics(selected.lat, selected.lon);

  if (!nasaSite) return fallback;

  const lola = nasaSite.lola || {};
  const diviner = nasaSite.diviner || {};

  const elevation = Number.isFinite(lola.elevation_m)
    ? lola.elevation_m
    : fallback.elevation;

  const slope = Number.isFinite(lola.slope_deg)
    ? lola.slope_deg
    : fallback.slope;

  const temp = Number.isFinite(diviner.brightness_temp_K)
    ? diviner.brightness_temp_K - 273.15
    : fallback.temp;

  const sunAlt = Number.isFinite(diviner.solar_incidence_deg)
    ? 90 - diviner.solar_incidence_deg
    : fallback.sunAlt;

  const sunAz = Number.isFinite(diviner.solar_azimuth_deg)
    ? diviner.solar_azimuth_deg
    : fallback.sunAz;

  const illum = Number.isFinite(diviner.solar_incidence_deg)
    ? Math.round(
        clamp(
          100 * Math.cos(
            diviner.solar_incidence_deg * Math.PI / 180
          ),
          0,
          100
        )
      )
    : fallback.illum;

  const hasLola = Number.isFinite(lola.elevation_m);
  const hasDiviner = Number.isFinite(diviner.brightness_temp_K);

  const terrain = clamp(Math.round(100 - slope * 5), 0, 100);
  const thermal = clamp(Math.round(100 - Math.abs(temp + 80) * 0.25), 0, 100);
  const solar = clamp(illum, 0, 100);
  const score = Math.round(terrain * 0.5 + thermal * 0.3 + solar * 0.2);

  return {
    elevation,
    slope,
    temp,
    sunAlt,
    sunAz,
    illum,
    terrain,
    thermal,
    solar,
    score,
    source: hasLola || hasDiviner
      ? "NASA PDS DATA + FALLBACKS WHERE NEEDED"
      : "NASA RETURNED NO USABLE VALUES — FALLBACK"
  };
}

function earth(m) {
  if (m.temp < -120) {
    return ["Antarctic interior", "Thermal/terrain candidate"];
  }
  if (m.temp < -60) {
    return ["High-altitude Andes", "Cold, dry terrain candidate"];
  }
  if (m.temp < -20) {
    return ["Atacama Desert", "Dry, high-solar terrain candidate"];
  }
  return ["Namib Desert", "Dry terrestrial terrain candidate"];
}

function updateSite() {
  const m = metrics();
  const analogue = earth(m);

  const ns = selected.lat >= 0 ? "N" : "S";
  const ew = selected.lon >= 0 ? "E" : "W";

  setText(
    "location",
    `${Math.abs(selected.lat).toFixed(2)}° ${ns}  •  ` +
    `${Math.abs(selected.lon).toFixed(2)}° ${ew}`
  );

  setText(
    "locationSub",
    nasaBusy
      ? "Querying NASA LOLA + Diviner…"
      : `Selected lunar site • ${m.source}`
  );

  setText("elev", `${Math.round(m.elevation)} m`);
  setText("slope", `${m.slope.toFixed(1)}°`);
  setText("temp", `${Math.round(m.temp)} °C`);
  setText("sunAlt", `${m.sunAlt.toFixed(1)}°`);
  setText("illum", `${m.illum}%`);
  setText("riskScore", m.score);

  const classification =
    m.score >= 80 ? "HIGH RELATIVE SCORE" :
    m.score >= 60 ? "MODERATE RELATIVE SCORE" :
    "LOW RELATIVE SCORE";

  setText("siteClass", classification);

  const ring = document.getElementById("riskRing");
  if (ring) {
    ring.style.borderColor =
      m.score >= 80 ? "var(--green)" :
      m.score >= 60 ? "var(--amber)" : "var(--red)";
  }

  setText("earthName", analogue[0]);
  setText(
    "earthDesc",
    `${analogue[1]}. This is an illustrative prototype comparison, ` +
    "not a NASA-certified Earth analogue."
  );

  const earthScore = Math.round((m.thermal + m.terrain + m.solar) / 3);
  setText("earthScore", `${earthScore}%`);

  setText("aTemp", `${Math.round(m.temp)} °C`);
  setText("aElev", `${Math.round(m.elevation)} m`);
  setText("aSlope", `${m.slope.toFixed(1)}°`);
  setText("aSunAlt", `${m.sunAlt.toFixed(1)}°`);
  setText("aSunAz", `${m.sunAz.toFixed(0)}°`);
  setText("aIllum", `${m.illum}%`);

  setText(
    "hSlope",
    m.slope <= 8 ? "FAVOURABLE" : m.slope <= 12 ? "WATCH" : "STEEP"
  );
  setText("hLight", m.illum >= 35 ? "ADEQUATE" : "LOW LIGHT");
  setText(
    "hTemp",
    m.source.includes("NASA PDS")
      ? "NASA DATA AVAILABLE"
      : "ESTIMATE — VERIFY DATA"
  );

  const bars = [
    ["bt", "btv", m.thermal],
    ["bterr", "bterrv", m.terrain],
    ["bsol", "bsolv", m.solar]
  ];

  for (const [barId, valueId, value] of bars) {
    const bar = document.getElementById(barId);
    if (bar) bar.style.width = `${clamp(value, 0, 100)}%`;
    setText(valueId, `${Math.round(value)}%`);
  }

  if (marker) {
    moonGroup.remove(marker);
    marker.geometry.dispose();
    marker.material.dispose();
  }

  marker = new THREE.Mesh(
    new THREE.SphereGeometry(0.018, 20, 20),
    new THREE.MeshBasicMaterial({ color: 0x72f5a5 })
  );
  marker.position.copy(latLonToXYZ(selected.lat, selected.lon, 1.025));
  moonGroup.add(marker);
}

async function queryNASA() {
  const requestId = ++nasaRequestId;
  const requestedSite = { ...selected };

  nasaBusy = true;
  nasaSite = null;
  updateSite();

  setText("dataStatus", "QUERYING NASA PDS…");
  setText("pdsStatus", "REQUESTING LOLA + DIVINER OBSERVATIONS");

  try {
    const url =
      `/api/site?lat=${encodeURIComponent(requestedSite.lat)}` +
      `&lon=${encodeURIComponent(requestedSite.lon)}`;

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`NASA backend returned HTTP ${response.status}`);
    }

    const data = await response.json();

    // Ignore results from an older site selection.
    if (requestId !== nasaRequestId) return;

    nasaSite = data;

    const lolaStatus = data.lola?.status || "UNKNOWN";
    const divinerStatus = data.diviner?.status || "UNKNOWN";

    setText("dataStatus", "NASA QUERY COMPLETED");
    setText(
      "pdsStatus",
      `LOLA: ${lolaStatus} • DIVINER: ${divinerStatus}`
    );
  } catch (error) {
    if (requestId !== nasaRequestId) return;

    console.error("NASA site query failed:", error);
    nasaSite = null;

    setText("dataStatus", "NASA QUERY UNAVAILABLE — FALLBACK");
    setText("pdsStatus", "NASA QUERY FAILED; ESTIMATES SHOWN INSTEAD");
  } finally {
    if (requestId === nasaRequestId) {
      nasaBusy = false;
      updateSite();
    }
  }
}

updateSite();
queryNASA();

function resize() {
  const width = Math.max(root.clientWidth, 1);
  const height = Math.max(root.clientHeight, 1);

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

window.addEventListener("resize", resize);

// Automatic Moon rotation is disabled.
// Users can still drag to orbit and scroll to zoom.
function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();

// Navigation tabs
document.querySelectorAll(".tab").forEach(button => {
  button.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach(tab => {
      tab.classList.remove("active");
    });

    document.querySelectorAll(".tabpage").forEach(page => {
      page.classList.remove("active");
    });

    button.classList.add("active");

    const target = document.getElementById(button.dataset.tab);
    if (target) target.classList.add("active");

    if (button.dataset.tab === "sim") resizeCanvas();
  });
});

document.getElementById("startSim")?.addEventListener("click", () => {
  document.querySelector('[data-tab="sim"]')?.click();
});

// Landing simulation
const canvas = document.getElementById("canvas");
const ctx = canvas?.getContext("2d");

function resizeCanvas() {
  if (!canvas || !ctx) return;

  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();

  canvas.width = Math.max(1, rect.width * ratio);
  canvas.height = Math.max(1, rect.height * ratio);
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);

  drawLander(
    Math.max(35, canvas.clientHeight * 0.35),
    12,
    Math.max(60, canvas.clientHeight - 42)
  );
}

window.addEventListener("resize", resizeCanvas);
resizeCanvas();

let running = false;

function drawLander(y, angle, terrain, status) {
  if (!canvas || !ctx) return;

  const width = canvas.clientWidth;
  const height = canvas.clientHeight;

  if (!width || !height) return;

  ctx.clearRect(0, 0, width, height);

  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, "#01040a");
  gradient.addColorStop(1, "#101923");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);

  ctx.fillStyle = "#8ea8bd";
  for (let i = 0; i < 75; i++) {
    ctx.globalAlpha = 0.15 + (i % 5) * 0.08;
    ctx.fillRect((i * 79) % width, (i * 43) % Math.max(terrain - 15, 1), 1, 1);
  }
  ctx.globalAlpha = 1;

  ctx.beginPath();
  ctx.moveTo(0, terrain);

  for (let x = 0; x <= width; x += 14) {
    ctx.lineTo(
      x,
      terrain + 10 * Math.sin(x * 0.025) + 4 * Math.sin(x * 0.073)
    );
  }

  ctx.lineTo(width, height);
  ctx.lineTo(0, height);
  ctx.closePath();
  ctx.fillStyle = "#575d63";
  ctx.fill();

  ctx.save();
  ctx.translate(width / 2, y);
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
    ctx.fillText(
      status === "success" ? "SOFT LANDING" : "LANDING FAILED",
      16,
      25
    );
  }
}

function runSim() {
  if (running || !canvas || !ctx) return;

  running = true;

  let altitude = Number(document.getElementById("alt")?.value);
  let velocity = Number(document.getElementById("vel")?.value);
  let fuel = Number(document.getElementById("fuel")?.value);
  let time = 0;

  altitude = Number.isFinite(altitude) && altitude > 0 ? altitude : 2500;
  velocity = Number.isFinite(velocity) ? velocity : -55;
  fuel = Number.isFinite(fuel) ? clamp(fuel, 0, 100) : 100;

  const approachAngle = Number(document.getElementById("angle")?.value) || 12;
  const slope = metrics().slope;
  const terrain = Math.max(60, canvas.clientHeight - 42);
  const dt = 0.05;

  setText("simresult", "Descent initiated…");

  function step() {
    const burn = Math.min(8, Math.max(0, (Math.abs(velocity) - 2) * 0.13));
    const thrust = fuel > 0 ? burn : 0;

    velocity += (1.62 - thrust) * dt;
    altitude += velocity * dt;
    fuel = Math.max(0, fuel - thrust * 0.008);
    time += dt;

    const y = terrain -
      (Math.max(0, altitude) / 2500) * (terrain - 35);

    drawLander(y, approachAngle, terrain);

    setText("clock", `00:${time.toFixed(1).padStart(4, "0")}`);
    setText("tAlt", `${Math.max(0, Math.round(altitude))} m`);
    setText("tVel", `${velocity.toFixed(1)} m/s`);
    setText("tFuel", `${Math.round(fuel)}%`);
    setText("tSlope", `${slope.toFixed(1)}°`);
    setText("status", "DESCENDING");

    if (altitude <= 0) {
      running = false;

      const success =
        Math.abs(velocity) <= 6 && slope <= 12 && fuel > 1;

      setText("status", success ? "SUCCESS" : "FAILED");
      drawLander(terrain - 16, 0, terrain, success ? "success" : "failure");

      setText(
        "simresult",
        success
          ? `Touchdown achieved in the prototype simulation. ` +
            `Final vertical speed: ${velocity.toFixed(1)} m/s; ` +
            `slope: ${slope.toFixed(1)}°.`
          : `Touchdown outside prototype limits. ` +
            `Final vertical speed: ${velocity.toFixed(1)} m/s; ` +
            `slope: ${slope.toFixed(1)}°.`
      );
      return;
    }

    if (time > 90) {
      running = false;
      setText("status", "TIMEOUT");
      setText("simresult", "Simulation timed out. Adjust the configuration and try again.");
      return;
    }

    requestAnimationFrame(step);
  }

  step();
}

document.getElementById("run")?.addEventListener("click", runSim);

// Demo mode
const demoOverlay = document.getElementById("demoOverlay");

document.getElementById("demoMode")?.addEventListener("click", () => {
  if (demoOverlay) demoOverlay.hidden = false;
});

document.getElementById("demoClose")?.addEventListener("click", () => {
  if (demoOverlay) demoOverlay.hidden = true;
});

document.getElementById("demoStart")?.addEventListener("click", () => {
  if (demoOverlay) demoOverlay.hidden = true;

  document.querySelector('[data-tab="analysis"]')?.click();

  window.setTimeout(() => {
    document.querySelector('[data-tab="sim"]')?.click();

    window.setTimeout(() => {
      document.getElementById("run")?.click();
    }, 500);
  }, 1600);
});
