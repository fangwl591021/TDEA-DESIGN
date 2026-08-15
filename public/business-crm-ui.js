(()=>{
  const esc=(v)=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function rename(){
    document.querySelectorAll('.nav-item').forEach((node)=>{
      if(node.textContent.includes('會員 CRM')) node.innerHTML='<span>♟</span> 商脈 CRM';
    });
    const title=document.querySelector('#pageTitle');
    if(title?.textContent.trim()==='會員 CRM') title.textContent='商脈 CRM';
    document.querySelectorAll('h2').forEach((node)=>{if(node.textContent.trim()==='會員 CRM') node.textContent='商脈 CRM';});
    document.querySelectorAll('p').forEach((node)=>{
      if(node.textContent.includes('以會員為中心查看資料、推薦關係、點數與活動紀錄')) node.textContent='整合註冊會員與名片收藏潛在客戶；私人收藏仍只屬於原收藏者的人脈池。';
    });
    const filter=document.querySelector('#memberTypeFilter');
    if(filter&&!filter.querySelector('option[value="contact"]')){
      const opt=document.createElement('option');opt.value='contact';opt.textContent='名片收藏';filter.appendChild(opt);
    }
  }
  function enhanceRows(){
    const body=document.querySelector('#memberList');if(!body)return;
    body.querySelectorAll('[data-member-id^="contact:"]').forEach((button)=>{
      const row=button.closest('tr');if(!row||row.dataset.businessCrmReady==='1')return;
      row.dataset.businessCrmReady='1';
      const cells=row.children;
      if(cells[1]) cells[1].innerHTML='<span class="crm-tag" style="background:#fff2e8;color:#b45309">名片收藏</span>';
      if(cells[2]) cells[2].innerHTML='<span class="crm-tag pending">私人收藏</span><small>未綁定系統會員</small>';
      if(cells[3]) cells[3].textContent='–';
      if(cells[4]) cells[4].textContent='–';
      if(cells[6]) cells[6].innerHTML='<span style="color:#64748b">–</span>';
      if(cells[7]) cells[7].innerHTML='<span class="crm-tag pending">尚未註冊</span>';
      button.textContent='名片資料';
      button.dataset.contactCardId=button.dataset.memberId.slice('contact:'.length);
    });
  }
  function ensureModal(){
    if(document.querySelector('#businessCrmModal'))return document.querySelector('#businessCrmModal');
    const wrap=document.createElement('div');wrap.id='businessCrmModal';wrap.hidden=true;
    wrap.innerHTML='<style>#businessCrmModal{position:fixed;inset:0;z-index:9999;background:#0f172a66;display:grid;place-items:center;padding:20px}#businessCrmModal[hidden]{display:none}#businessCrmModal .box{width:min(620px,100%);max-height:85vh;overflow:auto;background:#fff;border-radius:20px;box-shadow:0 22px 60px #0f172a33;padding:24px}#businessCrmModal .head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:18px}#businessCrmModal h3{margin:0;font-size:24px}#businessCrmModal .close{border:0;background:#f1f5f9;border-radius:10px;width:38px;height:38px;font-size:22px;cursor:pointer}#businessCrmModal .owner{padding:12px 14px;background:#fff7ed;border-radius:12px;color:#9a3412;font-weight:800;margin-bottom:16px}#businessCrmModal dl{display:grid;grid-template-columns:110px 1fr;gap:10px 14px;margin:0}#businessCrmModal dt{color:#64748b;font-weight:800}#businessCrmModal dd{margin:0;white-space:pre-wrap;word-break:break-word}</style><section class="box"><div class="head"><div><h3 id="businessCrmName">名片資料</h3><small>來源：名片收藏</small></div><button class="close" type="button">×</button></div><div id="businessCrmOwner" class="owner"></div><dl id="businessCrmDetail"></dl></section>';
    document.body.appendChild(wrap);
    wrap.querySelector('.close').onclick=()=>wrap.hidden=true;
    wrap.addEventListener('click',e=>{if(e.target===wrap)wrap.hidden=true;});
    return wrap;
  }
  async function openContact(id){
    const modal=ensureModal();
    modal.hidden=false;
    modal.querySelector('#businessCrmName').textContent='讀取中…';
    modal.querySelector('#businessCrmOwner').textContent='';
    modal.querySelector('#businessCrmDetail').innerHTML='';
    try{
      const token=localStorage.getItem('klinkweb_session')||'';
      const response=await fetch('/v1/admin/crm/contacts/'+encodeURIComponent(id),{headers:{authorization:`Bearer ${token}`}});
      const data=await response.json().catch(()=>({}));
      if(!response.ok||!data.success)throw new Error(data.error||'讀取名片資料失敗');
      const c=data.contact||{};
      modal.querySelector('#businessCrmName').textContent=c.displayName||'未命名名片';
      modal.querySelector('#businessCrmOwner').textContent='收藏歸屬：'+(c.ownerName||c.ownerMemberNumber||'未命名會員');
      const rows=[['公司',c.companyName],['職稱',[c.jobTitle,c.department].filter(Boolean).join('｜')],['手機',c.mobile],['公司電話',c.companyPhone],['Email',c.email],['網站',c.websiteUrl],['LINE',c.lineUrl],['地址',c.address],['服務說明',c.serviceDescription],['備註',c.note],['會員綁定',c.boundUserId?'已綁定系統會員':'尚未註冊／未綁定']];
      modal.querySelector('#businessCrmDetail').innerHTML=rows.filter(([,v])=>v).map(([k,v])=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
    }catch(error){
      modal.querySelector('#businessCrmName').textContent='讀取失敗';
      modal.querySelector('#businessCrmDetail').innerHTML=`<dt>錯誤</dt><dd>${esc(error.message||String(error))}</dd>`;
    }
  }
  document.addEventListener('click',e=>{
    const button=e.target instanceof Element?e.target.closest('[data-contact-card-id]'):null;
    if(!button)return;
    e.preventDefault();e.stopImmediatePropagation();openContact(button.dataset.contactCardId);
  },true);
  const observer=new MutationObserver(()=>{rename();enhanceRows();});
  observer.observe(document.documentElement,{subtree:true,childList:true,characterData:true});
  document.addEventListener('DOMContentLoaded',()=>{rename();enhanceRows();});
  rename();enhanceRows();
})();
