(()=>{
  function unlockPhone(){
    const input=document.querySelector('#phone');
    if(!input)return false;
    input.readOnly=false;
    input.removeAttribute('readonly');
    input.disabled=false;
    input.setAttribute('autocomplete','tel');
    input.setAttribute('inputmode','tel');
    return true;
  }
  if(!unlockPhone()){
    const observer=new MutationObserver(()=>{ unlockPhone(); });
    observer.observe(document.documentElement,{childList:true,subtree:true});
  }
})();
