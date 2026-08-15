const CACHE='gmslocker-v3-0-0-assets';
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
  if(event.request.method!=='GET')return;

  // NEVER cache HTML/navigation during prototype development.
  if(event.request.mode==='navigate' || event.request.destination==='document'){
    event.respondWith(fetch(event.request,{cache:'no-store'}));
    return;
  }

  // Network first for JS/manifest; static icons can fall back to cache.
  event.respondWith(
    fetch(event.request,{cache:'no-store'})
      .then(response=>{
        if(STATIC.some(x=>event.request.url.endsWith(x.replace('./','')))){
          const copy=response.clone();
          caches.open(CACHE).then(c=>c.put(event.request,copy));
        }
        return response;
      })
      .catch(()=>caches.match(event.request))
  );
});
