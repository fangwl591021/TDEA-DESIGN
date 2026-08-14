(() => {
  let busy = false;
  const sessionToken = () => localStorage.getItem('klinkweb_session') || '';

  function ensureNoticeStyles() {
    if (document.getElementById('tdea-checkin-notice-style')) return;
    const style = document.createElement('style');
    style.id = 'tdea-checkin-notice-style';
    style.textContent = `
      .tdea-checkin-notice{position:fixed;inset:0;z-index:99999;display:grid;place-items:center;padding:24px;background:rgba(18,22,20,.56);backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px);animation:tdeaCheckinFade .18s ease-out}
      .tdea-checkin-notice[hidden]{display:none!important}
      .tdea-checkin-notice-card{width:min(352px,calc(100vw - 40px));background:#fff;border-radius:26px;padding:28px 24px 22px;text-align:center;box-shadow:0 24px 64px rgba(0,0,0,.22);animation:tdeaCheckinPop .24s cubic-bezier(.2,.9,.28,1.1)}
      .tdea-checkin-icon{width:72px;height:72px;margin:0 auto 18px;border-radius:50%;display:grid;place-items:center;font-size:38px;font-weight:900}
      .tdea-checkin-notice.success .tdea-checkin-icon{background:#e8f7ef;color:#18a466}
      .tdea-checkin-notice.done .tdea-checkin-icon{background:#fff2e8;color:#d9772a}
      .tdea-checkin-notice.error .tdea-checkin-icon{background:#feeceb;color:#c64840}
      .tdea-checkin-title{margin:0;color:#202522;font-size:22px;line-height:1.3;font-weight:800;letter-spacing:.01em}
      .tdea-checkin-points{margin-top:14px;color:#169b61;font-size:42px;line-height:1;font-weight:900;letter-spacing:-.03em}
      .tdea-checkin-message{margin:14px 0 0;color:#6f7772;font-size:15px;line-height:1.65}
      .tdea-checkin-balance{margin:16px auto 0;width:100%;padding:13px 16px;border-radius:14px;background:#f7f8f7;color:#4f5752;font-size:14px}
      .tdea-checkin-balance strong{margin-left:6px;color:#202522;font-size:17px}
      .tdea-checkin-confirm{width:100%;height:50px;margin-top:22px;border:0;border-radius:15px;background:#18a466;color:#fff;font-size:16px;font-weight:800;cursor:pointer}
      .tdea-checkin-notice.done .tdea-checkin-confirm{background:#d9772a}
      .tdea-checkin-notice.error .tdea-checkin-confirm{background:#6b716d}
      @keyframes tdeaCheckinFade{from{opacity:0}to{opacity:1}}
      @keyframes tdeaCheckinPop{from{opacity:0;transform:scale(.92) translateY(10px)}to{opacity:1;transform:scale(1) translateY(0)}}
      @media (prefers-reduced-motion:reduce){.tdea-checkin-notice,.tdea-checkin-notice-card{animation:none}}
    `;
    document.head.appendChild(style);
  }

  function closeNotice() {
    document.querySelector('.tdea-checkin-notice')?.remove();
  }

  function showNotice({ type = 'success', title, points = null, message = '', balance = null, buttonText = '我知道了' }) {
    ensureNoticeStyles();
    closeNotice();
    const modal = document.createElement('div');
    modal.className = `tdea-checkin-notice ${type}`;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', title || '簽到通知');
    const icon = type === 'success' ? '✓' : type === 'done' ? '✓' : '!';
    const pointsMarkup = points === null ? '' : `<div class="tdea-checkin-points">+${Number(points) || 0} 點</div>`;
    const balanceMarkup = balance === null || balance === undefined
      ? ''
      : `<div class="tdea-checkin-balance">目前點數 <strong>${new Intl.NumberFormat('zh-TW').format(Number(balance) || 0)} 點</strong></div>`;
    modal.innerHTML = `
      <div class="tdea-checkin-notice-card">
        <div class="tdea-checkin-icon" aria-hidden="true">${icon}</div>
        <h2 class="tdea-checkin-title">${title || ''}</h2>
        ${pointsMarkup}
        <p class="tdea-checkin-message">${message || ''}</p>
        ${balanceMarkup}
        <button type="button" class="tdea-checkin-confirm">${buttonText}</button>
      </div>`;
    modal.querySelector('.tdea-checkin-confirm')?.addEventListener('click', closeNotice);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeNotice();
    });
    document.body.appendChild(modal);
    modal.querySelector('.tdea-checkin-confirm')?.focus({ preventScroll: true });
  }

  function updateVisibleBalance(balance) {
    if (balance === undefined || balance === null) return;
    const formatted = new Intl.NumberFormat('zh-TW').format(Number(balance) || 0);
    document.querySelectorAll('.ak-point-card strong').forEach((node) => {
      node.textContent = formatted;
    });
  }

  async function dailyCheckin(button) {
    if (busy) return;
    busy = true;
    const originalDisabled = Boolean(button?.disabled);
    if (button) {
      button.disabled = true;
      button.setAttribute('aria-busy', 'true');
    }
    try {
      const response = await fetch('/v1/daily-checkin', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'content-type': 'application/json',
          ...(sessionToken() ? { authorization: `Bearer ${sessionToken()}` } : {}),
        },
        body: '{}',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) {
        throw new Error(payload.error || '每日簽到失敗');
      }
      const data = payload.data || payload;
      updateVisibleBalance(data.balance);

      if (data.alreadyChecked) {
        showNotice({
          type: 'done',
          title: '今日已完成簽到',
          message: '今天的簽到獎勵已領取<br>請明天再來',
          balance: data.balance,
          buttonText: '知道了',
        });
      } else {
        showNotice({
          type: 'success',
          title: '簽到成功',
          points: Number(data.points || 1),
          message: '今日簽到獎勵已入帳',
          balance: data.balance,
          buttonText: '我知道了',
        });
      }
    } catch (error) {
      showNotice({
        type: 'error',
        title: '簽到未完成',
        message: error?.message || '每日簽到失敗',
        buttonText: '關閉',
      });
    } finally {
      if (button) {
        button.disabled = originalDisabled;
        button.removeAttribute('aria-busy');
      }
      busy = false;
    }
  }

  document.addEventListener('click', (event) => {
    const element = event.target instanceof Element ? event.target : null;
    const button = element?.closest(
      '[data-home-inline="daily"], [data-home-action="dailyCheckin"], [data-direct-daily-checkin], #checkin'
    );
    if (!button) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();
    dailyCheckin(button);
  }, true);
})();
