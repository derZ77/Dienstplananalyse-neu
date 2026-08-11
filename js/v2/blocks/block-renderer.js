/** Writes the existing Original-PWA result IDs; no source-specific UI exists here. */

const TEXT_TARGETS = Object.freeze({
  'plan-type-result': 'planTypeText',
  'count-result': 'countText',
  'shared-result': 'sharedText',
  'reserve-result': 'reserveText',
  'long-result': 'longText',
  'loc-result': 'locText',
  'segment-result': 'segmentText',
  'real-driving-time-result': 'realDrivingTimeText',
  'shift-result': 'shiftText',
  'route-result': 'routeText',
  'pause-result': 'pauseHtml'
});
const HTML_TARGETS = Object.freeze({
  'shift-result': 'shiftHtml'
});

export function renderOriginalBlocks(blocks, { document = globalThis.document } = {}) {
  if (!blocks || !document?.getElementById) return;
  for (const [id, field] of Object.entries(TEXT_TARGETS)) {
    const target = document.getElementById(id);
    if (!target) continue;
    const htmlField = HTML_TARGETS[id];
    if (htmlField && blocks[htmlField]) target.innerHTML = String(blocks[htmlField]);
    // Lightweight test/document facades retain the legacy textContent contract.
    else if (typeof target.innerHTML === 'string') target.innerHTML = renderExistingStatusText(blocks[field]);
    else target.textContent = String(blocks[field] ?? '');
  }
  const plan = document.getElementById('current-plan-display');
  if (plan) plan.textContent = `Aktueller Plan: ${blocks.planHinweis || ''}`;
}

/**
 * Presentation only: the migrated blocks already carry their assessed wording.
 * We escape every character first and only group existing paragraphs by that wording;
 * no threshold, status or business rule is calculated here.
 */
export function renderExistingStatusText(value) {
  const safe = escapeHtml(String(value ?? ''));
  return safe.split(/\n{2,}/).map(paragraph => {
    const statusClass = blockStatusClass(paragraph);
    return `<div class="result-status ${statusClass}">${paragraph.replace(/\n/g, '<br>')}</div>`;
  }).join('');
}

function blockStatusClass(text) {
  if (/BV-Verstoß|nicht zulässig|nicht BV-konform/i.test(text)) return 'status-fail';
  if (/Prüfung erforderlich|nicht abschließend/i.test(text)) return 'status-warning';
  if (/BV eingehalten|zulässiger 1\/6-Dienst|BV-konform/i.test(text)) return 'status-pass';
  if (/Nicht anwendbar|keine .*Bewertung|übersprungen/i.test(text)) return 'status-neutral';
  return 'status-info';
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

export function clearOriginalBlocks({ document = globalThis.document } = {}) {
  if (!document?.getElementById) return;
  for (const id of Object.keys(TEXT_TARGETS)) {
    const target = document.getElementById(id);
    if (target) target.textContent = '-';
  }
}
