(()=>{
  const managed={
    now:'Things to Do Today',
    team:'True remaining cap',
    trade:'4-QUESTION VALUE TEST',
    waivers:'Search free agents',
    leagues:'Pride League True Cap Board'
  };
  let timer=null,cooldown=false;
  function active(){return document.querySelector('#nav button[data-view].active')?.dataset.view||'now';}
  function healthy(view){const marker=managed[view];return !marker||document.getElementById('main')?.textContent?.includes(marker);}
  function reclaim(){
    const view=active();
    if(!managed[view]||healthy(view)||cooldown)return;
    const btn=document.querySelector(`#nav button[data-view="${view}"]`);
    if(!btn)return;
    cooldown=true;
    btn.click();
    setTimeout(()=>{cooldown=false;if(!healthy(active()))schedule();},220);
  }
  function schedule(){clearTimeout(timer);timer=setTimeout(reclaim,45);}
  function install(){
    const main=document.getElementById('main');if(!main)return;
    new MutationObserver(schedule).observe(main,{childList:true,subtree:true});
    document.querySelectorAll('#nav button[data-view]').forEach(b=>b.addEventListener('click',()=>setTimeout(schedule,60)));
    setTimeout(schedule,900);
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install);else install();
})();