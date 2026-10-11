/* SENTINEL-X traceability: simulated signal lineage, human decision audit and read-only replay. */
(() => {
  'use strict';

  const auditRecords = [];
  const replayFrames = [];
  const REPLAY_LIMIT = 120;
  const AUDIT_LIMIT = 100;
  const FRESH_WINDOW_MS = 9000;
  let lastSignalSignature = '';
  let lastReplaySignature = '';
  let lastSignalUpdatedAt = Date.now();
  let lastObservedEvent = '';
  let lastObservedAlerts = '';
  let lastObservedDemo = '';
  let lastObservedAuditCount = 0;
  let replayIndex = 0;
  let replayTimer = null;
  let activeTraceTab = 'provenance';
  let nextFrameId = 1;

  const SOURCE_ROWS = [
    { key: 'personnel', label: 'Personnel / physiology', source: 'Local simulated roster + Digital Guardian', confidence: 96 },
    { key: 'equipment', label: 'Equipment health', source: 'Local simulated equipment diagnostics', confidence: 93 },
    { key: 'communications', label: 'Communications', source: 'Local simulated network monitor', confidence: 97 },
    { key: 'environment', label: 'Environment', source: 'Local simulated weather / terrain controls', confidence: 92 },
    { key: 'risk', label: 'Mission risk', source: 'SENTINEL-X transparent local heuristic', confidence: 91 },
  ];

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[char]);
  }

  function nowLabel() {
    try { return clock(); } catch { return new Date().toLocaleTimeString(); }
  }

  function currentAlerts() {
    return (state.alerts || []).filter((alert) => alert.status === 'ACTIVE');
  }

  function signalSignature() {
    return JSON.stringify({
      feedTicks: state.feedTicks,
      mission: [state.mission?.missionRisk, state.mission?.teamRisk, state.mission?.missionSafety],
      communication: [state.comm?.coverage, state.comm?.health, state.comm?.latency, state.comm?.packetLoss],
      environment: [state.env?.visibility, state.env?.temperature, state.env?.environmentRisk, state.env?.terrainStability],
      people: (state.people || []).map((person) => [person.id, person.risk, person.heartRate, person.fatigue, person.communication, person.movement]),
      equipment: (state.equipment || []).map((item) => [item.id, item.health, item.temperature, item.failureProbability]),
    });
  }

  function activeAlertSignature() {
    return currentAlerts().map((alert) => `${alert.id}:${alert.severity}:${alert.status}:${Boolean(alert.acknowledged)}`).join('|');
  }

  function replaySignature() {
    return JSON.stringify({
      signal: signalSignature(),
      events: (state.events || []).slice(0, 3).map((event) => [event.time, event.title, event.level]),
      alerts: (state.alerts || []).map((alert) => [alert.id, alert.severity, alert.status, Boolean(alert.acknowledged)]),
      demo: [state.demo?.running, state.demo?.paused, state.demo?.index],
      auditCount: auditRecords.length,
    });
  }

  function replayLabel() {
    const eventMark = (state.events || []).slice(0, 1).map((event) => `${event.time}|${event.title}`).join('');
    const alertMark = activeAlertSignature();
    const demoMark = `${Boolean(state.demo?.running)}|${state.demo?.index}`;

    let label = `LIVE TELEMETRY · TICK ${Number(state.feedTicks) || 0}`;
    if (auditRecords.length > lastObservedAuditCount) {
      const decision = auditRecords[0];
      label = `${decision.action} · ${decision.target}`;
    } else if (demoMark !== lastObservedDemo) {
      label = state.demo?.running ? `DEMO STAGE ${Number(state.demo.index) + 1}` : 'DEMO STATE UPDATE';
    } else if (alertMark !== lastObservedAlerts) {
      const alert = currentAlerts()[0];
      label = alert ? `INCIDENT · ${alert.title}` : 'INCIDENT STATUS CHANGED';
    } else if (eventMark && eventMark !== lastObservedEvent) {
      label = (state.events || [])[0]?.title || label;
    }

    lastObservedEvent = eventMark;
    lastObservedAlerts = alertMark;
    lastObservedDemo = demoMark;
    lastObservedAuditCount = auditRecords.length;
    return label;
  }

  function recordReplayFrame(forcedLabel = '') {
    const signature = replaySignature();
    if (signature === lastReplaySignature) return;
    lastReplaySignature = signature;

    const active = currentAlerts();
    const latestPeople = (state.people || []).filter((person) => person.risk >= 50).slice(0, 3);
    const recentEvents = (state.events || []).slice(0, 3).map((event) => ({
      title: String(event.title || 'Simulation event'),
      level: String(event.level || 'INFO'),
      time: String(event.time || nowLabel()),
    }));
    const frame = {
      id: nextFrameId++,
      at: new Date().toISOString(),
      clock: nowLabel(),
      label: forcedLabel || replayLabel(),
      missionRisk: Number(state.mission?.missionRisk) || 0,
      teamRisk: Number(state.mission?.teamRisk) || 0,
      missionSafety: Number(state.mission?.safety) || 0,
      communications: Number(state.comm?.health) || 0,
      coverage: Number(state.comm?.coverage) || 0,
      activeCount: active.length,
      personnelAtRisk: latestPeople.length,
      alerts: active.slice(0, 4).map((alert) => `${alert.severity} · ${alert.title}`),
      people: latestPeople.map((person) => `${person.id.replace('PERSONNEL-', 'S-')} · ${person.risk}% risk`),
      events: recentEvents,
      demoStage: state.demo?.running ? Number(state.demo.index) + 1 : null,
    };
    replayFrames.push(frame);
    if (replayFrames.length > REPLAY_LIMIT) replayFrames.splice(0, replayFrames.length - REPLAY_LIMIT);
  }

  function freshnessAgeSeconds() {
    return Math.max(0, Math.floor((Date.now() - lastSignalUpdatedAt) / 1000));
  }

  function updateSignalFreshness() {
    const signature = signalSignature();
    if (signature !== lastSignalSignature) {
      lastSignalSignature = signature;
      lastSignalUpdatedAt = Date.now();
    }
  }

  function updateTraceButton() {
    const signalContent = document.querySelector('[data-trace-signal-content]');
    if (signalContent) signalContent.innerHTML = provenanceContent();
    const button = document.querySelector('[data-action="trace-open"]');
    if (!button) return;
    const age = freshnessAgeSeconds();
    const status = age < FRESH_WINDOW_MS / 1000 ? 'FRESH' : 'STALE';
    button.textContent = `DATA ${status} · TRACE`;
    button.setAttribute('aria-label', `Open signal provenance, decision audit and incident replay. Data ${status.toLowerCase()}, last change ${age} seconds ago.`);
    button.title = `${status} simulated signals · updated ${age}s ago${state.livePaused ? ' · feed paused' : ''}`;
    button.dataset.freshness = status.toLowerCase();
  }

  function provenanceContent() {
    const age = freshnessAgeSeconds();
    const freshness = age < FRESH_WINDOW_MS / 1000 ? 'FRESH' : 'STALE';
    const updateTime = escapeHtml(new Date(lastSignalUpdatedAt).toLocaleTimeString());
    const rows = SOURCE_ROWS.map((source) => `<div class="trace-signal-row">
      <div><strong>${escapeHtml(source.label)}</strong><small>${escapeHtml(source.source)}</small></div>
      <div class="trace-signal-meta"><strong>${source.confidence}% confidence</strong><small>${freshness} · ${age}s ago · ${updateTime}</small></div>
    </div>`).join('');
    return `<div class="trace-readonly-note"><strong>SIMULATED DATA LINEAGE</strong><span>Every source shown here is local prototype data. Confidence is illustrative, not calibrated or operationally validated.</span></div>
      <div class="trace-signal-list">${rows}</div>
      <div class="trace-footnote">Freshness threshold: changed signal data within ${FRESH_WINDOW_MS / 1000} seconds. ${state.livePaused ? 'The simulated feed is paused; signals will age until refreshed or resumed.' : 'The simulated feed normally updates every 3 seconds.'}</div>`;
  }

  function auditContent() {
    if (!auditRecords.length) {
      return `<div class="empty-state trace-empty"><strong>No operator decisions recorded yet.</strong><span>Open an alert to acknowledge or escalate it, or confirm an existing simulated recommendation to create the first audit entry.</span><span class="trace-footnote">Session-only log · Demo operator · no production identity or external system.</span></div>`;
    }
    const rows = auditRecords.map((entry) => `<article class="trace-audit-row">
      <div class="trace-audit-top"><span class="state-chip ${entry.action === 'ESCALATE' ? 'amber' : entry.action === 'APPROVE' ? 'green' : 'blue'}">${escapeHtml(entry.action)}</span><time>${escapeHtml(entry.time)}</time></div>
      <strong>${escapeHtml(entry.target)}</strong>
      <div class="trace-audit-result"><span>BEFORE</span> ${escapeHtml(entry.before)} <span>→ AFTER</span> ${escapeHtml(entry.after)}</div>
      <small>${escapeHtml(entry.actor)} · ${escapeHtml(entry.note)}</small>
    </article>`).join('');
    return `<div class="trace-readonly-note"><strong>HUMAN DECISIONS · SESSION ONLY</strong><span>Only confirmed actions are recorded. This local prototype does not authenticate a real operator.</span></div>
      <div class="trace-audit-list">${rows}</div>`;
  }

  function replayFrameMarkup() {
    const frame = replayFrames[replayIndex];
    if (!frame) return `<div class="empty-state"><strong>No replay frames available.</strong><span>Frames appear as the local simulation changes.</span></div>`;
    const recent = frame.events.length ? frame.events.map((event) => `<div class="trace-frame-event"><span>${escapeHtml(event.time)} · ${escapeHtml(event.level)}</span><strong>${escapeHtml(event.title)}</strong></div>`).join('') : '<div class="trace-frame-event"><strong>Baseline state</strong></div>';
    const alerts = frame.alerts.length ? frame.alerts.map((alert) => `<span class="trace-frame-pill">${escapeHtml(alert)}</span>`).join('') : '<span class="trace-frame-pill">No active simulated alerts</span>';
    const people = frame.people.length ? frame.people.map((person) => `<span class="trace-frame-pill">${escapeHtml(person)}</span>`).join('') : '<span class="trace-frame-pill">No personnel above the risk watch threshold</span>';
    return `<div class="trace-frame-heading"><strong>${escapeHtml(frame.label)}</strong><time>${escapeHtml(frame.clock)} · ${escapeHtml(new Date(frame.at).toLocaleDateString())}</time></div>
      <div class="trace-frame-stats">
        <div class="trace-frame-stat"><span>MISSION RISK</span><strong>${frame.missionRisk}%</strong></div>
        <div class="trace-frame-stat"><span>TEAM RISK</span><strong>${frame.teamRisk}%</strong></div>
        <div class="trace-frame-stat"><span>COMMUNICATIONS</span><strong>${frame.communications}%</strong></div>
        <div class="trace-frame-stat"><span>MISSION SAFETY</span><strong>${frame.missionSafety}%</strong></div>
        <div class="trace-frame-stat"><span>ACTIVE INCIDENTS</span><strong>${frame.activeCount}</strong></div>
        <div class="trace-frame-stat"><span>RISK-WATCH PERSONNEL</span><strong>${frame.personnelAtRisk}</strong></div>
      </div>
      <div class="trace-frame-section"><span>ACTIVE SIMULATED INCIDENTS</span><div>${alerts}</div></div>
      <div class="trace-frame-section"><span>PERSONNEL WATCH</span><div>${people}</div></div>
      <div class="trace-frame-section"><span>EVENTS NEAR THIS FRAME</span>${recent}</div>
      <div class="trace-footnote">READ-ONLY SIMULATION · Scrubbing never changes the current live dashboard or sends a command.</div>`;
  }

  function refreshReplayFrame() {
    replayIndex = Math.max(0, Math.min(replayFrames.length - 1, replayIndex));
    const range = document.querySelector('[data-trace-scrub]');
    const position = document.querySelector('[data-trace-position]');
    const details = document.querySelector('[data-trace-frame-details]');
    const play = document.querySelector('[data-action="trace-play"]');
    if (range) {
      range.max = String(Math.max(0, replayFrames.length - 1));
      range.value = String(replayIndex);
      range.setAttribute('aria-valuetext', `Frame ${replayIndex + 1} of ${replayFrames.length}`);
    }
    if (position) position.textContent = `FRAME ${replayIndex + 1} / ${replayFrames.length}`;
    if (details) details.innerHTML = replayFrameMarkup();
    if (play) play.textContent = replayTimer ? 'PAUSE' : 'PLAY';
  }

  function stopReplay() {
    if (replayTimer) window.clearInterval(replayTimer);
    replayTimer = null;
    refreshReplayFrame();
  }

  function stepReplay(delta) {
    if (!replayFrames.length) return;
    replayIndex = Math.max(0, Math.min(replayFrames.length - 1, replayIndex + delta));
    refreshReplayFrame();
  }

  function toggleReplay() {
    if (replayTimer) {
      stopReplay();
      return;
    }
    if (replayIndex >= replayFrames.length - 1) replayIndex = 0;
    replayTimer = window.setInterval(() => {
      if (!document.querySelector('[data-trace-modal]')) {
        stopReplay();
        return;
      }
      if (replayIndex >= replayFrames.length - 1) {
        stopReplay();
        return;
      }
      replayIndex += 1;
      refreshReplayFrame();
    }, 1100);
    refreshReplayFrame();
  }

  function stateSummary(target) {
    const alert = (state.alerts || []).find((item) => String(item.id) === String(target) || item.title === target);
    if (alert) return `${alert.severity} · ${alert.status}${alert.acknowledged ? ' · ACKNOWLEDGED' : ''}`;
    return `MISSION RISK ${state.mission.missionRisk}% · COMMS ${state.comm.coverage}%`;
  }

  function recordDecision(action, target, before, after, note) {
    auditRecords.unshift({
      id: `AUD-${Date.now()}-${auditRecords.length}`,
      actor: 'DEMO OPERATOR',
      action,
      target: String(target || 'Mission response'),
      before: String(before || '—'),
      after: String(after || '—'),
      note: String(note || 'Confirmed in local simulation.'),
      time: nowLabel(),
      at: new Date().toISOString(),
    });
    if (auditRecords.length > AUDIT_LIMIT) auditRecords.splice(AUDIT_LIMIT);
    updateTraceButton();
  }

  function classifyDecision(title, text) {
    const normalized = String(title || '').toUpperCase();
    const quotedTarget = String(text || '').match(/[“"]([^”"]+)[”"]/);
    const target = quotedTarget?.[1] || 'Mission response';
    if (normalized === 'DISMISS SIMULATED ALERT') return { action: 'ACKNOWLEDGE', target, note: 'Alert reviewed and dismissed after explicit confirmation.' };
    if (normalized === 'HUMAN APPROVAL REQUIRED') return { action: 'APPROVE', target, note: 'Simulated recommendation approved after explicit human confirmation.' };
    if (normalized === 'CASCADEGUARD · HUMAN REVIEW') return { action: 'APPROVE', target: 'CASCADEGUARD prevention step', note: 'Simulated intervention approved after explicit human confirmation.' };
    if (normalized === 'ESCALATE SIMULATED INCIDENT') return { action: 'ESCALATE', target, note: 'Simulated incident severity escalated after explicit confirmation.' };
    return null;
  }

  const confirmBeforeTrace = confirmAction;
  confirmAction = function confirmActionWithAudit(title, text, confirmLabel, callback, kind = 'primary') {
    const decision = classifyDecision(title, text);
    if (!decision || typeof callback !== 'function') return confirmBeforeTrace(title, text, confirmLabel, callback, kind);
    const before = stateSummary(decision.target);
    return confirmBeforeTrace(title, text, confirmLabel, () => {
      callback();
      const after = stateSummary(decision.target);
      recordDecision(decision.action, decision.target, before, after, decision.note);
      render();
    }, kind);
  };

  const showAlertDetailBeforeTrace = showAlertDetail;
  showAlertDetail = function showAlertDetailWithDecisionControls(id) {
    showAlertDetailBeforeTrace(id);
    const alert = (state.alerts || []).find((item) => String(item.id) === String(id));
    const modal = document.querySelector('#modal-root .modal');
    const actions = modal?.querySelector('.modal-actions');
    if (!alert || !actions) return;

    const acknowledge = document.createElement('button');
    acknowledge.type = 'button';
    acknowledge.className = 'btn small ghost trace-decision-button';
    acknowledge.dataset.action = 'trace-acknowledge';
    acknowledge.dataset.id = String(alert.id);
    acknowledge.textContent = alert.acknowledged ? 'ACKNOWLEDGED' : 'ACKNOWLEDGE';
    acknowledge.disabled = alert.acknowledged || alert.status !== 'ACTIVE';

    const severityOrder = { INFO: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 };
    const escalate = document.createElement('button');
    escalate.type = 'button';
    escalate.className = 'btn small warn trace-decision-button';
    escalate.dataset.action = 'trace-escalate';
    escalate.dataset.id = String(alert.id);
    escalate.textContent = 'ESCALATE';
    escalate.disabled = alert.status !== 'ACTIVE' || (severityOrder[alert.severity] ?? 0) >= severityOrder.CRITICAL;

    actions.prepend(escalate);
    actions.prepend(acknowledge);
    if (alert.acknowledged) {
      const body = modal.querySelector('.modal-body');
      const note = document.createElement('div');
      note.className = 'trace-readonly-note trace-ack-note';
      note.innerHTML = `<strong>ACKNOWLEDGED BY DEMO OPERATOR</strong><span>${escapeHtml(alert.acknowledgedAt || 'Earlier this session')} · active status is unchanged until separately resolved.</span>`;
      body?.append(note);
    }
  };

  function acknowledgeAlert(id) {
    const alert = (state.alerts || []).find((item) => String(item.id) === String(id));
    if (!alert || alert.status !== 'ACTIVE' || alert.acknowledged) return;
    const before = stateSummary(alert.title);
    alert.acknowledged = true;
    alert.acknowledgedAt = nowLabel();
    alert.acknowledgedBy = 'DEMO OPERATOR';
    state.events.unshift({ time: nowLabel(), title: `Operator acknowledged ${alert.title}`, level: 'HUMAN REVIEW', source: 'DEMO OPERATOR (SIMULATED)' });
    state.events = state.events.slice(0, 12);
    closeModal();
    render();
    const after = stateSummary(alert.title);
    recordDecision('ACKNOWLEDGE', alert.title, before, after, 'Alert acknowledged; it remains active until separately resolved.');
    render();
    notify('ALERT ACKNOWLEDGED · SESSION AUDIT UPDATED');
  }

  function escalateAlert(id) {
    const alert = (state.alerts || []).find((item) => String(item.id) === String(id));
    if (!alert || alert.status !== 'ACTIVE') return;
    const order = ['INFO', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
    const oldSeverity = alert.severity;
    const nextSeverity = order[Math.min(order.indexOf(oldSeverity) + 1, order.length - 1)] || 'HIGH';
    if (nextSeverity === oldSeverity) return;
    confirmAction('ESCALATE SIMULATED INCIDENT', `Increase “${alert.title}” from ${oldSeverity} to ${nextSeverity}? This changes only the local demo state and will be written to the operator audit trail.`, 'CONFIRM ESCALATION', () => {
      alert.severity = nextSeverity;
      alert.escalatedAt = nowLabel();
      alert.escalatedBy = 'DEMO OPERATOR';
      state.events.unshift({ time: nowLabel(), title: `Operator escalated ${alert.title} to ${nextSeverity}`, level: 'HUMAN REVIEW', source: 'DEMO OPERATOR (SIMULATED)' });
      state.events = state.events.slice(0, 12);
      closeModal();
      derive();
      render();
      notify('SIMULATED ALERT ESCALATED · SESSION AUDIT UPDATED', 'warning');
    }, 'warn');
  }

  const handleActionBeforeTrace = handleAction;
  handleAction = function handleTraceActions(action, target) {
    if (action === 'trace-open') { openTrace('provenance'); return; }
    if (action === 'trace-tab') { openTrace(target?.dataset?.tab); return; }
    if (action === 'trace-acknowledge') { acknowledgeAlert(target?.dataset?.id); return; }
    if (action === 'trace-escalate') { escalateAlert(target?.dataset?.id); return; }
    if (action === 'trace-prev') { stepReplay(-1); return; }
    if (action === 'trace-next') { stepReplay(1); return; }
    if (action === 'trace-play') { toggleReplay(); return; }
    if (action === 'close-modal' || action === 'backdrop-close' || action === 'confirm-local') stopReplay();
    handleActionBeforeTrace(action, target);
  };

  function replayPanelContent() {
    const count = replayFrames.length;
    const max = Math.max(0, count - 1);
    return `<div class="trace-replay-status"><span>READ-ONLY SIMULATION</span><span data-trace-position>FRAME ${replayIndex + 1} / ${count}</span></div>
      <label class="trace-scrub-label" for="trace-replay-scrubber">Scrub through recorded incident frames</label>
      <input id="trace-replay-scrubber" class="trace-replay-scrubber" type="range" min="0" max="${max}" value="${replayIndex}" data-trace-scrub aria-label="Incident replay timeline">
      <div class="trace-replay-controls"><button class="btn small ghost" data-action="trace-prev">PREVIOUS</button><button class="btn small primary" data-action="trace-play">PLAY</button><button class="btn small ghost" data-action="trace-next">NEXT</button></div>
      <div data-trace-frame-details>${replayFrameMarkup()}</div>`;
  }

  function openTrace(tab = 'provenance') {
    stopReplay();
    activeTraceTab = ['provenance', 'audit', 'replay'].includes(tab) ? tab : 'provenance';
    if (activeTraceTab === 'replay') replayIndex = 0;
    const tabs = [
      ['provenance', 'SIGNAL SOURCES'],
      ['audit', 'DECISION AUDIT'],
      ['replay', 'INCIDENT REPLAY'],
    ].map(([key, label]) => `<button class="btn small ${activeTraceTab === key ? 'primary' : 'ghost'} trace-tab" data-action="trace-tab" data-tab="${key}">${label}</button>`).join('');
    const content = activeTraceTab === 'provenance' ? `<div data-trace-signal-content>${provenanceContent()}</div>`
      : activeTraceTab === 'audit' ? auditContent()
        : replayPanelContent();
    openModal('MISSION TRACE · SIMULATION', `<div class="trace-view" data-trace-modal><div class="trace-tabs" role="tablist" aria-label="Mission trace views">${tabs}</div><div class="trace-content">${content}</div></div>`, [
      { label: 'CLOSE', action: 'close-modal', className: 'ghost' },
    ]);
    updateTraceButton();
    if (activeTraceTab === 'replay') refreshReplayFrame();
  }

  function captureReplay() {
    const previousLength = replayFrames.length;
    const wasFollowingLatest = replayIndex >= previousLength - 1;
    recordReplayFrame();
    if (replayFrames.length > previousLength && wasFollowingLatest) replayIndex = replayFrames.length - 1;
    else replayIndex = Math.max(0, Math.min(replayFrames.length - 1, replayIndex));
    if (activeTraceTab === 'replay') refreshReplayFrame();
  }

  // Reuse the existing Command Center ribbon; no navigation or dashboard grid changes.
  const renderCommandBeforeTrace = renderCommand;
  renderCommand = function renderCommandWithTraceAccess() {
    let html = renderCommandBeforeTrace();
    html = html.replace('<span class="state-chip">OPERATOR VIEW</span>', '<span class="state-chip">OPERATOR VIEW</span><button class="link-button trace-access" type="button" data-action="trace-open" aria-label="Open signal provenance, decision audit and incident replay">DATA FRESH · TRACE</button>');
    return html;
  };

  const renderBeforeTrace = render;
  render = function renderWithTraceability() {
    renderBeforeTrace();
    updateSignalFreshness();
    captureReplay();
    updateTraceButton();
  };

  document.addEventListener('input', (event) => {
    const slider = event.target.closest('[data-trace-scrub]');
    if (!slider) return;
    replayIndex = Number(slider.value) || 0;
    refreshReplayFrame();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopReplay();
  });

  lastSignalSignature = signalSignature();
  lastSignalUpdatedAt = Date.now();
  lastReplaySignature = '';
  recordReplayFrame('BASELINE · INITIAL SIMULATION');
  render();
  window.setInterval(updateTraceButton, 5000);
})();
