// ============================================================
// Bihar Pathology Tool - Application Logic
// ============================================================

const ORS_BASE = 'https://bihar-pathology-proxy.harshvardhansv5.workers.dev/api';
const ORS_DIRECTIONS_URL = `${ORS_BASE}/v2/directions/driving-car/geojson`;
const ORS_MATRIX_URL = `${ORS_BASE}/v2/matrix/driving-car`;
const TOP_HUBS_COUNT = 5;

function convertOrsGeometry(coords) { return coords.map(c => [c[1], c[0]]); }

const LEG_COLORS = [
  '#dc2626', '#16a34a', '#2563eb', '#ea580c', '#9333ea',
  '#0891b2', '#ca8a04', '#db2777', '#059669', '#7c2d12',
];
function legColor(i) { return LEG_COLORS[((i % LEG_COLORS.length) + LEG_COLORS.length) % LEG_COLORS.length]; }

// ============================================================
// THEME TOGGLE & MAP TILE SWITCHER
// ============================================================
const themeToggle = document.getElementById('themeToggle');
const currentTheme = localStorage.getItem('theme') || 'light';
document.documentElement.setAttribute('data-theme', currentTheme);
themeToggle.textContent = currentTheme === 'dark' ? '☀️ Light' : '🌙 Dark';

let map, tileLayer, markerHub, markerSpoke, routeLine, spokeMarkersLayer, plannerRouteLine, plannerMarkers = [];

function initMapTiles(theme) {
  if (tileLayer) map.removeLayer(tileLayer);
  const url = theme === 'dark' 
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}';
  
  const attribution = theme === 'dark'
    ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
    : '© Esri, HERE, Garmin, © OpenStreetMap contributors';

  tileLayer = L.tileLayer(url, { attribution, maxZoom: 19 }).addTo(map);
}

document.addEventListener('DOMContentLoaded', () => {
  try {
    map = L.map('map').setView([25.6, 85.5], 7);
    initMapTiles(currentTheme);
  } catch (error) {
    console.error("Map initialization failed:", error);
    const box = document.getElementById('errorBox');
    if (box) {
      box.style.display = 'block';
      box.textContent = 'Map failed to load. Please refresh the page (Ctrl + F5).';
    }
  }
});

themeToggle.addEventListener('click', () => {
  const newTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  localStorage.setItem('theme', newTheme);
  themeToggle.textContent = newTheme === 'dark' ? '☀️ Light' : '🌙 Dark';
  if (map) initMapTiles(newTheme);
});

// ============================================================
// MAP ICONS & LEGEND
// ============================================================
const hubIcon = L.divIcon({
  className: '',
  html: '<div style="background:#dc2626; width:36px; height:36px; border-radius:50% 50% 50% 0; transform:rotate(-45deg); border:3px solid #fff; box-shadow:0 4px 10px rgba(220,38,38,.5); display:flex; align-items:center; justify-content:center;"><span style="transform:rotate(45deg); color:#fff; font-weight:900; font-size:16px; font-family:-apple-system,sans-serif;">H</span></div>',
  iconSize: [36, 36], iconAnchor: [18, 36], popupAnchor: [0, -36],
});

function makeSpokeIcon(color, size = 28, letter = 'S') {
  const anchor = size / 2;
  const fontSize = size < 30 ? 12 : 14;
  return L.divIcon({
    className: '',
    html: `<div style="background:${color}; width:${size}px; height:${size}px; border-radius:50% 50% 50% 0; transform:rotate(-45deg); border:2.5px solid #fff; box-shadow:0 2px 6px ${color}88; display:flex; align-items:center; justify-content:center;"><span style="transform:rotate(45deg); color:#fff; font-weight:900; font-size:${fontSize}px; font-family:-apple-system,sans-serif;">${letter}</span></div>`,
    iconSize: [size, size], iconAnchor: [anchor, size], popupAnchor: [0, -size],
  });
}

const legend = L.control({ position: 'bottomleft' });
legend.onAdd = function () {
  const div = L.DomUtil.create('div', 'map-legend');
  div.innerHTML = `
    <div class="legend-item"><div style="width:16px;height:16px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#dc2626;border:2px solid #fff;"></div><b>Hub</b></div>
    <div class="legend-item"><div style="width:14px;height:14px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);background:#2563eb;border:2px solid #fff;"></div><b>Spoke</b></div>
    <div class="legend-item" style="margin-top:6px"><div class="legend-dot" style="background:#ea580c"></div>SDH</div>
    <div class="legend-item"><div class="legend-dot" style="background:#ca8a04"></div>RH</div>
    <div class="legend-item"><div class="legend-dot" style="background:#16a34a"></div>CHC</div>
    <div class="legend-item"><div class="legend-dot" style="background:#2563eb"></div>PHC</div>
    <div class="legend-item"><div class="legend-dot" style="background:#9333ea"></div>UPHC</div>
  `;
  return div;
};
legend.addTo(map);

// ============================================================
// DOM
// ============================================================
const districtSel = document.getElementById('districtSelect');
const hubSel = document.getElementById('hubSelect');
const typeFilter = document.getElementById('typeFilter');
const spokeSel = document.getElementById('spokeSelect');
const spokeCount = document.getElementById('spokeCount');
const errorBox = document.getElementById('errorBox');
const emptyMsg = document.getElementById('emptyMsg');
const detailsView = document.getElementById('detailsView');
const tableView = document.getElementById('tableView');
const routeView = document.getElementById('routeView');
const hubDistanceView = document.getElementById('hubDistanceView');
const spokeDistanceView = document.getElementById('spokeDistanceView');
const tabsWrap = document.getElementById('tabsWrap');
const verifyGoogleBtn = document.getElementById('verifyGoogleBtn');
const searchGoogleBtn = document.getElementById('searchGoogleBtn');
const globalSearch = document.getElementById('globalSearch');
const globalResults = document.getElementById('globalResults');
const districtSummary = document.getElementById('districtSummary');

let currentSpokes = [];
let selectedHub = null;
let currentSpoke = null;
let currentTableSort = { key: 'km', dir: 'asc' };

function typeColor(t) {
  return { 'DH': '#dc2626', 'SDH': '#ea580c', 'RH': '#ca8a04', 'CHC': '#16a34a', 'PHC': '#2563eb', 'UPHC': '#9333ea' }[t] || '#6b7280';
}

// ============================================================
// GLOBAL SEARCH
// ============================================================
const SPOKE_INDEX = SPOKES.map(s => {
  const hub = HUBS.find(h => h.id === s.parent);
  return { id: s.id, name: s.name, block: s.block || "", type: s.type || "", district: s.district, hub_id: s.parent, hub_name: hub ? hub.name : "" };
});

let globalMatches = [];
let activeIndex = -1;

globalSearch.addEventListener('input', () => {
  const q = globalSearch.value.trim().toLowerCase();
  if (q.length < 2) { globalResults.classList.remove('show'); return; }
  const matches = SPOKE_INDEX.filter(item =>
    item.name.toLowerCase().includes(q) || item.block.toLowerCase().includes(q) ||
    item.district.toLowerCase().includes(q) || item.hub_name.toLowerCase().includes(q)
  ).slice(0, 30);
  globalMatches = matches;
  activeIndex = -1;
  globalResults.innerHTML = '';
  if (!matches.length) {
    globalResults.innerHTML = '<div class="no-results">No matching facilities</div>';
    globalResults.classList.add('show');
    return;
  }
  matches.forEach((item, i) => {
    const div = document.createElement('div');
    div.className = 'result-item';
    div.dataset.index = i;
    div.innerHTML = `<div class="ri-name">${highlight(item.name, q)}</div>
      <div class="ri-meta"><span class="ri-type">${item.type}</span>${item.block} · ${item.district}${item.hub_name ? ` · Hub: ${item.hub_name}` : ''}</div>`;
    div.addEventListener('click', () => selectFromSearch(item));
    globalResults.appendChild(div);
  });
  globalResults.classList.add('show');
});

globalSearch.addEventListener('keydown', (e) => {
  const items = globalResults.querySelectorAll('.result-item');
  if (!items.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); activeIndex = (activeIndex + 1) % items.length; updateActive(items); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); activeIndex = (activeIndex - 1 + items.length) % items.length; updateActive(items); }
  else if (e.key === 'Enter' && activeIndex >= 0) { e.preventDefault(); selectFromSearch(globalMatches[activeIndex]); }
  else if (e.key === 'Escape') { globalResults.classList.remove('show'); }
});

function updateActive(items) {
  items.forEach((el, i) => el.classList.toggle('active', i === activeIndex));
  if (items[activeIndex]) items[activeIndex].scrollIntoView({ block: 'nearest' });
}
function highlight(text, query) {
  const idx = text.toLowerCase().indexOf(query);
  if (idx < 0) return text;
  return text.slice(0, idx) + '<mark style="background:#fef3c7">' + text.slice(idx, idx + query.length) + '</mark>' + text.slice(idx + query.length);
}
function selectFromSearch(item) {
  globalResults.classList.remove('show');
  globalSearch.value = item.name;
  districtSel.value = item.district;
  districtSel.dispatchEvent(new Event('change'));
  setTimeout(() => {
    hubSel.value = item.hub_id;
    hubSel.dispatchEvent(new Event('change'));
    setTimeout(() => {
      typeFilter.value = '';
      renderSpokes();
      setTimeout(() => {
        const opt = Array.from(spokeSel.options).find(o => o.value === item.id);
        if (opt) { spokeSel.value = item.id; spokeSel.dispatchEvent(new Event('change')); }
      }, 50);
    }, 50);
  }, 50);
}
document.addEventListener('click', (e) => {
  if (!globalSearch.contains(e.target) && !globalResults.contains(e.target)) globalResults.classList.remove('show');
});

// ============================================================
// DROPDOWNS
// ============================================================
districtSel.innerHTML = '<option value="">-- Select District --</option>';
DISTRICTS.forEach(d => districtSel.add(new Option(d, d)));

districtSel.addEventListener('change', () => {
  const district = districtSel.value;
  hubSel.innerHTML = '<option value="">-- Select Hub --</option>';
  hubSel.disabled = true;
  clearSpokes();
  clearResult();
  hideSummary();
  clearSpokeMarkers();
  if (!district) return;

  const districtHubs = HUBS.filter(h => h.district === district);
  if (!districtHubs.length) { hubSel.innerHTML = '<option value="">No hubs</option>'; return; }
  districtHubs.forEach(h => hubSel.add(new Option(h.name, h.id)));
  hubSel.disabled = false;
});

hubSel.addEventListener('change', () => {
  const hubId = hubSel.value;
  clearResult();
  clearPlannerMap();
  routeStops = [];
  if (!hubId) { clearSpokes(); clearSpokeMarkers(); return; }
  selectedHub = HUBS.find(h => h.id === hubId);
  currentSpokes = SPOKES.filter(s => s.parent === hubId);
  const types = [...new Set(currentSpokes.map(s => s.type).filter(Boolean))].sort();
  typeFilter.innerHTML = '<option value="">All types</option>';
  types.forEach(t => typeFilter.add(new Option(t, t)));
  typeFilter.disabled = false;
  renderSpokes();
  drawHubAndSpokes(selectedHub, currentSpokes);
  buildBulkTable();
  showHubSummary(selectedHub, currentSpokes);
  renderRoute();
  document.getElementById('hubDistanceList').innerHTML = '';
  document.getElementById('hubDistanceStatus').textContent = '';
});

typeFilter.addEventListener('change', () => { renderSpokes(); buildBulkTable(); renderRoute(); });

function renderSpokes() {
  const t = typeFilter.value;
  const list = currentSpokes.filter(s => !t || s.type === t);
  spokeSel.innerHTML = '';
  if (!list.length) {
    spokeSel.innerHTML = '<option value="">No matches</option>';
    spokeSel.disabled = true;
    spokeCount.textContent = '0 facilities';
    return;
  }
  list.forEach(s => {
    const label = s.block ? `${s.name}  —  ${s.block}` : s.name;
    spokeSel.add(new Option(label, s.id));
  });
  spokeSel.disabled = false;
  spokeCount.textContent = `${list.length} facilities`;
  spokeSel.selectedIndex = 0;
  const firstSpoke = SPOKES.find(s => s.id === list[0].id);
  if (firstSpoke) showResult(firstSpoke);
}

spokeSel.addEventListener('change', (e) => {
  const spoke = SPOKES.find(s => s.id === e.target.value);
  if (spoke) showResult(spoke);
});

// ============================================================
// SHOW RESULT (MODERNIZED)
// ============================================================
function showResult(spoke) {
  currentSpoke = spoke;
  emptyMsg.style.display = 'none';
  tabsWrap.style.display = 'block';
  document.getElementById('spokeTitle').textContent = spoke.name;

  const spokeDists = DISTANCES[spoke.id] || {};
  const assigned = spokeDists[spoke.parent];
  
  const distCard = document.getElementById('distCard');
  if (distCard) {
    if (assigned) {
      distCard.innerHTML = `<div class="label">Driving Distance</div><div class="value">${assigned.km}<span class="unit">km</span></div>`;
    } else {
      distCard.innerHTML = `<div class="label">Driving Distance</div><div class="value">—</div>`;
    }
  } else {
    document.getElementById('distVal').textContent = assigned ? assigned.km : '—';
  }

  const all = Object.entries(spokeDists)
    .map(([hubId, d]) => ({ hubId, ...d, hub: HUBS.find(h => h.id === hubId) }))
    .filter(x => x.hub).sort((a, b) => a.km - b.km);

  const nearbyList = document.getElementById('nearbyList');
  nearbyList.innerHTML = '';
  
  const displayHubs = all.slice(0, 6);
  const maxKm = Math.max(...displayHubs.map(h => h.km), 1);

  displayHubs.forEach(item => {
    const isAssigned = item.hubId === spoke.parent;
    const barWidth = (item.km / maxKm) * 100;
    
    const div = document.createElement('div');
    div.className = 'hub-item-modern' + (isAssigned ? ' assigned' : '');
    div.innerHTML = `
      <div class="hub-header">
        <div class="hub-name-modern">
          ${isAssigned ? '<span class="assigned-badge">Assigned</span>' : ''}
          ${item.hub.name}
        </div>
        <div class="hub-distance-badge">${item.km} km</div>
      </div>
      <div class="hub-bar-bg">
        <div class="hub-bar-fill" style="width: ${barWidth}%;"></div>
      </div>
    `;
    div.addEventListener('click', () => drawRoute(spoke, item.hub));
    nearbyList.appendChild(div);
  });
  
  highlightTableRow(spoke.id);
  const assignedHub = HUBS.find(h => h.id === spoke.parent);
  if (assignedHub) drawRoute(spoke, assignedHub);
} // <-- THIS IS THE CLOSING BRACE THAT WAS LIKELY MISSING OR DUPLICATED

// ============================================================
// MAP DRAW
// ============================================================
function clearSpokeMarkers() {
  if (spokeMarkersLayer) { map.removeLayer(spokeMarkersLayer); spokeMarkersLayer = null; }
  if (markerHub) { map.removeLayer(markerHub); markerHub = null; }
  if (markerSpoke) { map.removeLayer(markerSpoke); markerSpoke = null; }
  if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
}

function clearPlannerMap() {
  if (plannerRouteLine) { map.removeLayer(plannerRouteLine); plannerRouteLine = null; }
  plannerMarkers.forEach(m => map.removeLayer(m));
  plannerMarkers = [];
}

function drawHubAndSpokes(hub, spokes) {
  clearSpokeMarkers();
  clearPlannerMap();

  spokeMarkersLayer = L.layerGroup().addTo(map);
  spokes.forEach(s => {
    const color = typeColor(s.type);
    const icon = makeSpokeIcon(color, 28, 'S');
    L.marker([s.lat, s.lng], { icon: icon })
      .addTo(spokeMarkersLayer)
      .bindPopup(`<b>${s.name}</b><br>${s.type} · ${s.block || ''}`);
  });

  markerHub = L.marker([hub.lat, hub.lng], { icon: hubIcon, zIndexOffset: 1000 })
    .addTo(map)
    .bindPopup(`<b>${hub.name}</b><br><span style="color:#dc2626;font-weight:600">Hub</span>`);

  if (spokes.length) {
    const bounds = L.latLngBounds([[hub.lat, hub.lng], ...spokes.map(s => [s.lat, s.lng])]);
    map.fitBounds(bounds, { padding: [50, 50] });
  }
}

function drawRoute(spoke, hub) {
  if (markerSpoke) map.removeLayer(markerSpoke);
  if (routeLine) map.removeLayer(routeLine);

  const selectedIcon = makeSpokeIcon('#1d4ed8', 36, 'S');
  markerSpoke = L.marker([spoke.lat, spoke.lng], { icon: selectedIcon, zIndexOffset: 800 })
    .addTo(map)
    .bindPopup(`<b>${spoke.name}</b><br><span style="color:#1d4ed8;font-weight:600">Spoke</span>`);

  routeLine = L.polyline(
    [[hub.lat, hub.lng], [spoke.lat, spoke.lng]],
    { color: '#0284c7', weight: 4, opacity: 0.8, dashArray: '8,8' }
  ).addTo(map);
}

// ============================================================
// TABLE
// ============================================================
function buildBulkTable() {
  const t = typeFilter.value;
  const list = currentSpokes.filter(s => !t || s.type === t);
  const body = document.getElementById('bulkTableBody');
  document.getElementById('tableTitle').textContent = `${list.length} spokes of ${selectedHub ? selectedHub.name : ''}`;

  const rows = list.map(s => {
    const d = (DISTANCES[s.id] || {})[s.parent] || {};
    return { ...s, km: d.km || 0 };
  });

  const { key, dir } = currentTableSort;
  rows.sort((a, b) => {
    let va = a[key], vb = b[key];
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });

  document.querySelectorAll('.bulk-table th').forEach(th => {
    const arrow = th.querySelector('.sort-arrow');
    if (th.dataset.sort === key) { th.classList.add('sorted'); arrow.textContent = dir === 'asc' ? '↑' : '↓'; }
    else { th.classList.remove('sorted'); arrow.textContent = '↕'; }
  });

  body.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.dataset.spokeId = r.id;
    if (currentSpoke && currentSpoke.id === r.id) tr.classList.add('selected');
    tr.innerHTML = `<td>${r.name}</td><td><span class="badge badge-${r.type}">${r.type}</span></td><td>${r.block || ''}</td><td class="dist-cell">${r.km} km</td>`;
    tr.addEventListener('click', () => { const spoke = SPOKES.find(s => s.id === r.id); if (spoke) showResult(spoke); });
    body.appendChild(tr);
  });
}

document.querySelectorAll('.bulk-table th').forEach(th => {
  th.addEventListener('click', () => {
    const key = th.dataset.sort;
    if (currentTableSort.key === key) currentTableSort.dir = currentTableSort.dir === 'asc' ? 'desc' : 'asc';
    else { currentTableSort.key = key; currentTableSort.dir = 'asc'; }
    buildBulkTable();
  });
});

function highlightTableRow(spokeId) {
  document.querySelectorAll('.bulk-table tbody tr').forEach(tr => tr.classList.toggle('selected', tr.dataset.spokeId === spokeId));
}

// ============================================================
// TABS
// ============================================================
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => switchTab(tab.dataset.tab)));
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  detailsView.style.display = name === 'details' ? 'block' : 'none';
  tableView.style.display = name === 'table' ? 'block' : 'none';
  routeView.style.display = name === 'route' ? 'block' : 'none';
  hubDistanceView.style.display = name === 'hubs' ? 'block' : 'none';
  spokeDistanceView.style.display = name === 'spoke' ? 'block' : 'none';
  if (name === 'route') { renderRoute(); if (routeStops.length > 0) calculateRoute(); }
  if (name === 'hubs') { renderHubDistances(); }
  if (name === 'spoke') { renderSpokeDistances(); }
}

// ============================================================
// HUB SUMMARY
// ============================================================
function hideSummary() { districtSummary.classList.remove('show'); }

function showHubSummary(hub, spokes) {
  const dists = spokes.map(s => (DISTANCES[s.id] || {})[hub.id] || { km: 0 });
  const avgKm = (dists.reduce((a, d) => a + d.km, 0) / dists.length).toFixed(1);
  const minIdx = dists.map(d => d.km).indexOf(Math.min(...dists.map(d => d.km)));
  const maxIdx = dists.map(d => d.km).indexOf(Math.max(...dists.map(d => d.km)));

  document.getElementById('dsTitle').textContent = `📊 ${hub.name}`;
  document.getElementById('dsStats').innerHTML = `
    <div><div class="ds-stat-label">Spokes</div><div class="ds-stat-value">${spokes.length}</div></div>
    <div><div class="ds-stat-label">Avg Distance</div><div class="ds-stat-value">${avgKm} km</div></div>
  `;
  document.getElementById('dsExtra').innerHTML =
    `<b>Closest:</b> ${spokes[minIdx].name} (${dists[minIdx].km} km) &nbsp;·&nbsp; <b>Farthest:</b> ${spokes[maxIdx].name} (${dists[maxIdx].km} km)`;
  districtSummary.classList.add('show');
}

// ============================================================
// VERIFY / SEARCH BUTTONS
// ============================================================
verifyGoogleBtn.addEventListener('click', () => {
  if (!currentSpoke) return;
  const hub = HUBS.find(h => h.id === currentSpoke.parent);
  if (!hub) return;
  window.open(`https://www.google.com/maps/dir/?api=1&origin=${hub.lat},${hub.lng}&destination=${currentSpoke.lat},${currentSpoke.lng}&travelmode=driving`, '_blank');
});

searchGoogleBtn.addEventListener('click', () => {
  if (!currentSpoke) return;
  const query = encodeURIComponent(`${currentSpoke.name} ${currentSpoke.block || ''} ${currentSpoke.district} Bihar`);
  window.open(`https://www.google.com/maps/search/?api=1&query=${query}`, '_blank');
});

// ============================================================
// TOP 5 HUB LABS
// ============================================================
async function renderHubDistances() {
  const listEl = document.getElementById('hubDistanceList');
  const statusEl = document.getElementById('hubDistanceStatus');
  const infoEl = document.getElementById('hubDistanceInfo');

  if (!selectedHub) { statusEl.textContent = 'Select a hub first.'; listEl.innerHTML = ''; infoEl.textContent = ''; return; }
  infoEl.textContent = `From: ${selectedHub.name} (${selectedHub.district})`;

  const cacheKey = `hub_matrix_${selectedHub.id}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) { try { renderHubDistanceRows(JSON.parse(cached)); return; } catch (e) {} }

  statusEl.textContent = 'Calculating distances to all hubs…';
  listEl.innerHTML = '';
  const selectedIdx = HUBS.findIndex(h => h.id === selectedHub.id);
  const destinations = HUBS.map((_, i) => i).filter(i => i !== selectedIdx);

  try {
    const r = await fetch(ORS_MATRIX_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locations: HUBS.map(h => [h.lng, h.lat]), sources: [selectedIdx], destinations: destinations, metrics: ['distance'], units: 'km' }),
    });
    if (!r.ok) throw new Error('ORS matrix HTTP ' + r.status);
    const data = await r.json();
    const distances = data.distances[0];
    const rows = destinations.map((destIdx, i) => ({ hub: HUBS[destIdx], km: distances[i] })).filter(r => r.km !== null).sort((a, b) => a.km - b.km);
    localStorage.setItem(cacheKey, JSON.stringify(rows));
    renderHubDistanceRows(rows);
  } catch (e) {
    console.warn('ORS failed, OSRM fallback:', e);
    statusEl.textContent = 'ORS unavailable — trying OSRM…';
    try {
      const coords = HUBS.map(h => `${h.lng},${h.lat}`).join(';');
      const url = `https://router.project-osrm.org/table/v1/driving/${coords}?sources=${selectedIdx}&annotations=distance`;
      const r = await fetch(url);
      if (!r.ok) throw new Error('OSRM table HTTP ' + r.status);
      const data = await r.json();
      if (data.code !== 'Ok') throw new Error('OSRM code: ' + data.code);
      const dists = data.distances[0];
      const rows = HUBS.map((h, i) => ({ hub: h, km: dists[i] / 1000 })).filter(r => r.hub.id !== selectedHub.id && !isNaN(r.km)).sort((a, b) => a.km - b.km);
      localStorage.setItem(cacheKey, JSON.stringify(rows));
      renderHubDistanceRows(rows);
    } catch (err2) {
      console.warn('OSRM failed:', err2);
      statusEl.textContent = 'Could not fetch hub distances. Check internet.';
    }
  }
}

function renderHubDistanceRows(allRows) {
  const statusEl = document.getElementById('hubDistanceStatus');
  const listEl = document.getElementById('hubDistanceList');
  statusEl.textContent = '';
  if (!allRows || !allRows.length) { listEl.innerHTML = '<div style="text-align:center;color:var(--text-sub);padding:14px;">No data available.</div>'; return; }
  const rows = allRows.slice(0, TOP_HUBS_COUNT);
  const maxKm = Math.max(...rows.map(r => r.km));

  listEl.innerHTML = rows.map((r, i) => {
    let rankClass = i === 0 ? 'top1' : (i < 3 ? 'top3' : 'top5');
    const barWidth = Math.max(6, (r.km / maxKm) * 100);
    return `<div class="hd-row" data-hub-id="${r.hub.id}" data-hub-lat="${r.hub.lat}" data-hub-lng="${r.hub.lng}">
      <div style="display:flex; align-items:center; gap:14px;">
        <span class="hd-rank ${rankClass}">${i + 1}</span>
        <div style="flex:1; min-width:0;">
          <div style="font-weight:700; color:var(--text-main); font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${r.hub.name}</div>
          <div style="font-size:12px; color:var(--text-sub); margin-top:2px;">${r.hub.district}</div>
          <div class="hd-bar"><div class="hd-bar-fill" style="width:${barWidth}%;"></div></div>
        </div>
        <div style="text-align:right; flex-shrink:0;">
          <div style="font-weight:800; color:var(--text-main); font-size:16px;">${r.km.toFixed(1)} km</div>
          <button class="hd-verify-btn" type="button" data-lat="${r.hub.lat}" data-lng="${r.hub.lng}">🔍 Verify</button>
        </div>
      </div>
    </div>`;
  }).join('');

  listEl.querySelectorAll('.hd-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.classList.contains('hd-verify-btn')) return;
      const hub = HUBS.find(h => h.id === row.dataset.hubId);
      if (!hub) return;
      districtSel.value = hub.district;
      districtSel.dispatchEvent(new Event('change'));
      setTimeout(() => { hubSel.value = hub.id; hubSel.dispatchEvent(new Event('change')); }, 80);
    });
  });

  listEl.querySelectorAll('.hd-verify-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (!selectedHub) return;
      window.open(`https://www.google.com/maps/dir/?api=1&origin=${selectedHub.lat},${selectedHub.lng}&destination=${btn.dataset.lat},${btn.dataset.lng}&travelmode=driving`, '_blank');
    });
  });
}

// ============================================================
// SPOKE-TO-SPOKE DISTANCE
// ============================================================
function renderSpokeDistances() {
  const fromSel = document.getElementById('spokeFromSelect');
  const toSel = document.getElementById('spokeToSelect');
  const infoEl = document.getElementById('spokeDistInfo');
  const district = districtSel.value;
  if (!district) { infoEl.textContent = 'Select a district first.'; fromSel.innerHTML = '<option value="">—</option>'; toSel.innerHTML = '<option value="">—</option>'; return; }

  const districtSpokes = SPOKES.filter(s => s.district === district).sort((a, b) => a.name.localeCompare(b.name));
  infoEl.textContent = `${districtSpokes.length} spokes in ${district} district`;

  const fromVal = fromSel.value, toVal = toSel.value;
  fromSel.innerHTML = '<option value="">— Select From —</option>';
  toSel.innerHTML = '<option value="">— Select To —</option>';
  districtSpokes.forEach(s => {
    fromSel.add(new Option(`${s.name} (${s.type})`, s.id));
    toSel.add(new Option(`${s.name} (${s.type})`, s.id));
  });

  if (fromVal && districtSpokes.find(s => s.id === fromVal)) fromSel.value = fromVal;
  else if (currentSpoke && currentSpoke.district === district) {
    const opt = fromSel.querySelector(`option[value="${currentSpoke.id}"]`);
    if (opt) fromSel.value = currentSpoke.id;
  }
  if (toVal && districtSpokes.find(s => s.id === toVal)) toSel.value = toVal;
}

document.getElementById('spokeCalcBtn').addEventListener('click', async () => {
  const fromId = document.getElementById('spokeFromSelect').value;
  const toId = document.getElementById('spokeToSelect').value;
  const resultEl = document.getElementById('spokeDistResult');

  if (!fromId || !toId) { resultEl.innerHTML = '<div style="color:#c53030; font-size:14px;">Please select both From and To.</div>'; return; }
  if (fromId === toId) { resultEl.innerHTML = '<div style="color:#c53030; font-size:14px;">From and To must be different.</div>'; return; }

  const fromSpoke = SPOKES.find(s => s.id === fromId);
  const toSpoke = SPOKES.find(s => s.id === toId);
  if (!fromSpoke || !toSpoke) return;

  const cacheKey = `spoke_dist_${fromId}_${toId}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) { try { applySpokeDistance(JSON.parse(cached), fromSpoke, toSpoke); return; } catch (e) {} }

  resultEl.innerHTML = '<div style="color:var(--accent-purple); padding:16px; font-size:14px; text-align:center;">Calculating…</div>';

  try {
    const r = await fetch(ORS_DIRECTIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: [[fromSpoke.lng, fromSpoke.lat], [toSpoke.lng, toSpoke.lat]], units: 'km', language: 'en' }),
    });
    if (!r.ok) throw new Error('ORS HTTP ' + r.status);
    const data = await r.json();
    const feature = data.features[0];
    const result = { km: feature.properties.summary.distance.toFixed(1), geometry: feature.geometry.coordinates, source: 'ors' };
    localStorage.setItem(cacheKey, JSON.stringify(result));
    applySpokeDistance(result, fromSpoke, toSpoke);
  } catch (e) {
    console.warn('ORS failed, Haversine fallback:', e);
    const d = haversineLocal(fromSpoke.lat, fromSpoke.lng, toSpoke.lat, toSpoke.lng) * 1.3;
    applySpokeDistance({ km: d.toFixed(1), geometry: [[fromSpoke.lng, fromSpoke.lat], [toSpoke.lng, toSpoke.lat]], source: 'approximate' }, fromSpoke, toSpoke);
  }
});

function applySpokeDistance(result, fromSpoke, toSpoke) {
  const resultEl = document.getElementById('spokeDistResult');
  const sourceLabel = result.source === 'ors'
    ? '<div style="color:#16a34a; font-size:12px; margin-top:8px; font-weight:600;">✓ Powered by OpenRouteService</div>'
    : '<div style="color:#c05621; font-size:12px; margin-top:8px; font-weight:600;">⚠️ Approximate (offline mode)</div>';
  const gmapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${fromSpoke.lat},${fromSpoke.lng}&destination=${toSpoke.lat},${toSpoke.lng}&travelmode=driving`;

  resultEl.innerHTML = `
    <div class="route-totals" style="border-left-color: var(--accent-blue);">
      <div style="font-size:12px; font-weight:700; text-transform:uppercase; color:var(--text-sub); margin-bottom:12px; letter-spacing:0.5px;">Route Estimate</div>
      <div style="font-weight:700; color:var(--text-main); font-size:15px;">${fromSpoke.name}</div>
      <div style="font-size:14px; color:var(--text-sub); margin:6px 0;">↓</div>
      <div style="font-weight:700; color:var(--text-main); font-size:15px; margin-bottom:16px;">${toSpoke.name}</div>
      <div class="route-totals-grid">
        <div>
          <div class="route-totals-label">Distance</div>
          <div class="route-totals-value" style="font-size:32px;">${result.km} <span style="font-size:16px; font-weight:500; color:var(--text-sub);">km</span></div>
        </div>
      </div>
      <div class="disclaimer">Estimate based on OpenRouteService. May vary from Google Maps.</div>
      ${sourceLabel}
      <div class="btn-row" style="margin-top:16px;">
        <button class="btn btn-google" type="button" onclick="window.open('${gmapsUrl}', '_blank')">🔍 Verify on Google Maps</button>
      </div>
    </div>
  `;
  drawSpokeToSpokeRoute(result.geometry, fromSpoke, toSpoke);
}

function drawSpokeToSpokeRoute(geojsonCoords, fromSpoke, toSpoke) {
  clearPlannerMap();
  const path = convertOrsGeometry(geojsonCoords);
  const line = L.polyline(path, { color: '#7c3aed', weight: 6, opacity: 0.9, lineJoin: 'round' }).addTo(map);
  const m1 = L.marker([fromSpoke.lat, fromSpoke.lng], { icon: makeSpokeIcon('#2563eb', 34, 'F'), zIndexOffset: 1000 }).addTo(map).bindPopup(`<b>From:</b> ${fromSpoke.name}`);
  const m2 = L.marker([toSpoke.lat, toSpoke.lng], { icon: makeSpokeIcon('#dc2626', 34, 'T'), zIndexOffset: 1000 }).addTo(map).bindPopup(`<b>To:</b> ${toSpoke.name}`);
  plannerMarkers.push(line, m1, m2);
  if (path.length) map.fitBounds(L.latLngBounds(path), { padding: [50, 50] });
}

// ============================================================
// ROUTE PLANNER
// ============================================================
let routeStops = [];

function renderRoute() {
  const startEl = document.getElementById('routeStart');
  const listEl = document.getElementById('routeStopsList');
  const addSel = document.getElementById('routeAddSelect');
  const optimizeBtn = document.getElementById('routeOptimizeBtn');
  const saveBtn = document.getElementById('routeSaveBtn');

  if (!selectedHub) {
    startEl.textContent = '— Select a hub first —';
    listEl.innerHTML = ''; addSel.disabled = true; optimizeBtn.disabled = true; saveBtn.disabled = true;
    document.getElementById('presetRoutesWrap').innerHTML = '';
    document.getElementById('savedRoutesWrap').innerHTML = '';
    return;
  }

  startEl.textContent = selectedHub.name;
  addSel.disabled = false;
  optimizeBtn.disabled = routeStops.length < 3;
  saveBtn.disabled = routeStops.length === 0;

  const presetWrap = document.getElementById('presetRoutesWrap');
  const presets = PRESET_ROUTES.filter(p => p.hubId === selectedHub.id);
  if (presets.length) {
    presetWrap.innerHTML = '<div style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-sub); margin-bottom:8px;">⭐ Quick Start</div>' +
      presets.map((p, i) => `<span class="preset-chip" data-preset-idx="${i}">${p.name}</span>`).join('');
    presetWrap.querySelectorAll('.preset-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const p = presets[parseInt(chip.dataset.presetIdx)];
        routeStops = p.stops.slice();
        renderRoute(); calculateRoute();
      });
    });
  } else { presetWrap.innerHTML = ''; }

  const savedWrap = document.getElementById('savedRoutesWrap');
  const allSaved = JSON.parse(localStorage.getItem('savedRoutes') || '{}');
  const mine = Object.entries(allSaved).filter(([k, v]) => v.hubId === selectedHub.id);
  if (mine.length) {
    savedWrap.innerHTML = '<div style="font-size:11px; font-weight:700; text-transform:uppercase; color:var(--text-sub); margin-bottom:8px;">💾 Saved Routes</div>' +
      mine.map(([k, v]) => `<button class="saved-chip" data-key="${k}">${v.name} <span style="color:var(--text-sub); font-size:12px;">(${v.stops.length} stops)</span></button>`).join('');
    savedWrap.querySelectorAll('.saved-chip').forEach(b => b.addEventListener('click', () => loadRoute(b.dataset.key)));
  } else { savedWrap.innerHTML = ''; }

  addSel.innerHTML = '<option value="">— Select a spoke —</option>';
  const t = typeFilter.value;
  currentSpokes.filter(s => !t || s.type === t).filter(s => !routeStops.includes(s.id)).forEach(s => addSel.add(new Option(`${s.name} (${s.type})`, s.id)));

  listEl.innerHTML = '';
  if (routeStops.length === 0) {
    listEl.innerHTML = '<div style="text-align:center;color:var(--text-sub);font-size:13px;padding:20px;background:var(--panel-bg);border-radius:12px;border:1px dashed var(--border-color);">No stops yet. Add spokes below.</div>';
  } else {
    routeStops.forEach((sid, i) => {
      const s = SPOKES.find(x => x.id === sid);
      if (!s) return;
      const row = document.createElement('div');
      row.className = 'route-stop-row';
      row.innerHTML = `
        <div style="display:flex; align-items:center; min-width:0; flex:1;">
          <span class="route-num-badge" style="background:${legColor(i)};">${i+1}</span>
          <div style="min-width:0;">
            <div style="font-weight:600; color:var(--text-main); font-size:14px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${s.name}</div>
            <div style="font-size:11px; color:var(--text-sub);">${s.type} · ${s.block || ''}</div>
          </div>
        </div>
        <div class="route-btns">
          <button data-action="up" data-idx="${i}">↑</button>
          <button data-action="down" data-idx="${i}">↓</button>
          <button class="remove" data-action="remove" data-idx="${i}">✕</button>
        </div>`;
      listEl.appendChild(row);
    });
  }

  document.querySelectorAll('.route-btns button').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx);
      const act = btn.dataset.action;
      if (act === 'up' && idx > 0) [routeStops[idx-1], routeStops[idx]] = [routeStops[idx], routeStops[idx-1]];
      else if (act === 'down' && idx < routeStops.length - 1) [routeStops[idx+1], routeStops[idx]] = [routeStops[idx], routeStops[idx+1]];
      else if (act === 'remove') routeStops.splice(idx, 1);
      renderRoute(); calculateRoute();
    });
  });
}

document.getElementById('routeAddSelect').addEventListener('change', (e) => {
  const sid = e.target.value;
  if (!sid || routeStops.includes(sid)) return;
  routeStops.push(sid); e.target.value = '';
  renderRoute(); calculateRoute();
});

document.getElementById('routeClearBtn').addEventListener('click', () => { routeStops = []; renderRoute(); calculateRoute(); });

// ============================================================
// ROUTE CALCULATION
// ============================================================
async function calculateRoute() {
  const kmEl = document.getElementById('routeTotalKm');
  const breakdown = document.getElementById('routeLegsBreakdown');

  if (!selectedHub || routeStops.length === 0) { kmEl.textContent = '0 km'; breakdown.innerHTML = ''; clearPlannerMap(); return; }

  const points = [selectedHub, ...routeStops.map(id => SPOKES.find(s => s.id === id)), selectedHub];
  const cacheKey = `route_cache_ors_${[selectedHub.id, ...routeStops].join('_')}`;
  const cached = localStorage.getItem(cacheKey);
  if (cached) { try { applyRouteResult(JSON.parse(cached), points); return; } catch (e) {} }

  kmEl.textContent = '…';
  breakdown.innerHTML = '<div style="color:var(--accent-purple); text-align:center; padding:12px;">Calculating route via OpenRouteService…</div>';

  try {
    const r = await fetch(ORS_DIRECTIONS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ coordinates: points.map(p => [p.lng, p.lat]), units: 'km', language: 'en' }),
    });
    if (!r.ok) throw new Error('ORS HTTP ' + r.status);
    const data = await r.json();
    const feature = data.features[0];
    const result = {
      totalKm: feature.properties.summary.distance.toFixed(1),
      legs: feature.properties.segments.map(s => ({ km: s.distance.toFixed(1) })),
      geometry: feature.geometry.coordinates,
      way_points: feature.properties.way_points,
      source: 'ors',
    };
    localStorage.setItem(cacheKey, JSON.stringify(result));
    applyRouteResult(result, points);
    return;
  } catch (e) { console.warn('ORS failed, OSRM fallback:', e); }

  try {
    const coords = points.map(p => `${p.lng},${p.lat}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson&annotations=false`;
    const r = await fetch(url);
    if (r.ok) {
      const data = await r.json();
      if (data.code === 'Ok' && data.routes && data.routes[0]) {
        const route = data.routes[0];
        const geometry = route.geometry.coordinates;
        const wayPoints = points.map(p => findNearestIndex(geometry, p));
        const result = {
          totalKm: (route.distance / 1000).toFixed(1),
          legs: route.legs.map(l => ({ km: (l.distance / 1000).toFixed(1) })),
          geometry: geometry, way_points: wayPoints, source: 'osrm-fallback',
        };
        localStorage.setItem(cacheKey, JSON.stringify(result));
        applyRouteResult(result, points);
        return;
      }
    }
  } catch (e) { console.warn('OSRM failed, Haversine fallback', e); }

  let totalKm = 0; const legs = [];
  for (let i = 0; i < points.length - 1; i++) {
    const d = haversineLocal(points[i].lat, points[i].lng, points[i+1].lat, points[i+1].lng) * 1.3;
    totalKm += d; legs.push({ km: d.toFixed(1) });
  }
  applyRouteResult({ totalKm: totalKm.toFixed(1), legs, geometry: points.map(p => [p.lng, p.lat]), way_points: points.map((_, i) => i), approximate: true }, points);
}

function applyRouteResult(result, points) {
  const kmEl = document.getElementById('routeTotalKm');
  const breakdown = document.getElementById('routeLegsBreakdown');
  kmEl.textContent = `${result.totalKm} km`;

  let sourceLabel = '';
  if (result.approximate) sourceLabel = '<div style="color:#c05621; font-size:12px; margin-top:8px; font-weight:600;">⚠️ Approximate (offline mode)</div>';
  else if (result.source === 'osrm-fallback') sourceLabel = '<div style="color:#c05621; font-size:12px; margin-top:8px; font-weight:600;">ℹ️ OSRM fallback (ORS unavailable)</div>';
  else sourceLabel = '<div style="color:#16a34a; font-size:12px; margin-top:8px; font-weight:600;">✓ Powered by OpenRouteService</div>';

  breakdown.innerHTML = result.legs.map((leg, i) => {
    const from = points[i]; const to = points[i+1];
    return `<div style="display:flex; align-items:center; gap:8px;">
      <span style="display:inline-block; width:16px; height:5px; background:${legColor(i)}; border-radius:3px; flex-shrink:0;"></span>
      <span style="font-weight:500;">${i+1}. ${shorten(from.name)} → ${shorten(to.name)}: <b style="color:var(--text-main);">${leg.km} km</b></span>
    </div>`;
  }).join('') + sourceLabel;

  window.__lastWayPoints = result.way_points || null;
  drawPlannerRoute(result.geometry, points);
}

function shorten(name) { return name.length > 26 ? name.slice(0, 24) + '…' : name; }
function haversineLocal(lat1, lng1, lat2, lng2) { const R = 6371; const dLat = (lat2 - lat1) * Math.PI / 180; const dLng = (lng2 - lng1) * Math.PI / 180; const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2; return 2 * R * Math.asin(Math.sqrt(a)); }
function findNearestIndex(geometry, point) { let minDist = Infinity, minIdx = 0; for (let i = 0; i < geometry.length; i++) { const [lng, lat] = geometry[i]; const d = (lng - point.lng) ** 2 + (lat - point.lat) ** 2; if (d < minDist) { minDist = d; minIdx = i; } } return minIdx; }

// ============================================================
// DRAW PLANNER ROUTE
// ============================================================
function drawPlannerRoute(geojsonCoords, points) {
  clearPlannerMap();
  const path = convertOrsGeometry(geojsonCoords);
  const wayPoints = window.__lastWayPoints || null;

  if (wayPoints && wayPoints.length === points.length) {
    for (let i = 0; i < points.length - 1; i++) {
      const legPath = path.slice(wayPoints[i], wayPoints[i + 1] + 1);
      if (legPath.length < 2) continue;
      const line = L.polyline(legPath, { color: legColor(i), weight: 6, opacity: 0.9, lineJoin: 'round' }).addTo(map);
      line.bindTooltip(`<b>Leg ${i + 1}</b><br>${points[i].name}<br>→ ${points[i + 1].name}`, { sticky: true });
      plannerMarkers.push(line);
    }
  } else {
    plannerRouteLine = L.polyline(path, { color: '#7c3aed', weight: 5, opacity: 0.9, lineJoin: 'round' }).addTo(map);
  }

  const uniquePoints = points.slice(0, -1);
  uniquePoints.forEach((p, i) => {
    const isHub = p.id === selectedHub.id;
    const color = isHub ? '#dc2626' : legColor(i - 1);
    const label = isHub ? 'H' : String(i);
    const m = L.marker([p.lat, p.lng], { icon: makeSpokeIcon(color, 32, label), zIndexOffset: 900 - i })
      .addTo(map).bindPopup(`<b>${p.name}</b><br>${isHub ? 'Hub (start/end)' : 'Stop ' + i}`);
    plannerMarkers.push(m);
  });

  if (path.length) map.fitBounds(L.latLngBounds(path), { padding: [50, 50] });
}

// ============================================================
// AUTO-OPTIMIZE — Local TSP solver
// ============================================================
document.getElementById('routeOptimizeBtn').addEventListener('click', () => {
  if (!selectedHub || routeStops.length < 3) { alert('Add at least 3 stops to optimize.'); return; }
  const btn = document.getElementById('routeOptimizeBtn');
  const originalText = btn.textContent;
  btn.disabled = true; btn.textContent = '⚡ Optimizing…';
  setTimeout(() => {
    try {
      const newOrder = localOptimizeRoute();
      routeStops = newOrder;
      localStorage.removeItem(`route_cache_ors_${[selectedHub.id, ...routeStops].join('_')}`);
      renderRoute(); calculateRoute();
    } catch (e) { alert('Could not optimize: ' + e.message); }
    finally { btn.disabled = false; btn.textContent = originalText; }
  }, 50);
});

function localOptimizeRoute() {
  const hub = selectedHub;
  const stops = routeStops.map(id => SPOKES.find(s => s.id === id));
  const d = (a, b) => haversineLocal(a.lat, a.lng, b.lat, b.lng);
  const visited = new Set();
  let current = hub; const tour = [];
  while (tour.length < stops.length) {
    let nearest = null, nearestDist = Infinity;
    for (const s of stops) { if (visited.has(s.id)) continue; const dd = d(current, s); if (dd < nearestDist) { nearestDist = dd; nearest = s; } }
    tour.push(nearest); visited.add(nearest.id); current = nearest;
  }
  const fullTour = [hub, ...tour, hub];
  let improved = true, passes = 0;
  while (improved && passes < 100) {
    improved = false; passes++;
    for (let i = 0; i < fullTour.length - 2; i++) {
      for (let j = i + 2; j < fullTour.length - 1; j++) {
        const a = fullTour[i], b = fullTour[i + 1], c = fullTour[j], e = fullTour[j + 1];
        if (d(a, c) + d(b, e) < d(a, b) + d(c, e) - 0.01) {
          let left = i + 1, right = j;
          while (left < right) { [fullTour[left], fullTour[right]] = [fullTour[right], fullTour[left]]; left++; right--; }
          improved = true;
        }
      }
    }
  }
  return fullTour.slice(1, -1).map(s => s.id);
}

// ============================================================
// SAVE / LOAD ROUTES
// ============================================================
document.getElementById('routeSaveBtn').addEventListener('click', () => {
  if (!selectedHub || routeStops.length === 0) return;
  const name = prompt('Name this route (e.g., "Monday Forbesganj"):');
  if (!name) return;
  const routes = JSON.parse(localStorage.getItem('savedRoutes') || '{}');
  routes[`${selectedHub.id}::${name}`] = { hubId: selectedHub.id, hubName: selectedHub.name, name, stops: routeStops.slice(), savedAt: new Date().toISOString() };
  localStorage.setItem('savedRoutes', JSON.stringify(routes));
  renderRoute(); alert(`Route "${name}" saved.`);
});

function loadRoute(key) {
  const r = JSON.parse(localStorage.getItem('savedRoutes') || '{}')[key];
  if (!r) return;
  const hub = HUBS.find(h => h.id === r.hubId);
  if (!hub) return;
  districtSel.value = hub.district; districtSel.dispatchEvent(new Event('change'));
  setTimeout(() => {
    hubSel.value = r.hubId; hubSel.dispatchEvent(new Event('change'));
    setTimeout(() => { routeStops = r.stops.slice(); renderRoute(); calculateRoute(); switchTab('route'); }, 100);
  }, 100);
}

// ============================================================
// EXPORT CSV & PRINT
// ============================================================
document.getElementById('routeExportBtn').addEventListener('click', () => {
  if (!selectedHub || routeStops.length === 0) return;
  const points = [selectedHub, ...routeStops.map(id => SPOKES.find(s => s.id === id)), selectedHub];
  const rows = [['Order', 'Name', 'Type', 'Block', 'District', 'Lat', 'Lng']];
  points.forEach((p, i) => {
    rows.push([i === 0 ? 'START' : (i === points.length - 1 ? 'END' : String(i)), p.name, p.type || 'Hub', p.block || '', p.district, p.lat, p.lng]);
  });
  const csv = rows.map(r => r.map(x => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = `route_${selectedHub.id}_${Date.now()}.csv`; a.click();
});

document.getElementById('routePrintBtn').addEventListener('click', () => {
  if (!selectedHub || routeStops.length === 0) return;
  const points = [selectedHub, ...routeStops.map(id => SPOKES.find(s => s.id === id)), selectedHub];
  const printWin = window.open('', '_blank');
  const dateStr = new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  let html = `<!DOCTYPE html><html><head><title>Runner Sheet - ${dateStr}</title><style>body{font-family:Arial,sans-serif;padding:24px;max-width:850px;margin:0 auto;color:#1a202c;}h1{font-size:20px;border-bottom:3px solid #7c3aed;padding-bottom:10px;color:#553c9a;}.meta{font-size:13px;color:#4a5568;margin-bottom:20px;padding:10px;background:#faf5ff;border-radius:6px;}table{width:100%;border-collapse:collapse;font-size:13px;margin-bottom:16px;}th{background:#f0f0f0;padding:10px;text-align:left;border:1px solid #ccc;font-size:12px;text-transform:uppercase;}td{padding:10px;border:1px solid #ccc;}.hub-row{background:#fff5f5;font-weight:bold;}.stop-num{color:white;padding:3px 9px;border-radius:50%;font-size:12px;font-weight:bold;display:inline-block;min-width:22px;text-align:center;}.signature{margin-top:30px;padding-top:16px;border-top:2px dashed #999;font-size:12px;line-height:2;}.signature b{display:inline-block;min-width:130px;}.no-print{margin-top:20px;padding:12px 24px;font-size:14px;cursor:pointer;background:#7c3aed;color:#fff;border:none;border-radius:6px;font-weight:600;}@media print{.no-print{display:none;}}</style></head><body><h1>🧪 Sample Collection Route Sheet</h1><div class="meta"><b>Date:</b> ${dateStr}<br><b>Hub:</b> ${selectedHub.name}<br><b>District:</b> ${selectedHub.district}<br><b>Total Stops:</b> ${routeStops.length} spokes + hub &nbsp;·&nbsp; <b>Total Distance:</b> ${document.getElementById('routeTotalKm').textContent}</div><table><thead><tr><th style="width:50px;">#</th><th>Facility</th><th style="width:70px;">Type</th><th style="width:130px;">Block</th><th style="width:60px;">Samples</th></tr></thead><tbody>`;
  points.forEach((p, i) => {
    const isHub = p.id === selectedHub.id;
    const label = isHub ? (i === 0 ? 'START' : 'END') : i;
    const color = isHub ? '#dc2626' : legColor(i - 1);
    html += `<tr class="${isHub ? 'hub-row' : ''}"><td><span class="stop-num" style="background:${color};">${label}</span></td><td>${p.name}</td><td>${p.type || 'Hub'}</td><td>${p.block || ''}</td><td></td></tr>`;
  });
  html += `</tbody></table><div class="signature"><b>Runner Name:</b> _______________________________<br><b>Departure Time:</b> ____________________________<br><b>Return Time:</b> _______________________________<br><b>Total Samples Collected:</b> ___________________<br><b>Runner Signature:</b> __________________________<br><b>Supervisor Signature:</b> ______________________</div><button class="no-print" onclick="window.print()">🖨️ Print This Sheet</button></body></html>`;
  printWin.document.write(html); printWin.document.close();
});

// ============================================================
// CLEANUP & ERROR BOUNDARY
// ============================================================
function clearSpokes() { spokeSel.innerHTML = ''; spokeSel.disabled = true; typeFilter.innerHTML = '<option>All types</option>'; typeFilter.disabled = true; currentSpokes = []; spokeCount.textContent = ''; }
function clearResult() { emptyMsg.style.display = 'block'; tabsWrap.style.display = 'none'; detailsView.style.display = 'none'; tableView.style.display = 'none'; routeView.style.display = 'none'; hubDistanceView.style.display = 'none'; spokeDistanceView.style.display = 'none'; currentSpoke = null; }

window.addEventListener('error', (e) => {
  console.error('App error:', e.error || e.message);
  const box = document.getElementById('errorBox');
  if (box) { box.style.display = 'block'; box.textContent = 'Something went wrong. Try refreshing the page (Ctrl + F5).'; }
});