(() => {
  let applied = false;

  const selectActivitiesOnce = () => {
    if (applied) return true;
    const button = document.querySelector('[data-daily-panel="activities"]');
    if (!button) return false;

    applied = true;
    if (!button.classList.contains('active')) button.click();
    return true;
  };

  if (selectActivitiesOnce()) return;

  const observer = new MutationObserver(() => {
    if (selectActivitiesOnce()) observer.disconnect();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('load', selectActivitiesOnce, { once: true });
})();
