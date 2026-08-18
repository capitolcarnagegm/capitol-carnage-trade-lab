const CACHE='gmslocker-v5-1-0-assets';
const STATIC=['./manifest.webmanifest','./icon-192.png','./icon-512.png'];

self.addEventListener('install',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k.startsWith('gmslocker-')&&k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>caches.open(CACHE).then(c=>c.addAll(STATIC)))
      .then(()=>self.skipWaiting())
  );
});

self.addEventListener('activate',event=>{
  event.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;

  if(event.request.mode==='navigate' || event.request.destination==='document'){
    event.respondWith(
      fetch(event.request,{cache:'no-store'}).catch(()=>
        new Response('GMS Locker is temporarily unavailable. Refresh in a moment.',{
          status:503,
          headers:{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'}
        })
      )
    );
    return;
  }

  event.respondWith(
    fetch(event.request,{cache:'no-store'})
      .then(response=>{
        if(response && response.ok && STATIC.some(x=>event.request.url.endsWith(x.replace('./','')))){
          const copy=response.clone();
          caches.open(CACHE).then(c=>c.put(event.request,copy)).catch(()=>{});
        }
        return response;
      })
      .catch(async()=>{
        const cached=await caches.match(event.request);
        if(cached) return cached;
        return new Response(JSON.stringify({error:'Network unavailable'}),{
          status:503,
          headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}
        });
      })
  );
});
