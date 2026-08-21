(() => {
  if (window.__tdeaAdRewardButtonInjectInstalled) return;
  window.__tdeaAdRewardButtonInjectInstalled = true;

  function ensureButton(card) {
    if (!(card instanceof Element) || !card.matches('.tdea-ad-card')) return;
    if (card.querySelector('[data-direct-ad-reward]')) return;

    // 舊導頁網址已由後端拿掉；這裡只補一顆純 button，不帶 href/target/rel。
    const host = card.querySelector(':scope > div') || card;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.dataset.directAdReward = '1';
    button.textContent = '開啟廣告贈點';
    host.appendChild(button);
  }

  function sweep(root = document) {
    if (root instanceof Element && root.matches('.tdea-ad-card')) ensureButton(root);
    root.querySelectorAll?.('.tdea-ad-card').forEach(ensureButton);
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) sweep(node);
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => sweep(), { once: true });
  } else {
    sweep();
  }
})();
