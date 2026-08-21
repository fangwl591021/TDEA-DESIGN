(() => {
  if (window.__tdeaAdRewardButtonInjectInstalled) return;
  window.__tdeaAdRewardButtonInjectInstalled = true;

  function directChildHost(card) {
    for (const child of Array.from(card.children || [])) {
      if (child && child.tagName === 'DIV') return child;
    }
    return card;
  }

  function ensureButton(card) {
    if (!(card instanceof Element) || !card.matches('.tdea-ad-card')) return;
    if (card.querySelector('[data-direct-ad-reward]')) return;

    const image = card.querySelector('img');
    const title = card.querySelector('strong')?.textContent?.trim() || image?.alt?.trim() || 'TDEA 廣告贈點';
    const host = directChildHost(card);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn';
    button.dataset.directAdReward = '1';
    button.dataset.imageUrl = image?.currentSrc || image?.src || '';
    button.dataset.adTitle = title;
    button.textContent = '開啟廣告贈點';
    host.appendChild(button);
  }

  function sweep(root = document) {
    try {
      if (root instanceof Element && root.matches('.tdea-ad-card')) ensureButton(root);
      root.querySelectorAll?.('.tdea-ad-card').forEach(ensureButton);
    } catch (error) {
      console.warn('TDEA ad reward button injection failed', error);
    }
  }

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) sweep(node);
      }
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  const start = () => {
    sweep();
    let runs = 0;
    const timer = setInterval(() => {
      sweep();
      runs += 1;
      if (runs >= 80) clearInterval(timer);
    }, 250);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
