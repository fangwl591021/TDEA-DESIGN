(() => {
  if (window.__tdeaAdRewardHardStopInstalled) return;
  window.__tdeaAdRewardHardStopInstalled = true;

  function isMarqueeHref(raw = '') {
    if (!raw) return false;
    try {
      const url = new URL(raw, location.href);
      return url.searchParams.has('marquee') || /tdeawork\.fangwl591021\.workers\.dev\/\?marquee=1/i.test(url.toString());
    } catch {
      return false;
    }
  }

  function isRewardAnchor(anchor) {
    if (!(anchor instanceof HTMLAnchorElement)) return false;
    if (anchor.closest('.tdea-ad-card')) return true;
    return isMarqueeHref(anchor.getAttribute('href') || anchor.href || '');
  }

  function replaceAnchor(anchor) {
    if (!isRewardAnchor(anchor)) return anchor;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = anchor.className;
    button.innerHTML = anchor.innerHTML;
    button.dataset.directAdReward = '1';
    for (const { name, value } of [...anchor.attributes]) {
      if (name.startsWith('data-')) button.setAttribute(name, value);
      if (name === 'style' || name === 'aria-label' || name === 'title') button.setAttribute(name, value);
    }
    button.removeAttribute('href');
    button.removeAttribute('target');
    button.removeAttribute('rel');
    anchor.replaceWith(button);
    return button;
  }

  function sweep(root = document) {
    root.querySelectorAll?.('.tdea-ad-card a, a[href*="marquee=1"], a[href*="marquee%3D1"]').forEach(replaceAnchor);
  }

  function hardBlock(event) {
    const node = event.target instanceof Element ? event.target : null;
    const anchor = node?.closest('a[href]');
    if (!isRewardAnchor(anchor)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    const button = replaceAnchor(anchor);
    queueMicrotask(() => button?.click());
  }

  document.addEventListener('pointerdown', (event) => {
    const node = event.target instanceof Element ? event.target : null;
    const anchor = node?.closest('a[href]');
    if (!isRewardAnchor(anchor)) return;
    event.preventDefault();
    replaceAnchor(anchor);
  }, true);

  document.addEventListener('click', hardBlock, true);

  const observer = new MutationObserver(() => sweep());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['href', 'target'],
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => sweep(), { once: true });
  } else {
    sweep();
  }

  let runs = 0;
  const timer = setInterval(() => {
    sweep();
    runs += 1;
    if (runs >= 120) clearInterval(timer);
  }, 250);
})();
