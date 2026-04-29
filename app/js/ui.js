/*
 * ui.js — UI utilities for GPRTool
 *
 * Covers: header clock, alarm, feedback bar, collapsible section headers.
 * No THREE.js dependency. No coordinate logic.
 *
 * Call initUI() once after body.html is injected into the DOM.
 */

import { state } from './state.js';

// ── Header clock ──────────────────────────────────────────────────────────

function updateHeaderTime() {
  const el = document.getElementById('header-datetime');
  if (!el) return;
  const now = new Date();
  const d   = now.getDate();
  const mo  = now.toLocaleDateString('en-GB', { month: 'short' });
  const y   = now.getFullYear();
  const hh  = String(now.getHours()).padStart(2, '0');
  const mm  = String(now.getMinutes()).padStart(2, '0');
  const ss  = String(now.getSeconds()).padStart(2, '0');
  el.textContent = `${d} ${mo} ${y}  ${hh}:${mm}:${ss}`;
}

// ── Alarm ─────────────────────────────────────────────────────────────────

function setAlarm(timeStr) {
  const [h, m] = timeStr.split(':').map(Number);
  state.alarmTime = new Date();
  state.alarmTime.setHours(h, m, 0, 0);
  if (state.alarmTime <= new Date()) state.alarmTime.setDate(state.alarmTime.getDate() + 1);
  document.getElementById('header-datetime').classList.add('alarm-active');
  if (state.alarmInterval) clearInterval(state.alarmInterval);
  state.alarmInterval = setInterval(() => {
    if (state.alarmTime && new Date() >= state.alarmTime) triggerAlarm();
  }, 1000);
}

function triggerAlarm() {
  state.isRinging = true;
  const el = document.getElementById('header-datetime');
  el.classList.remove('alarm-active');
  el.classList.add('alarm-ringing');
  clearInterval(state.alarmInterval);
  state.alarmInterval = null;
}

function stopAlarm() {
  state.isRinging = false;
  const el = document.getElementById('header-datetime');
  el.classList.remove('alarm-ringing', 'alarm-active');
  state.alarmTime = null;
  if (state.alarmInterval) { clearInterval(state.alarmInterval); state.alarmInterval = null; }
}

function clearAlarm() {
  document.getElementById('header-datetime').classList.remove('alarm-active');
  state.alarmTime = null;
  if (state.alarmInterval) { clearInterval(state.alarmInterval); state.alarmInterval = null; }
}

// ── Feedback bar ──────────────────────────────────────────────────────────

export function showFeedback(message, duration = 3000) {
  const el = document.getElementById('status-message');
  if (!el) return;
  el.textContent = message;
  if (state.feedbackTimer) clearTimeout(state.feedbackTimer);
  if (duration > 0) state.feedbackTimer = setTimeout(() => { el.textContent = 'Ready'; }, duration);
}

// ── Pipeline status chip (header, next to title) ──────────────────────────
// States: 'idle' | 'busy' | 'done' | 'error'
// Message is persistent until next call — unlike showFeedback which clears.

export function setPipelineStatus(message, chipState = 'idle') {
  const el = document.getElementById('pipeline-status');
  if (!el) return;
  el.textContent = message;
  el.dataset.state = chipState;
}

/**
 * Set pipeline stage state in the left panel.
 * @param {'locate'|'extract'} stageId
 * @param {'pending'|'active'|'done'|'locked'} stageState
 * @param {string} [statusText]
 */
export function setStage(stageId, stageState, statusText) {
  const el = document.getElementById(`stage-${stageId}`);
  if (el) {
    el.dataset.state = stageState;
    el.dataset.stage = stageState; // CSS uses [data-stage=...] for visual styling
  }
  const btn = el?.querySelector('.stage-btn');
  if (btn) btn.disabled = (stageState === 'locked');
  const statusEl = document.getElementById(`stage-${stageId}-status`);
  if (statusEl && statusText !== undefined) statusEl.textContent = statusText;
}

// ── Init ──────────────────────────────────────────────────────────────────

export function initUI() {
  // Clock
  updateHeaderTime();
  setInterval(updateHeaderTime, 1000);

  // Alarm popup on clock click
  document.getElementById('header-datetime').addEventListener('click', () => {
    if (state.isRinging) { stopAlarm(); return; }
    let popup = document.getElementById('alarm-popup');
    if (popup) { popup.remove(); return; }
    popup = document.createElement('div');
    popup.className = 'alarm-popup';
    popup.id = 'alarm-popup';
    popup.innerHTML = `
      <h4>Set Alarm</h4>
      <input type="time" id="alarm-time-input" />
      <button id="set-alarm-btn">Set Alarm</button>
      <button id="cancel-alarm-btn" style="background:var(--chrome-border);margin-top:4px">Cancel</button>`;
    document.body.appendChild(popup);
    const now = new Date();
    document.getElementById('alarm-time-input').value =
      `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    document.getElementById('set-alarm-btn').addEventListener('click', () => {
      const t = document.getElementById('alarm-time-input').value;
      if (t) { setAlarm(t); popup.remove(); }
    });
    document.getElementById('cancel-alarm-btn').addEventListener('click', () => {
      clearAlarm(); popup.remove();
    });
  });

  // Close dropdown menus after any item is clicked
  document.querySelectorAll('.dropdown-menu a').forEach(a => {
    a.addEventListener('click', () => {
      // Force all menus closed by briefly disabling pointer events on menu-items
      document.querySelectorAll('.menu-item').forEach(mi => {
        mi.style.pointerEvents = 'none';
        setTimeout(() => mi.style.pointerEvents = '', 200);
      });
    });
  });

  // Collapsible section headers
  document.querySelectorAll('.section-header').forEach(hdr =>
    hdr.addEventListener('click', () => hdr.closest('.command-section').classList.toggle('collapsed'))
  );
}
