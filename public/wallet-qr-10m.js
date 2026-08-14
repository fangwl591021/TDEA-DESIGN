(() => {
  const sessionToken = () => localStorage.getItem('klinkweb_session') || '';
  let expiryTimer = null;

  async function issueWalletQr() {
    const response = await fetch('/v1/points/wallet/qr', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        ...(sessionToken() ? { authorization: `Bearer ${sessionToken()}` } : {}),
      },
      body: '{}',
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'QR Code 產生失敗');
    return payload;
  }

  function bindWalletButton() {
    const button = document.querySelector('#walletQr');
    if (!button || button.dataset.wallet10mBound === '1') return;
    button.dataset.wallet10mBound = '1';
    button.onclick = async () => {
      const node = document.querySelector('#qr');
      const expiry = document.querySelector('#expire');
      if (!node || !expiry) return;
      try {
        const q = await issueWalletQr();
        node.innerHTML = '';
        if (typeof window.QRCode !== 'function') throw new Error('QR Code 元件尚未載入');
        new QRCode(node, { text: q.qrPayload, width: 210, height: 210 });
        expiry.textContent = 'QR Code 將於 10 分鐘後失效';
        clearTimeout(expiryTimer);
        expiryTimer = setTimeout(() => {
          node.innerHTML = '';
          expiry.textContent = 'QR Code 已失效，請重新產生';
        }, 600000);
      } catch (error) {
        alert(error.message || 'QR Code 產生失敗');
      }
    };
  }

  const observer = new MutationObserver(bindWalletButton);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', bindWalletButton);
  bindWalletButton();
})();
