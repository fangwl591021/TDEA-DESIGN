(() => {
  if (window.__tdeaAdRewardButtonEnsureV4Installed) return;
  window.__tdeaAdRewardButtonEnsureV4Installed = true;

  const CONFIG_URL = 'https://tdeawork.fangwl591021.workers.dev/api/marquee';
  let enabled = true;
  let label = '點我贈點';
  let points = 1;

  function cardHost(card) {
    const directDiv = Array.from(card.children || []).find((node) => node instanceof HTMLDivElement);
    return directDiv || card;
  }

  function syncCard(card) {
    if (!(card instanceof Element) || !card.matches('.tdea-ad-card')) return;

    const existing = card.querySelector('[data-direct-ad-reward]');
    if (!enabled) {
      existing?.remove();
      return;
    }

    const copy = card.querySelector('span');
    if (copy) copy.textContent = `點擊廣告每日可獲 ${points} 點`;

    let button = existing;
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'btn';
      button.dataset.directAdReward = '1';
      cardHost(card).appendChild(button);
    }

    button.type = 'button';
    button.textContent = label;
    button.removeAttribute('href');
    button.removeAttribute('target');
    button.removeAttribute('rel');
  }

  function sweep(root = document) {
    if (root instanceof Element && root.matches('.tdea-ad-card')) syncCard(root);
    root.querySelectorAll?.('.tdea-ad-card').forEach(syncCard);
  }

  async function loadConfig() {
    try {
      const response = await fetch(`${CONFIG_URL}?_=${Date.now()}`, {
        cache: 'no-store',
        credentials: 'omit',
      });
      const payload = await response.json().catch(() => ({}));
      const left = payload?.data?.left || {};
      enabled = left.enabled !== false;
      const nextLabel = String(left.label || '').trim();
      if (nextLabel) label = nextLabel;
      const nextPoints = Number(left.points);
      if (Number.isFinite(nextPoints) && nextPoints > 0) points = Math.round(nextPoints);
    } catch {}
    sweep();
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) sweep(node);
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  sweep();
  loadConfig();

  let runs = 0;
  const timer = setInterval(() => {
    sweep();
    runs += 1;
    if (runs >= 40) clearInterval(timer);
  }, 250);
})();
