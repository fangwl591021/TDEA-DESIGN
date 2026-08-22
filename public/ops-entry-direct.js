(() => {
  if (window.__tdeaOpsEntryDirectInstalled) return;
  window.__tdeaOpsEntryDirectInstalled = true;

  function isOpsControl(node) {
    if (!(node instanceof Element)) return false;
    const text = String(node.textContent || '').trim();
    return text === '營運管理後台' || node.dataset.opsEntry === '1';
  }

  function patchControl(node) {
    if (!isOpsControl(node)) return;
    node.dataset.opsEntry = '1';
    if (node.matches('a')) {
      node.setAttribute('href', '/ops');
      node.removeAttribute('target');
      node.removeAttribute('rel');
    }
  }

  function sweep(root = document) {
    if (root instanceof Element && isOpsControl(root)) patchControl(root);
    root.querySelectorAll?.('a,button').forEach((node) => {
      if (isOpsControl(node)) patchControl(node);
    });
  }

  document.addEventListener('click', (event) => {
    const node = event.target instanceof Element ? event.target.closest('a,button') : null;
    if (!isOpsControl(node)) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    location.assign('/ops');
  }, true);

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
