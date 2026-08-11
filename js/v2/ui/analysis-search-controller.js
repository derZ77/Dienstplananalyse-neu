/** Search only changes visibility of the original result blocks; it never changes their data. */

const text = value => String(value ?? '').trim().toLocaleLowerCase('de-DE');

export function filterAnalysisBlocks(blocks, term) {
  const query = text(term);
  return (blocks || []).map(block => ({
    block,
    matches: !query || text(block?.textContent).includes(query)
  }));
}

export function initializeAnalysisSearch({ document = globalThis.document } = {}) {
  const input = document?.getElementById?.('search-input');
  const clear = document?.getElementById?.('search-clear');
  const info = document?.getElementById?.('search-info');
  if (!input || !info) return null;

  const resultIds = [
    'plan-type-result', 'count-result', 'shared-result', 'reserve-result', 'long-result',
    'loc-result', 'segment-result', 'real-driving-time-result', 'shift-result', 'route-result', 'pause-result'
  ];
  const blocks = [...new Set(resultIds
    .map(id => document.getElementById?.(id)?.parentElement)
    .filter(Boolean))];

  const apply = () => {
    const query = input.value.trim();
    const results = filterAnalysisBlocks(blocks, query);
    results.forEach(({ block, matches }) => { block.hidden = !matches; });
    const hitCount = results.filter(result => result.matches).length;
    if (!query) info.textContent = 'Geben Sie einen Suchbegriff ein, um die Ergebnis-Blöcke zu filtern.';
    else if (!hitCount) info.textContent = `Kein Block enthält „${query}“.`;
    else info.textContent = `${hitCount} ${hitCount === 1 ? 'Block enthält' : 'Blöcke enthalten'} „${query}“.`;
  };

  input.addEventListener('input', apply);
  clear?.addEventListener('click', () => { input.value = ''; apply(); input.focus(); });
  return { apply, clear: () => { input.value = ''; apply(); }, blocks };
}
