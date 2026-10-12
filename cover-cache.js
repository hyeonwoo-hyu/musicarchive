"use strict";

const COVER_CACHE = "musicarchive-small-images-v1";
const coverURL = url => /^https:\/\/archive\.org\/services\/img\/mbid-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(url);
const pending = new Map();

self.addEventListener("install", event => event.waitUntil(self.skipWaiting()));
self.addEventListener("activate", event => event.waitUntil(self.clients.claim()));

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET" || !coverURL(event.request.url)) return;
  event.respondWith((async () => {
    try {
      const cache = await caches.open(COVER_CACHE);
      const saved = await cache.match(event.request);
      if (saved) return saved;
    } catch { /* Storage restrictions must not prevent normal image loading. */ }
    const response = await fetch(event.request);
    pending.set(event.request.url, response.clone());
    if (pending.size > 40) pending.delete(pending.keys().next().value);
    return response;
  })());
});

// Only save responses that the actual displayed image successfully decoded.
self.addEventListener("message", event => {
  const { type, url } = event.data || {};
  if (type !== "cover-loaded" || !coverURL(url) || !pending.has(url)) return;
  const response = pending.get(url);
  pending.delete(url);
  event.waitUntil((async () => {
    try {
      const cache = await caches.open(COVER_CACHE);
      await cache.put(url, response);
      const keys = await cache.keys();
      for (const key of keys.slice(0, Math.max(0, keys.length - 40))) await cache.delete(key);
    } catch { /* Quota/private browsing errors leave the network fallback intact. */ }
  })());
});
