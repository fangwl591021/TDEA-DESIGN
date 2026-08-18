(() => {
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[ch]);

  async function lookup(memberType, fullName) {
    const token = localStorage.getItem("klinkweb_session") || "";
    const response = await fetch("/v1/roster/member-number-lookup", {
      method: "POST",
      credentials: "same-origin",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify({ memberType, fullName })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "會員編號查詢失敗");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  function applyCandidate(candidate, modal) {
    const nameTarget = document.querySelector("#fullName");
    const phoneTarget = document.querySelector("#phone");
    const numberTarget = document.querySelector("#rosterMemberNumber");
    if (nameTarget && candidate.rosterName) nameTarget.value = candidate.rosterName;
    if (phoneTarget && candidate.phone) phoneTarget.value = candidate.phone;
    if (numberTarget) numberTarget.value = candidate.memberNumber || "";
    modal.remove();
  }

  function renderCandidates(result, candidates, modal) {
    result.innerHTML = `
      <p style="margin:8px 0 12px">找到 ${candidates.length} 筆相符資料，請點選正確會員：</p>
      <div style="display:grid;gap:10px">
        ${candidates.map((item, index) => `
          <button type="button" data-roster-candidate="${index}" style="width:100%;text-align:left;padding:12px 14px;border:1px solid #e6c7b8;border-radius:12px;background:#fff;color:#4a2c20;cursor:pointer">
            <strong style="display:block;font-size:17px">${esc(item.rosterName || "未命名")}</strong>
            <span style="display:block;margin-top:4px">行動電話：${esc(item.phone || "未填")}</span>
            <span style="display:block;margin-top:2px;color:#8a6758">會員編號：${esc(item.memberNumber || "")}</span>
          </button>
        `).join("")}
      </div>`;
    result.querySelectorAll("[data-roster-candidate]").forEach((button) => {
      button.addEventListener("click", () => {
        const candidate = candidates[Number(button.dataset.rosterCandidate)];
        if (candidate) applyCandidate(candidate, modal);
      });
    });
  }

  function openLookup() {
    const memberType = document.querySelector("#memberType")?.value || "";
    if (!["association", "vendor"].includes(memberType)) {
      alert("請先選擇協會會員或廠商會員");
      return;
    }
    document.querySelector(".ak-roster-lookup-dialog")?.remove();
    const currentName = document.querySelector("#fullName")?.value || "";
    const modal = document.createElement("div");
    modal.className = "ak-roster-lookup-dialog";
    modal.innerHTML = `<div class="ak-roster-lookup-backdrop"></div><section class="ak-roster-lookup-sheet" role="dialog" aria-modal="true" aria-labelledby="rosterLookupTitle"><button type="button" class="ak-roster-lookup-close" aria-label="關閉">×</button><h2 id="rosterLookupTitle">會員編號查詢</h2><p>輸入姓名／公司名稱，從 TDEA ${memberType === "vendor" ? "廠商" : "協會"}名冊查詢會員編號。</p><label>姓名／公司名稱<input id="rosterLookupName" maxlength="120" autocomplete="name" value="${esc(currentName)}"></label><button type="button" class="btn" id="rosterLookupSearch">查詢</button><div id="rosterLookupResult" class="ak-roster-lookup-result" aria-live="polite"></div></section>`;
    const close = () => modal.remove();
    modal.querySelector(".ak-roster-lookup-backdrop")?.addEventListener("click", close);
    modal.querySelector(".ak-roster-lookup-close")?.addEventListener("click", close);
    modal.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });

    const search = async () => {
      const name = modal.querySelector("#rosterLookupName")?.value.trim() || "";
      const result = modal.querySelector("#rosterLookupResult");
      const button = modal.querySelector("#rosterLookupSearch");
      if (!name) { result.textContent = "請輸入姓名／公司名稱"; return; }
      button.disabled = true;
      button.textContent = "查詢中…";
      try {
        const response = await lookup(memberType, name);
        const match = response.match || {};
        if (match.ambiguous && Array.isArray(match.candidates) && match.candidates.length) {
          renderCandidates(result, match.candidates, modal);
          return;
        }
        const candidate = {
          rosterName: match.rosterName || name,
          phone: match.phone || "",
          memberNumber: match.memberNumber || ""
        };
        result.innerHTML = `<p>查詢結果：</p><button type="button" id="selectRosterMember" style="width:100%;text-align:left;padding:12px 14px;border:1px solid #e6c7b8;border-radius:12px;background:#fff;color:#4a2c20;cursor:pointer"><strong style="display:block;font-size:17px">${esc(candidate.rosterName)}</strong><span style="display:block;margin-top:4px">行動電話：${esc(candidate.phone || "未填")}</span><span style="display:block;margin-top:2px;color:#8a6758">會員編號：${esc(candidate.memberNumber)}</span></button>`;
        modal.querySelector("#selectRosterMember")?.addEventListener("click", () => applyCandidate(candidate, modal));
      } catch (error) {
        result.textContent = error.message || "會員編號查詢失敗";
      } finally {
        button.disabled = false;
        button.textContent = "查詢";
      }
    };
    modal.querySelector("#rosterLookupSearch")?.addEventListener("click", search);
    modal.querySelector("#rosterLookupName")?.addEventListener("keydown", (event) => { if (event.key === "Enter") search(); });
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
