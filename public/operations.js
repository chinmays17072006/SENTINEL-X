/* SENTINEL-X operations add-on: real base map; all mission telemetry/overlays stay simulated. */
(function sentinelOperations() {
  'use strict';

  const MAP_CENTER = { lat: 34.108, lng: -117.289 };
  const widget = { key: 'soldiers', label: 'Soldier status cards', detail: 'Representative live-status cards for the team roster.' };

  // Keep the existing admin customizer/state reset path as the single preference owner.
  if (!dashboardWidgetDefinitions.some((item) => item.key === widget.key)) dashboardWidgetDefinitions.push(widget);
  defaultDashboardWidgets.soldiers = true;
  if (typeof state.uiPrefs.widgets.soldiers !== 'boolean') state.uiPrefs.widgets.soldiers = true;

  function simulatedSmsState(appState) {
    const messages = appState.alerts
      .filter((item) => item.status === 'ACTIVE' && ['HIGH', 'CRITICAL'].includes(item.severity))
      .slice(0, 8)
      .map((item) => ({
        id: `SIM-${item.id}`,
        alertId: String(item.id),
        severity: String(item.severity),
        origin: String(item.source || 'Mission feed'),
        title: String(item.title || 'Simulated alert'),
        body: String(item.message || ''),
        time: String(item.time || clock()),
        status: 'SIMULATED ONLY · NOT TRANSMITTED',
        read: false,
      }));
    return { active: true, messages };
  }

  const createStateBeforeOperations = createState;
  createState = function createStateWithOperations() {
    const next = createStateBeforeOperations();
    next.dispatcher = simulatedSmsState(next);
    next.mapType = 'hybrid';
    next.mapZoom = 12;
    next.layers.communication = true;
    next.layers.teams = true;
    return next;
  };
  // Start this extension with the same baseline fixture as the approved prototype.
  state = createState();

  const mapMarkers = new Map();
  let mapShapes = [];
  let mapCanvas = null;
  let mapInstance = null;
  let mapInfoWindow = null;
  let mapsReady = false;
  let mapsFailed = false;
  let mapsScriptRequested = false;

  function currentPersonStatus(person) {
    if (person.movement === 'NO MOVEMENT') return 'NO MOVEMENT';
    if (person.fatigue >= 64) return 'FATIGUED';
    if (person.status === 'ATTENTION' || person.status === 'CRITICAL' || person.risk >= 45) return 'AT RISK';
    return 'ACTIVE';
  }

  function soldierCardStatus(person) {
    if (person.movement === 'NO MOVEMENT') return 'NO MOVEMENT';
    if (person.status === 'CRITICAL') return 'CRITICAL';
    if (person.fatigue >= 60) return 'FATIGUED';
    if (person.status === 'ATTENTION' || person.risk >= 40) return 'AT RISK';
    return 'ACTIVE';
  }

  function statusClass(status) {
    return status === 'NO MOVEMENT' || status === 'CRITICAL' ? 'critical'
      : status === 'FATIGUED' || status === 'AT RISK' || status === 'ATTENTION' ? 'attention'
        : 'stable';
  }

  function representativePersonnel() {
    const people = state.people;
    const selected = [];
    const pick = (status, score) => {
      const person = people.filter((item) => !selected.includes(item) && soldierCardStatus(item) === status)
        .sort((a, b) => score(b) - score(a))[0];
      if (person) selected.push(person);
    };
    pick('ACTIVE', (person) => -person.risk);
    pick('FATIGUED', (person) => person.fatigue);
    pick('AT RISK', (person) => person.risk);
    pick('NO MOVEMENT', (person) => person.risk);
    if (selected.length < 4) {
      people.filter((person) => !selected.includes(person)).sort((a, b) => b.risk - a.risk)
        .slice(0, 4 - selected.length).forEach((person) => selected.push(person));
    }
    return selected;
  }

  function renderSoldierStatusWidget() {
    const cards = representativePersonnel().map((person) => {
      const status = soldierCardStatus(person);
      const sector = person.location.x > 55 ? 'SECTOR B' : 'SECTOR A';
      return `<article class="soldier-status-card ${statusClass(status)}">
        <div class="soldier-status-top"><strong>${safeText(person.id.replace('PERSONNEL-', 'S-'))}</strong><span class="soldier-state ${statusClass(status)}">${safeText(status)}</span></div>
        <div class="soldier-team">TEAM ${safeText(person.team)} · ${sector}</div>
        <div class="soldier-risk-line"><span>RISK</span><b>${person.risk}%</b></div>
        <div class="soldier-risk-track"><i style="width:${clamp(person.risk)}%"></i></div>
        <div class="soldier-metrics"><span>HR <b>${person.heartRate} BPM</b></span><span>FATIGUE <b>${person.fatigue}%</b></span><span>COMMS <b>${safeText(person.communication)} · ${person.commQuality}%</b></span><span>MOVEMENT <b>${safeText(person.movement)}</b></span></div>
        <button class="link-button" data-action="open-guardian" data-id="${safeText(person.id)}">OPEN DIGITAL GUARDIAN ↗</button>
      </article>`;
    }).join('');
    return `<section class="panel soldier-status-panel">
      <div class="panel-head"><div class="panel-title"><div><h2>SOLDIER STATUS</h2><p>Representative roster sample · fatigue watch ≥60 · risk watch ≥40 · simulated</p></div></div><span class="state-chip blue">${state.people.length} MONITORED</span></div>
      <div class="soldier-status-grid">${cards}</div>
    </section>`;
  }

  const renderCommandBeforeOperations = renderCommand;
  renderCommand = function renderCommandWithOperations() {
    let html = renderCommandBeforeOperations();
    html = html.replace('<button class="btn primary" data-action="run-demo">', '<button class="btn ghost" data-action="export-report">⇩ EXPORT LIVE REPORT</button><button class="btn primary" data-action="run-demo">');
    const seam = '</div>\n    <div class="lower-grid">';
    if (html.includes(seam)) {
      html = html.replace(seam, `</div>\n    <div class="dashboard-widget" data-dashboard-widget="soldiers">${renderSoldierStatusWidget()}</div>\n    <div class="lower-grid">`);
    }
    return html;
  };

  function weatherOverlay() {
    if (!(state.layers.weather || state.layers.temp || state.layers.visibility)) return '';
    return `<div class="map-data-overlay"><span>LIVE ENVIRONMENT · SIMULATED</span><b>${state.env.temperature}°C · VISIBILITY ${state.env.visibility}%</b><small>RISK ${state.env.environmentRisk}% · ${safeText(state.env.weather)}</small></div>`;
  }

  function normalizedMapType() {
    return ['hybrid', 'satellite', 'terrain', 'roadmap'].includes(state.mapType) ? state.mapType : 'hybrid';
  }

  function normalizedMapZoom() {
    return Math.max(9, Math.min(18, Math.round(Number(state.mapZoom) || 12)));
  }

  function staticMapKey() {
    return `${normalizedMapType()}|${normalizedMapZoom()}`;
  }

  function staticMapUrl() {
    return `/api/map/static?maptype=${encodeURIComponent(normalizedMapType())}&zoom=${normalizedMapZoom()}`;
  }

  const renderMapBeforeGoogleMaps = renderMapPanel;
  renderMapPanel = function renderMapWithGoogle(context = 'command', right = '') {
    let html = renderMapBeforeGoogleMaps(context, right);
    const layerSeam = '</div><div class="map-wrap';
    if (html.includes(layerSeam)) {
      const extraLayers = `<button class="layer-toggle ${state.layers.communication ? 'on' : ''}" data-layer="communication">COMMS</button><button class="layer-toggle ${state.layers.teams ? 'on' : ''}" data-layer="teams">TEAM</button>`;
      html = html.replace(layerSeam, `${extraLayers}</div><div class="map-wrap`);
    }
    html = html.replace('class="map-wrap ', 'class="map-wrap google-map-shell ');
    const mapType = normalizedMapType();
    const zoom = normalizedMapZoom();
    const mount = `<img id="sentinel-google-map" class="google-map-canvas google-static-map" src="${staticMapUrl()}" data-map-key="${staticMapKey()}" alt="Google Maps ${safeText(mapType)} base imagery; all operational markers and overlays are simulated">
      <div class="map-api-status" aria-live="polite">LOADING GOOGLE MAPS ${safeText(mapType.toUpperCase())} · OPERATIONAL OVERLAYS SIMULATED</div>
      <div class="map-type-switch" role="group" aria-label="Google Maps base map type">
        <button class="${state.mapType === 'hybrid' ? 'active' : ''}" data-action="map-type" data-type="hybrid">SATELLITE</button>
        <button class="${state.mapType === 'terrain' ? 'active' : ''}" data-action="map-type" data-type="terrain">TERRAIN</button>
        <button class="${state.mapType === 'roadmap' ? 'active' : ''}" data-action="map-type" data-type="roadmap">MAP</button>
      </div>
      <div class="map-zoom-controls" role="group" aria-label="Map zoom"><button data-action="map-zoom" data-delta="-1" aria-label="Zoom out">−</button><span>Z${zoom}</span><button data-action="map-zoom" data-delta="1" aria-label="Zoom in">+</button></div>${weatherOverlay()}`;
    const riskOverlay = state.layers.hazard || state.layers.terrain ? `<svg class="google-risk-overlays" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <polygon class="risk-polygon-high" points="44,20 66,17 79,30 75,47 60,55 47,43"></polygon>
      <polygon class="risk-polygon-medium" points="28,54 43,49 49,62 41,74 26,69"></polygon>
      <polygon class="risk-polygon-safe" points="64,62 83,59 91,73 81,88 66,83 59,71"></polygon>
      <polyline class="risk-route-cyan" points="12,76 29,71 42,58 58,62 73,44 88,31"></polyline>
      <polyline class="risk-route-amber" points="17,80 32,84 48,78 64,84 82,76"></polyline>
      <text x="50" y="30">HIGH RISK · SIMULATED</text><text x="67" y="68">SAFE ZONE · SIMULATED</text>
    </svg>` : '';
    const distress = state.people.find((person) => person.id === 'PERSONNEL-07');
    const node = state.equipment.find((item) => item.id === 'Communication Node C-04');
    const point = (value) => Number(value || 0);
    const sx = point(distress?.location.x) * 8, sy = point(distress?.location.y) * 3.2;
    const nx = point(node?.location.x || 46) * 8, ny = point(node?.location.y || 39) * 3.2;
    const communicationOverlay = state.layers.communication ? `<svg class="communication-overlay" viewBox="0 0 800 320" preserveAspectRatio="none" aria-label="Simulated communications link"><path d="M${sx} ${sy} Q${(sx + nx) / 2} ${(sy + ny) / 2 - 20} ${nx} ${ny}"></path><circle cx="${sx}" cy="${sy}" r="5"></circle><circle cx="${nx}" cy="${ny}" r="5"></circle></svg>` : '';
    const members = state.people.filter((person) => person.team === 'ALPHA');
    const avgX = members.reduce((sum, person) => sum + person.location.x, 0) / Math.max(1, members.length);
    const avgY = members.reduce((sum, person) => sum + person.location.y, 0) / Math.max(1, members.length);
    const teamMarker = state.layers.teams ? `<button class="map-team-marker" style="left:${avgX}%;top:${avgY}%" data-action="team-details" aria-label="Open simulated Alpha Team details"><i></i><span>ALPHA TEAM</span><b>${state.mission.teamRisk}% RISK</b></button>` : '';
    const projectionScale = Math.pow(2, zoom - 12).toFixed(3);
    let projected = html.replace('<svg class="terrain-lines"', `${mount}<div class="map-projection-layer" style="--map-projection-scale:${projectionScale}">${riskOverlay}${communicationOverlay}${teamMarker}<svg class="terrain-lines"`);
    const mapEnd = projected.indexOf('</div><div class="map-legend">');
    const bannerStart = projected.indexOf('<div class="sos-active-banner');
    const buttonStart = projected.indexOf('<button class="sos-map-button');
    const sosUiStart = bannerStart >= 0 ? bannerStart : buttonStart;
    const projectionEnd = sosUiStart >= 0 && sosUiStart < mapEnd ? sosUiStart : mapEnd;
    if (projectionEnd >= 0) projected = `${projected.slice(0, projectionEnd)}</div>${projected.slice(projectionEnd)}`;
    return projected;
  };

  function coordinatesForXY(x, y) {
    return { lat: MAP_CENTER.lat + (50 - Number(y || 50)) * 0.00105, lng: MAP_CENTER.lng + (Number(x || 50) - 50) * 0.00135 };
  }

  function mapStatus(message) {
    document.querySelectorAll('.map-api-status').forEach((element) => { element.textContent = message; });
  }

  function infoMarkup(title, lines, color = '#16313a') {
    return `<div style="font:12px/1.5 Arial,sans-serif;color:#10232a;min-width:210px;padding:2px 3px">
      <div style="font-weight:700;letter-spacing:.04em;color:${color};margin-bottom:5px">${safeText(title)}</div>
      ${lines.map((line) => `<div style="border-top:1px solid #dae4e7;padding:3px 0">${safeText(line)}</div>`).join('')}
      <div style="margin-top:5px;color:#667980;font-size:10px">SIMULATED DATA · NO REAL PERSONNEL TRACKING</div></div>`;
  }

  function openMarkerDetails(type, id, key) {
    const person = type === 'person' ? state.people.find((item) => item.id === id) : null;
    const equipment = type === 'equipment' ? state.equipment.find((item) => item.id === id) : null;
    const node = type === 'node' ? state.equipment.find((item) => item.id === 'Communication Node C-04') : null;
    let content = '';
    if (person) {
      const status = currentPersonStatus(person);
      content = infoMarkup(`${person.id} · ${status}`, [`TEAM ${person.team}`, `RISK ${person.risk}% · HEART RATE ${person.heartRate} BPM`, `FATIGUE ${person.fatigue}% · COMMUNICATION ${person.communication} (${person.commQuality}%)`, `MOVEMENT ${person.movement}`], statusClass(status) === 'critical' ? '#bd293b' : statusClass(status) === 'attention' ? '#a36a00' : '#087d69');
    } else if (equipment) {
      content = infoMarkup(equipment.id.toUpperCase(), [`STATUS ${equipment.status} · HEALTH ${equipment.health}%`, `TEMPERATURE ${equipment.temperature}°C · RUNTIME ${equipment.runtime}`, `FAILURE PROBABILITY ${equipment.failureProbability}%`, `MAINTENANCE ${equipment.maintenance}`], equipment.status === 'WARNING' ? '#a36a00' : '#176d87');
    } else if (node) {
      content = infoMarkup('COMMUNICATION NODE C-04', [`NETWORK HEALTH ${state.comm.health}% · COVERAGE ${state.comm.coverage}%`, `LATENCY ${state.comm.latency} MS · PACKET LOSS ${state.comm.packetLoss}%`, 'OFFLINE RESILIENCE ACTIVE'], '#176d87');
    } else if (type === 'team') {
      const members = state.people.filter((item) => item.team === id);
      content = infoMarkup(`TEAM ${id}`, [`${members.length} SIMULATED PERSONNEL`, `${members.filter((item) => item.risk >= 35).length} PERSONNEL AT ELEVATED RISK`, `COMBINED TEAM RISK ${state.mission.teamRisk}%`], '#176d87');
    }
    if (!content || !mapInfoWindow || !mapInstance) return;
    mapInfoWindow.setContent(content);
    const marker = mapMarkers.get(key);
    if (marker) mapInfoWindow.open(mapInstance, marker);
  }

  function selectMapMarker(type, id, key) {
    if (type !== 'team') {
      state.selected = { type, id };
      render();
    }
    window.setTimeout(() => openMarkerDetails(type, id, key), 0);
  }

  function ensureMapMarker(key, type, id, position, options) {
    const maps = window.google.maps;
    let marker = mapMarkers.get(key);
    if (!marker) {
      marker = new maps.Marker({ map: null, position, clickable: true, optimized: true });
      marker.addListener('click', () => selectMapMarker(type, id, key));
      mapMarkers.set(key, marker);
    }
    marker.setPosition(position);
    marker.setTitle(options.title);
    marker.setIcon({ path: maps.SymbolPath.CIRCLE, scale: options.scale || 8, fillColor: options.color, fillOpacity: 1, strokeColor: '#effcff', strokeOpacity: .92, strokeWeight: 1.4 });
    marker.setLabel(options.label ? { text: options.label, color: '#f4fbfc', fontSize: '9px', fontWeight: '700' } : null);
    marker.setMap(options.visible ? mapInstance : null);
  }

  function clearMapShapes() {
    mapShapes.forEach((shape) => shape.setMap(null));
    mapShapes = [];
  }

  function addMapShape(shape) {
    mapShapes.push(shape);
    return shape;
  }

  function addPolygon(points, fill, stroke, opacity = .27) {
    const maps = window.google.maps;
    addMapShape(new maps.Polygon({ map: mapInstance, paths: points.map((point) => coordinatesForXY(point[0], point[1])), strokeColor: stroke, strokeOpacity: .86, strokeWeight: 2, fillColor: fill, fillOpacity: opacity, clickable: false, zIndex: 1 }));
  }

  function syncGoogleMap() {
    if (!mapsReady || !window.google?.maps || !mapCanvas) return;
    const maps = window.google.maps;
    const wrapper = mapCanvas.closest('.google-map-shell');
    if (wrapper) wrapper.classList.add('google-map-ready');
    if (!mapInstance) {
      mapInstance = new maps.Map(mapCanvas, {
        center: MAP_CENTER,
        zoom: 12,
        minZoom: 9,
        maxZoom: 18,
        mapTypeId: state.mapType || 'hybrid',
        mapTypeControl: false,
        streetViewControl: false,
        fullscreenControl: true,
        zoomControl: true,
        clickableIcons: false,
        gestureHandling: 'greedy',
        backgroundColor: '#071116',
      });
      mapInfoWindow = new maps.InfoWindow({ maxWidth: 300 });
    } else {
      maps.event.trigger(mapInstance, 'resize');
      if (mapInstance.getMapTypeId() !== state.mapType) mapInstance.setMapTypeId(state.mapType);
    }

    const used = new Set();
    function setMarker(key, type, id, pos, options) {
      used.add(key);
      ensureMapMarker(key, type, id, pos, options);
    }

    const people = state.people.filter((person, index) => index % 4 === 0 || person.status !== 'NORMAL' || person.id === 'PERSONNEL-07');
    if (state.layers.personnel) {
      people.forEach((person) => {
        const status = currentPersonStatus(person);
        const color = status === 'NO MOVEMENT' || person.risk >= 65 ? '#fb435b' : status === 'FATIGUED' || status === 'AT RISK' ? '#f4b84e' : '#27d2ac';
        const label = person.id === 'PERSONNEL-07' || person.risk >= 45 || person.status !== 'NORMAL' ? person.id.replace('PERSONNEL-', 'S-') : null;
        setMarker(`person:${person.id}`, 'person', person.id, coordinatesForXY(person.location.x, person.location.y), { color, label, title: `${person.id} · ${status} · risk ${person.risk}%` });
      });
    }

    if (state.layers.infrastructure) {
      state.equipment.forEach((item) => {
        const color = item.health < 75 ? '#fb5362' : item.status === 'WARNING' || item.status === 'ATTENTION' ? '#f4b84e' : '#7bafff';
        const shortId = item.id.replace('Equipment ', '').replace('Communication Node ', 'NODE ');
        setMarker(`equipment:${item.id}`, 'equipment', item.id, coordinatesForXY(item.location.x, item.location.y), { color, label: shortId, title: `${item.id} · ${item.status} · health ${item.health}%` });
      });
    }

    if (state.layers.teams) {
      const team = state.people.filter((person) => person.team === 'ALPHA');
      const avgX = team.reduce((sum, person) => sum + person.location.x, 0) / Math.max(1, team.length);
      const avgY = team.reduce((sum, person) => sum + person.location.y, 0) / Math.max(1, team.length);
      setMarker('team:ALPHA', 'team', 'ALPHA', coordinatesForXY(avgX, avgY), { color: '#36b8d5', label: 'ALPHA TEAM', title: `ALPHA TEAM · ${team.length} simulated personnel` });
    }

    if (state.layers.coverage) {
      const node = state.equipment.find((item) => item.id === 'Communication Node C-04');
      if (node) setMarker('node:C-04', 'node', 'NODE-C-04', coordinatesForXY(node.location.x, node.location.y), { color: '#53c8e8', label: 'COMMS NODE', title: `C-04 · ${state.comm.health}% health · ${state.comm.coverage}% coverage` });
    }

    for (const [key, marker] of mapMarkers) {
      if (!used.has(key)) {
        marker.setMap(null);
        mapMarkers.delete(key);
      }
    }

    clearMapShapes();
    if (state.layers.hazard || state.layers.terrain) {
      const riskColor = state.env.environmentRisk >= 20 ? '#ef435a' : '#eeb654';
      addPolygon([[48, 23], [68, 20], [78, 34], [73, 49], [59, 54], [45, 42]], riskColor, riskColor, .27);
      addPolygon([[64, 61], [84, 58], [91, 74], [80, 88], [65, 82], [59, 70]], '#1bc990', '#52e0b7', .19);
    }
    addMapShape(new maps.Polyline({ map: mapInstance, path: [[16, 74], [32, 68], [44, 57], [59, 60], [73, 43], [86, 31]].map((point) => coordinatesForXY(point[0], point[1])), geodesic: true, strokeColor: '#24cfdd', strokeOpacity: .95, strokeWeight: 3, clickable: false, zIndex: 2 }));
    addMapShape(new maps.Polyline({ map: mapInstance, path: [[18, 77], [33, 83], [49, 78], [64, 84], [81, 76]].map((point) => coordinatesForXY(point[0], point[1])), geodesic: true, strokeColor: '#f6bb4d', strokeOpacity: .9, strokeWeight: 2, clickable: false, zIndex: 2 }));

    if (state.layers.communication) {
      const person = state.people.find((item) => item.id === 'PERSONNEL-07');
      const node = state.equipment.find((item) => item.id === 'Communication Node C-04');
      if (person && node) {
        addMapShape(new maps.Polyline({ map: mapInstance, path: [coordinatesForXY(person.location.x, person.location.y), coordinatesForXY(node.location.x, node.location.y)], geodesic: true, strokeColor: '#f2cf65', strokeOpacity: .94, strokeWeight: 2, icons: [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: 1, scale: 3 }, offset: '0', repeat: '12px' }], clickable: false, zIndex: 3 }));
      }
    }
    if (state.layers.coverage) {
      const node = state.equipment.find((item) => item.id === 'Communication Node C-04');
      if (node) addMapShape(new maps.Circle({ map: mapInstance, center: coordinatesForXY(node.location.x, node.location.y), radius: 2300 + state.comm.coverage * 20, strokeColor: '#58c9e4', strokeOpacity: .7, strokeWeight: 1.5, fillColor: '#39bbd4', fillOpacity: .07, clickable: false, zIndex: 1 }));
    }
    mapStatus('GOOGLE MAPS BASEMAP · SOLDIER / RISK OVERLAYS SIMULATED');
  }

  function failMap(message) {
    mapsFailed = true;
    mapsReady = false;
    mapStatus(message || 'GOOGLE MAPS UNAVAILABLE · LOCAL SIMULATED GRID ACTIVE');
  }

  function loadGoogleMaps() {
    // Real Google imagery is served by the same-origin, server-authenticated
    // Static Maps endpoint; no browser key or external Maps JavaScript SDK is loaded.
  }

  const renderBeforeGoogleMapSync = render;
  function setStaticMapStatus(image, status) {
    const wrapper = image?.closest('.google-map-shell');
    if (!wrapper) return;
    wrapper.classList.toggle('google-map-ready', status === 'ready');
    const label = wrapper.querySelector('.map-api-status');
    if (!label) return;
    if (status === 'ready') label.textContent = `GOOGLE MAPS ${normalizedMapType().toUpperCase()} · PERSONNEL / RISK OVERLAYS SIMULATED`;
    else if (status === 'error') label.textContent = 'GOOGLE MAPS UNAVAILABLE · LOCAL SIMULATED GRID ACTIVE';
    else label.textContent = `LOADING GOOGLE MAPS ${normalizedMapType().toUpperCase()} · OPERATIONAL OVERLAYS SIMULATED`;
  }

  function attachStaticMapHandlers(image) {
    if (image.dataset.staticMapHandlers !== 'true') {
      image.addEventListener('load', () => setStaticMapStatus(image, 'ready'));
      image.addEventListener('error', () => setStaticMapStatus(image, 'error'));
      image.dataset.staticMapHandlers = 'true';
    }
    if (image.complete) setStaticMapStatus(image, image.naturalWidth > 0 ? 'ready' : 'error');
  }

  render = function renderWithGoogleMapSync() {
    const currentCanvas = document.getElementById('sentinel-google-map');
    if (currentCanvas) mapCanvas = currentCanvas;
    renderBeforeGoogleMapSync();
    const placeholder = document.getElementById('sentinel-google-map');
    if (placeholder) {
      if (mapCanvas && placeholder !== mapCanvas) placeholder.replaceWith(mapCanvas);
      else mapCanvas = placeholder;
      attachStaticMapHandlers(mapCanvas);
      const key = staticMapKey();
      if (mapCanvas.dataset.mapKey !== key) {
        mapCanvas.dataset.mapKey = key;
        setStaticMapStatus(mapCanvas, 'loading');
        mapCanvas.src = staticMapUrl();
      } else if (mapCanvas.complete) {
        setStaticMapStatus(mapCanvas, mapCanvas.naturalWidth > 0 ? 'ready' : 'error');
      }
    }
    applyDashboardVisibility();
    updateDispatcherBadge();
  };

  function updateDispatcherBadge() {
    const badge = document.getElementById('notification-count');
    if (!badge || !state.dispatcher) return;
    const unread = state.dispatcher.messages.filter((message) => !message.read).length;
    badge.textContent = unread ? String(unread) : '';
    badge.hidden = unread === 0;
    const button = badge.closest('button');
    if (button) button.setAttribute('aria-label', `${unread} unread simulated dispatcher messages`);
  }

  function queueSimulatedSms(alert) {
    if (!state.dispatcher?.active || !alert || !['HIGH', 'CRITICAL'].includes(String(alert.severity).toUpperCase())) return;
    if (state.dispatcher.messages.some((message) => message.alertId === String(alert.id))) return;
    state.dispatcher.messages.unshift({
      id: `SIM-${String(alert.id)}`,
      alertId: String(alert.id),
      severity: String(alert.severity).toUpperCase(),
      origin: String(alert.source || 'Mission feed'),
      title: String(alert.title || 'Simulated alert'),
      body: String(alert.message || ''),
      time: String(alert.time || clock()),
      status: 'SIMULATED ONLY · NOT TRANSMITTED',
      read: false,
    });
    state.dispatcher.messages = state.dispatcher.messages.slice(0, 40);
    updateDispatcherBadge();
    notify(`SIMULATED DISPATCH SMS LOGGED · ${alert.severity} · NO REAL MESSAGE SENT`, alert.severity === 'CRITICAL' ? 'critical' : '');
  }

  function captureNewIncidents(fn) {
    return function captureIncidentCreation(...args) {
      const before = new Set(state.alerts.map((alert) => String(alert.id)));
      const result = fn.apply(this, args);
      const created = state.alerts.filter((alert) => !before.has(String(alert.id)));
      created.reverse().forEach(queueSimulatedSms);
      return result;
    };
  }
  applyScenario = captureNewIncidents(applyScenario);
  applyDemoStage = captureNewIncidents(applyDemoStage);
  sendSimulatedSOS = captureNewIncidents(sendSimulatedSOS);

  function dispatcherInbox() {
    const messages = state.dispatcher.messages;
    const body = `<div class="dispatch-disclaimer"><strong>SIMULATED SMS · NO REAL MESSAGE SENT</strong><span>Local alert routing preview for emergency dispatchers. Nothing is transmitted.</span></div>
      <div class="dispatch-channel-row"><span><i class="dispatch-live-dot"></i> SIMULATED CHANNEL</span><b>${state.dispatcher.active ? 'ACTIVE' : 'PAUSED'}</b><span>${messages.filter((message) => !message.read).length} UNREAD</span></div>
      <div class="dispatch-list">${messages.length ? messages.map((message) => `<article class="dispatch-card ${message.read ? 'is-read' : 'is-unread'}">
        <div class="dispatch-card-head"><span class="sev ${message.severity.toLowerCase()}">${safeText(message.severity)}</span><time>${safeText(message.time)}</time></div>
        <strong>${safeText(message.title)}</strong><span class="dispatch-origin">TO: SIMULATED DISPATCH DESK · ORIGIN: ${safeText(message.origin)}</span>
        <p>${safeText(message.body)}</p><div class="dispatch-card-foot"><span>${safeText(message.status)}</span>${message.read ? '<b>READ</b>' : `<button class="link-button" data-action="mark-dispatch-read" data-id="${safeText(message.id)}">MARK READ</button>`}</div>
      </article>`).join('') : '<div class="empty-state"><strong>No dispatch entries yet</strong>New simulated high/critical incidents appear here.</div>'}</div>`;
    openModal('EMERGENCY DISPATCH · MESSAGE LOG', body, [
      { label: state.dispatcher.active ? 'PAUSE SIMULATED CHANNEL' : 'RESUME SIMULATED CHANNEL', action: 'toggle-dispatch-channel', className: 'ghost' },
      { label: 'MARK ALL READ', action: 'mark-all-dispatch-read', className: 'ghost' },
      { label: 'CLOSE', action: 'close-modal', className: 'primary' },
    ]);
  }

  function markDispatchRead(id) {
    const message = state.dispatcher.messages.find((item) => item.id === id);
    if (message) message.read = true;
    updateDispatcherBadge();
    dispatcherInbox();
  }

  function liveReportSnapshot() {
    const normal = state.people.filter((person) => person.status === 'NORMAL').length;
    const attention = state.people.filter((person) => person.status === 'ATTENTION').length;
    const critical = state.people.filter((person) => person.status === 'CRITICAL').length;
    const equipmentHealth = round(state.equipment.reduce((sum, item) => sum + item.health, 0) / Math.max(1, state.equipment.length));
    return {
      asOf: new Date().toISOString(),
      normal,
      attention,
      critical,
      equipmentHealth,
      activeAlerts: state.alerts.filter((item) => item.status === 'ACTIVE').length,
    };
  }

  function reportRows(snapshot = liveReportSnapshot()) {
    const headers = ['record_type', 'as_of', 'incident_id', 'severity', 'source', 'origin', 'title', 'message', 'status', 'confidence_pct', 'mission_safety', 'team_risk', 'mission_risk', 'response_priority', 'personnel_count', 'personnel_normal', 'personnel_attention', 'personnel_critical', 'equipment_health_pct', 'communication_health_pct', 'communication_coverage_pct', 'latency_ms', 'packet_loss_pct', 'environment_risk_pct', 'visibility_pct', 'temperature_c', 'risk_pct'];
    const row = (data) => headers.map((key) => data[key] ?? '');
    const rows = [headers];
    rows.push(row({ record_type: 'SNAPSHOT', as_of: snapshot.asOf, status: 'SIMULATION ONLY', mission_safety: state.mission.safety, team_risk: state.mission.teamRisk, mission_risk: state.mission.missionRisk, response_priority: state.mission.responsePriority, personnel_count: state.people.length, personnel_normal: snapshot.normal, personnel_attention: snapshot.attention, personnel_critical: snapshot.critical, equipment_health_pct: snapshot.equipmentHealth, communication_health_pct: state.comm.health, communication_coverage_pct: state.comm.coverage, latency_ms: state.comm.latency, packet_loss_pct: state.comm.packetLoss, environment_risk_pct: state.env.environmentRisk, visibility_pct: state.env.visibility, temperature_c: state.env.temperature }));
    state.alerts.forEach((alert) => rows.push(row({ record_type: 'INCIDENT', as_of: alert.time, incident_id: alert.id, severity: alert.severity, source: alert.source, origin: alert.source, title: alert.title, message: alert.message, status: alert.status, confidence_pct: alert.confidence, mission_safety: state.mission.safety, team_risk: state.mission.teamRisk, mission_risk: state.mission.missionRisk, response_priority: state.mission.responsePriority })));
    state.people.forEach((person) => rows.push(row({ record_type: 'PERSONNEL', as_of: snapshot.asOf, incident_id: person.id, source: 'Digital Guardian · simulated', origin: person.team, title: currentPersonStatus(person), message: `HR ${person.heartRate} BPM; fatigue ${person.fatigue}%; communication ${person.communication}; movement ${person.movement}`, status: person.status, mission_risk: person.risk, origin: person.team, confidence_pct: '' })));
    state.equipment.forEach((item) => rows.push(row({ record_type: 'EQUIPMENT', as_of: snapshot.asOf, incident_id: item.id, source: 'Predictive maintenance · simulated', title: item.status, message: `Health ${item.health}%; temperature ${item.temperature} C; failure probability ${item.failureProbability}%; maintenance ${item.maintenance}`, status: item.status })));
    state.events.slice(0, 20).forEach((event, index) => rows.push(row({ record_type: 'EVENT', as_of: event.time, incident_id: `EVENT-${index + 1}`, severity: event.level, source: event.source, title: event.title, status: 'MISSION MEMORY' })));
    state.dispatcher.messages.slice(0, 20).forEach((message) => rows.push(row({ record_type: 'SIMULATED_DISPATCH', as_of: message.time, incident_id: message.alertId, severity: message.severity, source: 'Simulated dispatcher', origin: message.origin, title: message.title, message: message.body, status: message.status })));
    return { headers, rows, snapshot };
  }

  function csvCell(value) {
    let text = String(value ?? '').replace(/[\r\n]+/g, ' ').replace(/\u0000/g, '');
    if (typeof value === 'string' && /^[\s]*[=+\-@]/.test(text)) text = `'${text}`;
    return `"${text.replace(/"/g, '""')}"`;
  }

  function makeCsv() {
    const data = reportRows();
    return data.rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
  }

  function reportTextLines() {
    const snap = liveReportSnapshot();
    const lines = [
      'SENTINEL-X - LIVE INCIDENT & ANALYTICS REPORT',
      `AS OF: ${snap.asOf}`,
      'MODE: SIMULATION ONLY - NOT A VALIDATED FORECAST OR OPERATIONAL RECORD',
      '',
      'CURRENT ANALYTICS SNAPSHOT',
      `Mission Safety: ${state.mission.safety}/100`,
      `Team Risk: ${state.mission.teamRisk}%`,
      `Mission Risk: ${state.mission.missionRisk}%`,
      `Response Priority: ${state.mission.responsePriority}`,
      `Personnel Monitored: ${state.people.length} (Normal ${snap.normal}; Attention ${snap.attention}; Critical ${snap.critical})`,
      `Average Equipment Health: ${snap.equipmentHealth}%`,
      `Communication: ${state.comm.health}% health; ${state.comm.coverage}% coverage; ${state.comm.latency} ms latency; ${state.comm.packetLoss}% packet loss`,
      `Environment: ${state.env.environmentRisk}% risk; ${state.env.visibility}% visibility; ${state.env.temperature} C`,
      `Active Incidents: ${snap.activeAlerts} | Total Retained Incidents: ${state.alerts.length}`,
      '',
      'INCIDENT LOG',
    ];
    state.alerts.forEach((alert) => lines.push(`[${alert.time}] ${alert.severity} | ${alert.title} | ${alert.source} | ${alert.status} | confidence ${alert.confidence}%`, `  ${alert.message}`));
    lines.push('', 'PERSONNEL STATUS');
    state.people.forEach((person) => lines.push(`${person.id} | Team ${person.team} | ${currentPersonStatus(person)} | risk ${person.risk}% | HR ${person.heartRate} BPM | fatigue ${person.fatigue}% | ${person.communication} | ${person.movement}`));
    lines.push('', 'EQUIPMENT STATUS');
    state.equipment.forEach((item) => lines.push(`${item.id} | ${item.status} | health ${item.health}% | ${item.temperature} C | failure probability ${item.failureProbability}% | maintenance ${item.maintenance}`));
    lines.push('', 'RECENT EVENT HISTORY');
    state.events.slice(0, 20).forEach((event) => lines.push(`[${event.time}] ${event.level} | ${event.title} | ${event.source}`));
    lines.push('', 'SIMULATED DISPATCH LOG - NO MESSAGE TRANSMITTED');
    state.dispatcher.messages.slice(0, 20).forEach((message) => lines.push(`[${message.time}] ${message.severity} | ${message.origin} | ${message.title} | ${message.status}`));
    lines.push('', 'DISCLAIMER: Simulation prototype. AI-generated decision support only. Human approval required. No real sensor, personnel, dispatch or SMS system is connected.');
    return lines;
  }

  function asciiPdfText(value) {
    return String(value ?? '').normalize('NFKD').replace(/[^\x20-\x7E]/g, '?').replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  }

  function makePdf() {
    const lines = reportTextLines().flatMap((line) => {
      const text = String(line).normalize('NFKD').replace(/[^\x20-\x7E]/g, '?');
      if (!text) return [''];
      const chunks = [];
      for (let i = 0; i < text.length; i += 96) chunks.push(text.slice(i, i + 96));
      return chunks;
    });
    const pages = [];
    for (let i = 0; i < lines.length; i += 48) pages.push(lines.slice(i, i + 48));
    if (!pages.length) pages.push(['SENTINEL-X REPORT']);
    const objects = [];
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
    const pageIds = pages.map((_, index) => 4 + index * 2);
    objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
    pages.forEach((page, index) => {
      const pageId = pageIds[index];
      const contentId = pageId + 1;
      const content = page.map((line, lineIndex) => `BT /F1 ${lineIndex === 0 && index === 0 ? 14 : 9} Tf 42 ${750 - lineIndex * 14} Td (${asciiPdfText(line)}) Tj ET`).join('\n');
      objects[pageId] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentId} 0 R >>`;
      objects[contentId] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
    });
    let output = '%PDF-1.4\n';
    const offsets = [0];
    for (let index = 1; index < objects.length; index += 1) {
      offsets[index] = output.length;
      output += `${index} 0 obj\n${objects[index]}\nendobj\n`;
    }
    const xrefOffset = output.length;
    output += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
    for (let index = 1; index < objects.length; index += 1) output += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
    output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return output;
  }

  function reportExportModal() {
    const snap = liveReportSnapshot();
    openModal('EXPORT LIVE ANALYTICS REPORT', `<div class="report-summary">
      <div class="report-summary-head"><b>AS OF ${safeText(snap.asOf.replace('T', ' ').replace('Z', ' UTC'))}</b><span>LIVE STATE SNAPSHOT</span></div>
      <div class="mini-stat-grid"><div class="mini-stat"><span>MISSION RISK</span><strong>${state.mission.missionRisk}%</strong></div><div class="mini-stat"><span>ACTIVE INCIDENTS</span><strong>${snap.activeAlerts}</strong></div><div class="mini-stat"><span>PERSONNEL</span><strong>${state.people.length}</strong></div></div>
      <p>Includes the current KPI snapshot, ${state.alerts.length} retained incidents, ${state.events.length} recent history events, simulated personnel/equipment summaries and dispatcher log.</p>
      <div class="dispatch-disclaimer"><strong>SIMULATION PROTOTYPE</strong><span>Decision support only · human approval required · no real personnel or dispatch data.</span></div>
    </div>`, [
      { label: 'DOWNLOAD CSV', action: 'export-csv', className: 'ghost' },
      { label: 'DOWNLOAD PDF', action: 'export-pdf', className: 'primary' },
      { label: 'CANCEL', action: 'close-modal', className: 'ghost' },
    ]);
  }

  function downloadReport(format) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const isCsv = format === 'csv';
    const blob = new Blob([isCsv ? makeCsv() : makePdf()], { type: isCsv ? 'text/csv;charset=utf-8' : 'application/pdf' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sentinel-x-live-report-${stamp}.${isCsv ? 'csv' : 'pdf'}`;
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    closeModal();
    notify(`${isCsv ? 'CSV' : 'PDF'} LIVE REPORT DOWNLOADED · SIMULATION DATA`);
  }

  function openTeamDetails() {
    const members = state.people.filter((person) => person.team === 'ALPHA');
    const statuses = ['ACTIVE', 'FATIGUED', 'AT RISK', 'NO MOVEMENT'];
    const statusHtml = statuses.map((status) => `<div class="mini-stat"><span>${status}</span><strong>${members.filter((person) => soldierCardStatus(person) === status).length}</strong></div>`).join('');
    const averageComms = round(members.reduce((sum, person) => sum + person.commQuality, 0) / Math.max(1, members.length));
    openModal('ALPHA TEAM · SIMULATED STATUS', `<div class="dispatch-disclaimer"><strong>SIMULATED PERSONNEL ONLY</strong><span>No real roster, location or communications system is connected.</span></div><div class="mini-stat-grid">${statusHtml}</div><div class="team-detail-summary"><b>TEAM RISK ${state.mission.teamRisk}%</b><span>${members.length} simulated records · average communications ${averageComms}%</span></div><div class="team-detail-list">${members.slice(0, 8).map((person) => `<div><strong>${safeText(person.id)}</strong><span>${safeText(soldierCardStatus(person))} · risk ${person.risk}% · ${safeText(person.communication)}</span></div>`).join('')}</div>`, [{ label: 'CLOSE', action: 'close', className: 'primary' }]);
  }

  const handleActionBeforeOperations = handleAction;
  handleAction = function handleOperationActions(action, target) {
    const id = target?.dataset?.id;
    if (action === 'team-details') { openTeamDetails(); return; }
    if (action === 'notifications') { dispatcherInbox(); return; }
    if (action === 'mark-dispatch-read') { markDispatchRead(id); return; }
    if (action === 'mark-all-dispatch-read') { state.dispatcher.messages.forEach((message) => { message.read = true; }); updateDispatcherBadge(); dispatcherInbox(); return; }
    if (action === 'toggle-dispatch-channel') { state.dispatcher.active = !state.dispatcher.active; dispatcherInbox(); notify(`SIMULATED DISPATCH CHANNEL ${state.dispatcher.active ? 'RESUMED' : 'PAUSED'}`); return; }
    if (action === 'export-report') { reportExportModal(); return; }
    if (action === 'export-csv') { downloadReport('csv'); return; }
    if (action === 'export-pdf') { downloadReport('pdf'); return; }
    if (action === 'map-type') {
      const type = target?.dataset?.type;
      if (['hybrid', 'terrain', 'roadmap'].includes(type)) {
        state.mapType = type;
        render();
      }
      return;
    }
    if (action === 'map-zoom') {
      const delta = Number(target?.dataset?.delta) || 0;
      state.mapZoom = Math.max(9, Math.min(18, normalizedMapZoom() + delta));
      render();
      return;
    }
    handleActionBeforeOperations(action, target);
  };

  window.addEventListener('resize', () => {
    if (mapsReady && mapInstance) window.google.maps.event.trigger(mapInstance, 'resize');
  });

  function setStaticMapStatus(image, loaded) {
    const wrapper = image?.closest('.google-map-shell');
    if (!wrapper) return;
    const status = wrapper.querySelector('.map-api-status');
    if (loaded) {
      wrapper.classList.add('google-map-ready');
      wrapper.classList.remove('google-map-error');
      if (status) status.textContent = `GOOGLE MAPS ${normalizedMapType().toUpperCase()} · LIVE BASEMAP · OPERATIONAL OVERLAYS SIMULATED`;
    } else {
      wrapper.classList.remove('google-map-ready');
      wrapper.classList.add('google-map-error');
      if (status) status.textContent = 'GOOGLE MAPS UNAVAILABLE · LOCAL SCHEMATIC FALLBACK ACTIVE';
    }
  }

  function bindStaticMapImage(image) {
    if (!image || image.dataset.staticMapEvents) return;
    image.addEventListener('load', () => setStaticMapStatus(image, true));
    image.addEventListener('error', () => setStaticMapStatus(image, false));
    image.dataset.staticMapEvents = 'true';
  }

  // Reuse the image across telemetry ticks; only fetch again when map type or zoom changes.
  const renderBeforeMapLifecycle = render;
  render = function renderWithMapLifecycle() {
    const oldImage = document.getElementById('sentinel-google-map');
    if (oldImage) mapCanvas = oldImage;
    renderBeforeMapLifecycle();
    const nextImage = document.getElementById('sentinel-google-map');
    if (nextImage) {
      if (mapCanvas && nextImage !== mapCanvas) {
        const nextKey = nextImage.dataset.mapKey || '';
        if (mapCanvas.dataset.mapKey !== nextKey) {
          mapCanvas.dataset.mapKey = nextKey;
          mapCanvas.alt = nextImage.alt;
          mapCanvas.src = nextImage.getAttribute('src');
          const nextShell = nextImage.closest('.google-map-shell');
          if (nextShell) {
            nextShell.classList.remove('google-map-ready', 'google-map-error');
            const status = nextShell.querySelector('.map-api-status');
            if (status) status.textContent = `LOADING GOOGLE MAPS ${normalizedMapType().toUpperCase()} · OPERATIONAL OVERLAYS SIMULATED`;
          }
        }
        nextImage.replaceWith(mapCanvas);
      } else {
        mapCanvas = nextImage;
      }
      bindStaticMapImage(mapCanvas);
      if (mapCanvas.complete) setStaticMapStatus(mapCanvas, mapCanvas.naturalWidth > 0);
    }
    updateDispatcherBadge();
  };

  render();
  updateDispatcherBadge();
})();
