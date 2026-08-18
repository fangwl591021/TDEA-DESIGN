(() => {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);
  const normalizePhone = (value) => String(value || "").replace(/[^\d+]/g, "");

  async function lookup(memberType, fullName, phone = "") {
    const token = localStorage.getItem("klinkweb_session") || "";
    const response = await fetch("/v1/roster/member-number-lookup", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ memberType, fullName, phone })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "會員編號查詢失敗");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function openLookup() {
    const memberType = document.querySelector("#memberType")?.value || "";
    if (!["association", "vendor"].includes(memberType)) {
      alert("請先選擇協會會員或廠商會員");
      return;
    }
    document.querySelector(".ak-roster-lookup-dialog")?.remove();
    const currentName = document.querySelector("#fullName")?.value || "";
    const currentPhone = document.querySelector("#phone")?.value || "";
    const modal = document.createElement("div");
    modal.className = "ak-roster-lookup-dialog";
    modal.innerHTML = `<div class="ak-roster-lookup-backdrop"></div><section class="ak-roster-lookup-sheet" role="dialog" aria-modal="true" aria-labelledby="rosterLookupTitle"><button type="button" class="ak-roster-lookup-close" aria-label="關閉">×</button><h2 id="rosterLookupTitle">會員編號查詢</h2><p>輸入姓名／公司名稱，從 TDEA ${memberType === "vendor" ? "廠商" : "協會"}名冊查詢會員編號。</p><label>姓名／公司名稱<input id="rosterLookupName" maxlength="120" autocomplete="name" value="${esc(currentName)}"></label><label id="rosterLookupPhoneWrap" hidden>行動電話<input id="rosterLookupPhone" type="tel" inputmode="tel" autocomplete="tel" maxlength="20" placeholder="0912345678" value="${esc(currentPhone)}"></label><button type="button" class="btn" id="rosterLookupSearch">查詢</button><div id="rosterLookupResult" class="ak-roster-lookup-result" aria-live="polite"></div></section>`;
    const close = () => modal.remove();
    modal.querySelector(".ak-roster-lookup-backdrop")?.addEventListener("click", close);
    modal.querySelector(".ak-roster-lookup-close")?.addEventListener("click", close);
    modal.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });

    const search = async () => {
      const name = modal.querySelector("#rosterLookupName")?.value.trim() || "";
      const phoneWrap = modal.querySelector("#rosterLookupPhoneWrap");
      const phoneInput = modal.querySelector("#rosterLookupPhone");
      const result = modal.querySelector("#rosterLookupResult");
      const button = modal.querySelector("#rosterLookupSearch");
      if (!name) { result.textContent = "請輸入姓名／公司名稱"; return; }
      const phoneRequired = !phoneWrap.hidden;
      const phone = phoneRequired ? normalizePhone(phoneInput.value) : "";
      if (phoneRequired && !/^(?:\+886|0)9\d{8}$/.test(phone)) {
        result.textContent = "找到同名會員，請輸入正確的行動電話確認";
        phoneInput.focus();
        return;
      }
      button.disabled = true;
      button.textContent = "查詢中…";
      try {
        const response = await lookup(memberType, name, phone);
        const match = response.match || {};
        result.innerHTML = `<p>查詢結果：${esc(match.rosterName || name)}</p><div><strong>${esc(match.memberNumber || "")}</strong><button type="button" class="btn alt" id="copyRosterMemberNumber">複製編號</button></div>`;
        modal.querySelector("#copyRosterMemberNumber")?.addEventListener("click", async () => {
          try { await navigator.clipboard.writeText(match.memberNumber || ""); } catch (_) {}
          const target = document.querySelector("#rosterMemberNumber");
          if (target) target.value = match.memberNumber || "";
          modal.querySelector("#copyRosterMemberNumber").textContent = "已複製";
        });
      } catch (error) {
        if (Number(error.status) === 409) {
          phoneWrap.hidden = false;
          result.textContent = "找到同名會員，請再輸入行動電話確認。";
          phoneInput.focus();
        } else {
          result.textContent = error.message || "會員編號查詢失敗";
        }
      } finally {
        button.disabled = false;
        button.textContent = "查詢";
      }
    };
    modal.querySelector("#rosterLookupSearch")?.addEventListener("click", search);
    modal.querySelector("#rosterLookupName")?.addEventListener("keydown", (event) => { if (event.key === "Enter") search(); });
    modal.querySelector("#rosterLookupPhone")?.addEventListener("keydown", (event) => { if (event.key === "Enter") search(); });
    document.body.append(modal);
    modal.querySelector("#rosterLookupName")?.focus();
  }

  document.addEventListener("click", (event) => {
    const button = event.target instanceof Element ? event.target.closest("#lookupRosterMemberNumber") : null;
    if (!button) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    openLookup();
  }, true);
})();
