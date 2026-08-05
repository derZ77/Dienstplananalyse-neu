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

export function renderOriginalBlocks(blocks, { document = globalThis.document } = {}) {
  if (!blocks || !document?.getElementById) return;
  for (const [id, field] of Object.entries(TEXT_TARGETS)) {
    const target = document.getElementById(id);
    if (target) target.textContent = String(blocks[field] ?? '');
  }
  const plan = document.getElementById('current-plan-display');
  if (plan) plan.textContent = `Aktueller Plan: ${blocks.planHinweis || ''}`;
}

export function clearOriginalBlocks({ document = globalThis.document } = {}) {
  if (!document?.getElementById) return;
  for (const id of Object.keys(TEXT_TARGETS)) {
    const target = document.getElementById(id);
    if (target) target.textContent = '-';
  }
}
