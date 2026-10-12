"use strict";

const OWNER = "hyeonwoo-hyu";
const REPO = "musicarchive";
const FILE_API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/data.json`;
const $ = id => document.getElementById(id);
const state = { songs: [], token: "", editing: null, original: null, saving: false };
const appleID = value => Number.isSafeInteger(value) && value > 0;
const recordType = song => song.type;
const recordKey = song => `${song.type}:${song.id}`;
const savedRecord = song => state.songs.find(x => recordKey(x) === recordKey(song));
let pendingSave = null;
let authAttempt = null;
let searchRun = null;
let viewStack = [];
let callTimes = [];
let callQueue = Promise.resolve();
let preferJSONP = false;
const apiCache = new Map();
let sandboxFrame = null;
let sandboxReady = null;
let serial = 0;
const framePending = new Map();
const categories = [
  { entity: "musicArtist", label: "아티스트", size: 8 },
  { entity: "album", label: "발매작", size: 12 },
  { entity: "song", label: "곡", size: 20 }
];
let libraryType = "all";

function el(tag, className, content) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (content !== undefined) node.textContent = content;
  return node;
}

function alertUser(message, isError = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.toggle("bad", isError);
  toast.hidden = false;
  clearTimeout(alertUser.timer);
  alertUser.timer = setTimeout(() => { toast.hidden = true; }, 5500);
}

function errorIn(id, message) {
  $(id).textContent = message;
  $(id).hidden = !message;
}

function decodeBase64(text) {
  const bytes = Uint8Array.from(atob(text.replace(/\s/g, "")), c => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function encodeBase64(text) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

function validateSongs(songs) {
  if (!Array.isArray(songs)) throw new Error("data.json의 내용이 배열이 아닙니다.");
  const keys = new Set();
  for (const song of songs) {
    if (!song || !appleID(song.id) || !["track", "album"].includes(song.type) || keys.has(recordKey(song))
      || typeof song.title !== "string" || !song.title.trim()
      || typeof song.originalTitle !== "string" || !song.originalTitle.trim() || typeof song.artist !== "string"
      || !["DE", "JP", "US"].includes(song.country)
      || (song.type === "album" && song.collectionId !== song.id)
      || !Number.isFinite(song.rating) || song.rating < 0.5 || song.rating > 10 || song.rating * 2 % 1 !== 0
      || (song.review !== undefined && typeof song.review !== "string")) {
      throw new Error("data.json에 잘못된 Apple ID, 평가 또는 중복 기록이 있습니다.");
    }
    keys.add(recordKey(song));
  }
  return songs;
}

async function readGitHub(token = "", signal) {
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${FILE_API}?ref=main`, { headers, cache: "no-store", signal });
  if (!response.ok) throw new Error(`GitHub 파일 조회 실패 (${response.status})`);
  const file = await response.json();
  const songs = JSON.parse(decodeBase64(file.content));
  if (!file.sha) throw new Error("GitHub 파일 SHA를 확인할 수 없습니다.");
  return { songs: validateSongs(songs), sha: file.sha };
}

async function load() {
  try {
    state.songs = (await readGitHub()).songs;
  } catch {
    try {
      const response = await fetch("./data.json", { cache: "no-store" });
      if (!response.ok) throw new Error("파일 조회 실패");
      const songs = await response.json();
      state.songs = validateSongs(songs);
      alertUser("GitHub API 대신 배포된 데이터 파일을 사용합니다.");
    } catch {
      state.songs = [];
      alertUser("기록을 불러오지 못했습니다. 연결을 확인해 주세요.", true);
    }
  }
  renderLibrary();
}

function storeURL(value) {
  try { const url = new URL(value); return url.protocol === "https:" && ["itunes.apple.com", "music.apple.com"].includes(url.hostname) ? url.href : ""; }
  catch { return ""; }
}

function imageURL(value) {
  try { const url = new URL(value); return url.protocol === "https:" && url.hostname.endsWith(".mzstatic.com") ? url.href : ""; }
  catch { return ""; }
}

function artwork(song, detail = false) {
  const box = el("span", "art", "♫"); box.setAttribute("aria-hidden", "true");
  let url = imageURL(song.artworkUrl);
  if (!url) return box;
  if (detail) url = url.replace(/\/100x100bb\.(jpg|png)(?=\?|$)/, "/300x300bb.$1");
  const image = document.createElement("img"); image.alt = "";
  image.width = image.height = detail ? 300 : 100;
  image.loading = detail ? "eager" : "lazy"; image.decoding = "async";
  image.onerror = () => image.remove();
  box.append(image); image.src = url;
  return box;
}

function appleLink(value, badge = false) {
  const url = storeURL(value);
  if (!url) return null;
  const link = el("a", "store-link", "Apple에서 보기 ↗");
  link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer";
  if (badge) {
    link.textContent = "";
    const image = document.createElement("img"); image.src = "./apple-store-badge.svg"; image.className = "store-badge";
    image.alt = "Listen on Apple Music"; image.width = 120; image.height = 40; image.loading = "lazy";
    link.append(image);
  }
  return link;
}

function normalizeItem(item, type, country) {
  const id = Number(type === "album" ? item.collectionId : item.trackId);
  return {
    type, id, title: type === "album" ? item.collectionName : item.trackName,
    originalTitle: type === "album" ? item.collectionName : item.trackName,
    artist: item.artistName || "아티스트 미상", artistId: Number(item.artistId) || 0,
    collectionId: type === "album" ? id : Number(item.collectionId) || 0,
    collectionTitle: item.collectionName || "", collectionType: item.collectionType || "",
    artworkUrl: imageURL(item.artworkUrl100 || item.artworkUrl60),
    storeUrl: storeURL(type === "album" ? item.collectionViewUrl : item.trackViewUrl),
    country, year: String(item.releaseDate || "").slice(0, 4)
  };
}

function songRow(song, fromSearch = false) {
  const row = el("div", "track");
  const button = el("button", "track-main"); button.type = "button";
  button.append(artwork(song));
  const info = el("span", "track-info");
  info.append(el("span", "track-title", song.title), el("span", "track-sub", song.artist));
  const kind = song.type === "album" ? "발매작" : "곡";
  const note = [kind, song.type === "track" ? song.collectionTitle : "", song.year,
    !fromSearch ? String(song.review || "").replace(/\s+/g, " ").slice(0, 80) : ""].filter(Boolean).join(" · ");
  info.append(el("span", "track-note", note)); button.append(info);
  const existing = savedRecord(song);
  const status = el("span", fromSearch ? "add" : "score"); status.dataset.recordKey = recordKey(song);
  status.dataset.albumDetail = String(song.type === "album" && fromSearch);
  status.textContent = existing ? `${existing.rating.toFixed(1)} ★ · 수정` : song.type === "album" ? "상세 · 평가" : "평가하기";
  button.append(status);
  button.addEventListener("click", () => song.type === "album" && fromSearch ? openAlbum(song, true) : openEditor(song));
  row.append(button);
  const link = appleLink(song.storeUrl, true); if (link) row.append(link);
  return row;
}

function renderLibrary() {
  const all = state.songs;
  const tracks = all.filter(x => x.type === "track"), albums = all.filter(x => x.type === "album");
  const average = items => items.length ? (items.reduce((sum, x) => sum + x.rating, 0) / items.length).toFixed(1) : "—";
  $("song-count").textContent = `${tracks.length} · ${albums.length}`;
  $("average-score").textContent = `${average(tracks)} · ${average(albums)}`;
  $("artist-count").textContent = String(new Set(all.map(x => x.artist)).size);
  const query = $("library-query").value.trim().toLocaleLowerCase();
  const items = all.filter(x => (libraryType === "all" || x.type === libraryType)
    && `${x.title} ${x.originalTitle} ${x.artist} ${x.collectionTitle || ""}`.toLocaleLowerCase().includes(query));
  if ($("sort").value === "score") items.sort((a, b) => b.rating - a.rating);
  else if ($("sort").value === "artist") items.sort((a, b) => a.artist.localeCompare(b.artist, "ko"));
  else items.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  const list = $("library-list"); list.replaceChildren();
  if (!items.length) list.append(el("div", "empty", all.length ? "검색 조건에 맞는 기록이 없습니다." : "아직 평가한 음악이 없습니다. 음악을 검색해 첫 평가를 남겨 보세요."));
  else for (const song of items) list.append(songRow(song));
}

function showTab(which) {
  const library = which === "library";
  $("library-panel").hidden = !library; $("search-panel").hidden = library;
  for (const [id, active] of [["library-tab", library], ["search-tab", !library]]) {
    $(id).classList.toggle("active", active); $(id).setAttribute("aria-selected", String(active));
  }
}

function waitForCall(ms, signal) {
  return new Promise((resolve, reject) => {
    const cancel = () => { clearTimeout(timer); reject(new DOMException("취소됨", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", cancel); resolve(); }, ms);
    signal.addEventListener("abort", cancel, { once: true });
  });
}

function reserveCall(signal) {
  const task = callQueue.then(async () => {
    if (signal.aborted) throw new DOMException("취소됨", "AbortError");
    callTimes = callTimes.filter(t => Date.now() - t < 60000);
    if (callTimes.length >= 18) {
      const delay = 60050 - (Date.now() - callTimes[0]);
      alertUser(`Apple 요청 제한 방지를 위해 ${Math.ceil(delay / 1000)}초 대기합니다.`);
      await waitForCall(delay, signal);
      callTimes = callTimes.filter(t => Date.now() - t < 60000);
    }
    if (signal.aborted) throw new DOMException("취소됨", "AbortError");
    callTimes.push(Date.now());
  });
  callQueue = task.catch(() => {});
  return task;
}

// Reuse the test page's opaque-origin iframe: remote scripts never run in the PAT page.
function makeSandbox() {
  if (sandboxReady) return sandboxReady;
  sandboxReady = new Promise((resolve, reject) => {
    const iframe = document.createElement("iframe"); sandboxFrame = iframe;
    iframe.hidden = true; iframe.sandbox = "allow-scripts"; iframe.title = "격리된 Apple 검색 요청";
    const code = 'var jobs={};window.addEventListener("message",function(ev){' +
      'if(ev.source!==parent||!ev.data)return;var id=ev.data.id;' +
      'if(ev.data.type==="cancel"){if(jobs[id])jobs[id]("취소됨");return;}if(ev.data.type!=="ask")return;' +
      'var u;try{u=new URL(ev.data.url);if(u.origin!=="https://itunes.apple.com"||!["/search","/lookup"].includes(u.pathname))throw Error("잘못된 요청");}catch(e){parent.postMessage({type:"answer",id:id,error:String(e)},"*");return;}' +
      'var cb="itunes_cb_"+id,s=document.createElement("script"),done=false;' +
      'function finish(error,data){if(done)return;done=true;clearTimeout(timer);s.remove();delete window[cb];delete jobs[id];parent.postMessage({type:"answer",id:id,error:error,data:data},"*");}' +
      'jobs[id]=finish;window[cb]=function(data){finish("",data);};s.onerror=function(){finish("Apple JSONP 로드 실패");};' +
      'var timer=setTimeout(function(){finish("Apple 응답 시간 초과");},15000);u.searchParams.set("callback",cb);s.src=u.href;document.head.append(s);' +
      '});parent.postMessage({type:"ready"},"*");';
    iframe.srcdoc = '<!doctype html><meta charset="utf-8"><script>' + code + '<' + '/script>';
    const timer = setTimeout(() => { window.removeEventListener("message", ready); reject(new Error("Apple 요청 준비 실패")); }, 5000);
    function ready(event) {
      if (event.source === iframe.contentWindow && event.data?.type === "ready") {
        clearTimeout(timer); window.removeEventListener("message", ready); resolve(iframe);
      }
    }
    window.addEventListener("message", ready); document.body.append(iframe);
  });
  return sandboxReady;
}

window.addEventListener("message", event => {
  if (!sandboxFrame || event.source !== sandboxFrame.contentWindow || event.data?.type !== "answer") return;
  const job = framePending.get(event.data.id);
  if (!job) return;
  if (event.data.error) job.finish(new Error(event.data.error)); else job.finish(null, event.data.data);
});

async function jsonp(url, signal) {
  const frame = await makeSandbox();
  if (signal.aborted) throw new DOMException("취소됨", "AbortError");
  await reserveCall(signal);
  return new Promise((resolve, reject) => {
    const id = ++serial;
    const cancel = () => { frame.contentWindow.postMessage({ type: "cancel", id }, "*"); finish(new DOMException("취소됨", "AbortError")); };
    const finish = (error, data) => {
      if (!framePending.has(id)) return;
      framePending.delete(id); clearTimeout(timer); signal.removeEventListener("abort", cancel);
      error ? reject(error) : resolve(data);
    };
    const timer = setTimeout(() => finish(new Error("Apple 응답 시간 초과")), 18000);
    framePending.set(id, { finish }); signal.addEventListener("abort", cancel, { once: true });
    frame.contentWindow.postMessage({ type: "ask", id, url }, "*");
  });
}

async function api(path, params, view) {
  const signal = view.controller.signal;
  const url = new URL(`https://itunes.apple.com${path}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  if (apiCache.has(url.href)) return apiCache.get(url.href);
  let data;
  if (preferJSONP) data = await jsonp(url.href, signal);
  else {
    await reserveCall(signal);
    const controller = new AbortController();
    const cancel = () => controller.abort(); signal.addEventListener("abort", cancel, { once: true });
    const timer = setTimeout(cancel, 14000);
    try {
      const response = await fetch(url.href, { signal: controller.signal, cache: "no-store" });
      if (!response.ok) throw new Error(`Apple API 응답 ${response.status}${response.status === 429 ? " · 잠시 후 다시 시도하세요." : ""}`);
      data = await response.json();
    } catch (error) {
      if (signal.aborted) throw new DOMException("취소됨", "AbortError");
      if (!(error instanceof TypeError) && error.name !== "AbortError") throw error;
      preferJSONP = true;
      data = await jsonp(url.href, signal);
    } finally { clearTimeout(timer); signal.removeEventListener("abort", cancel); }
  }
  if (!data || !Array.isArray(data.results)) throw new Error("Apple API 응답 형식을 확인할 수 없습니다.");
  if (signal.aborted) throw new DOMException("취소됨", "AbortError");
  apiCache.set(url.href, data);
  if (apiCache.size > 40) apiCache.delete(apiCache.keys().next().value);
  return data;
}

function dedup(items, entity) {
  const ids = new Set();
  return items.filter(item => {
    const id = Number(entity === "musicArtist" ? item.artistId : entity === "album" ? item.collectionId : item.trackId);
    const valid = entity === "musicArtist" ? item.wrapperType === "artist" : entity === "album" ? item.wrapperType === "collection" : item.kind === "song";
    if (!valid || !appleID(id) || ids.has(id)) return false;
    ids.add(id); return true;
  });
}

function makeView(kind, name, country, push = false) {
  searchRun?.controller.abort();
  if (push && searchRun) viewStack.push(searchRun); else if (!push) viewStack = [];
  const view = { kind, name, country, controller: new AbortController(), root: el("div", "search-results"), context: el("div"), sections: [], pending: true };
  searchRun = view; showTab("search"); mountView(view);
  return view;
}

function mountView(view) {
  $("search-context").replaceChildren(view.context); $("search-context").hidden = !view.context.childNodes.length;
  $("results").replaceChildren(view.root);
  refreshSearchCount(view); refreshSavedStatuses();
}

function addBack(view) {
  if (!viewStack.length && !view.returnLibrary) return;
  const button = el("button", "text-button", "← 이전 화면"); button.type = "button";
  button.addEventListener("click", () => {
    searchRun?.controller.abort();
    if (view.returnLibrary) { showTab("library"); searchRun = viewStack.pop() || null; return; }
    searchRun = viewStack.pop();
    if (searchRun) { searchRun.controller = new AbortController(); mountView(searchRun); }
  });
  view.context.append(button);
}

function refreshSearchCount(view) {
  if (searchRun !== view) return;
  $("search-count").textContent = `${view.country} 카탈로그 · ${view.kind === "album" ? "발매작 상세" : `${view.sections.reduce((n, page) => n + page.shown, 0)}개 표시`}${view.pending ? " · 조회 중…" : ""}`;
}

function artistRow(item, country) {
  const row = el("div", "track"); const button = el("button", "track-main"); button.type = "button";
  button.append(el("span", "art", "♬"));
  const info = el("span", "track-info");
  info.append(el("span", "track-title", item.artistName || "아티스트 미상"), el("span", "track-sub", item.primaryGenreName || "아티스트"));
  button.append(info, el("span", "add", "발매작 보기"));
  button.addEventListener("click", () => openArtist(item, country)); row.append(button);
  const link = appleLink(item.artistLinkUrl || item.artistViewUrl); if (link) row.append(link);
  return row;
}

function createPage(view, category, request) {
  const page = { shown: 0, items: null, loading: false };
  const section = el("section", "result-section");
  const heading = el("div", "section-header"); const summary = el("span", "muted hint");
  heading.append(el("h3", "result-heading", category.label), summary);
  const list = el("div", "track-list"); list.id = `results-${category.entity}`;
  const message = el("p", "hint muted", "조회 중…");
  const more = el("button", "secondary more-button", "더보기"); more.type = "button"; more.hidden = true;
  section.append(heading, list, message, more); view.root.append(section); view.sections.push(page);
  const append = () => {
    const end = Math.min(page.items.length, page.shown + category.size);
    for (; page.shown < end; page.shown++) {
      const item = page.items[page.shown];
      list.append(category.entity === "musicArtist" ? artistRow(item, view.country) : songRow(normalizeItem(item, category.entity === "album" ? "album" : "track", view.country), true));
    }
    summary.textContent = `${page.shown} / ${page.items.length}개 표시`;
    more.hidden = page.shown >= page.items.length; more.disabled = false; more.textContent = "더보기";
    message.textContent = page.items.length ? "조회한 결과를 나누어 표시합니다. Apple API 조회 상한은 100개입니다." : "검색 결과가 없습니다. 다른 검색어나 스토어 국가를 선택해 보세요.";
    refreshSearchCount(view);
  };
  page.load = async () => {
    if (page.loading) return;
    if (page.items) { append(); return; }
    const controller = view.controller; page.loading = true; more.disabled = true;
    message.className = "hint muted"; message.textContent = "조회 중…";
    try {
      const json = await request();
      if (controller.signal.aborted) return;
      page.items = dedup(json.results, category.entity); append();
    } catch (error) {
      message.className = controller.signal.aborted ? "hint muted" : "error";
      message.textContent = controller.signal.aborted ? "조회가 중단되었습니다. 다시 조회할 수 있습니다." : `조회 실패: ${error.message}`;
      more.textContent = "다시 조회"; more.hidden = false;
    } finally { page.loading = false; more.disabled = false; }
  };
  more.addEventListener("click", () => page.load());
  return page;
}

async function startSearch(query) {
  const country = $("search-country").value;
  if (searchRun?.kind === "search" && searchRun.pending && searchRun.name === query && searchRun.country === country) return;
  const view = makeView("search", query, country);
  if (!query) { view.root.append(el("div", "empty", "곡명, 앨범명 또는 아티스트를 검색해 보세요.")); view.pending = false; refreshSearchCount(view); return; }
  const pages = categories.map(category => createPage(view, category, () => api("/search", {
    term: query, country, media: "music", entity: category.entity, limit: 100, lang: country === "JP" ? "ja_jp" : "en_us"
  }, view)));
  await Promise.all(pages.map(page => page.load()));
  view.pending = false; refreshSearchCount(view);
}

async function openArtist(item, country) {
  const view = makeView("artist", item.artistName, country, true); addBack(view);
  view.context.append(el("h3", "", item.artistName), el("p", "muted hint", [item.primaryGenreName, `${country} 카탈로그`].filter(Boolean).join(" · ")));
  const link = appleLink(item.artistLinkUrl || item.artistViewUrl); if (link) view.context.append(link);
  const page = createPage(view, categories[1], () => api("/lookup", { id: item.artistId, country, entity: "album", limit: 100 }, view));
  await page.load(); view.pending = false; refreshSearchCount(view);
}

async function openAlbum(album, fromSearch = false) {
  const returnLibrary = !$("library-panel").hidden;
  const view = makeView("album", album.originalTitle, album.country, Boolean(searchRun)); view.returnLibrary = returnLibrary;
  addBack(view);
  const hero = el("div", "album-hero"); hero.append(artwork(album, true));
  const info = el("div", "track-info");
  info.append(el("h2", "", savedRecord(album)?.title || album.title), el("p", "muted", album.artist), el("p", "hint", [album.year, `${album.country} 카탈로그`].filter(Boolean).join(" · ")));
  const link = appleLink(album.storeUrl, true); if (link) info.append(link);
  hero.append(info); view.context.append(hero);
  const rate = el("button", "primary", "발매작 평가하기"); rate.type = "button";
  rate.dataset.recordKey = recordKey(album); rate.dataset.albumDetail = "false";
  rate.addEventListener("click", () => openEditor(album)); view.context.append(rate);
  const tracks = el("div", "album-tracks"); tracks.id = "album-tracks"; view.root.append(tracks);
  const retry = el("button", "secondary", "수록곡 다시 조회"); retry.type = "button"; retry.hidden = true; view.root.append(retry);
  let loading = false;
  const loadTracks = async () => {
    if (loading) return;
    const controller = view.controller; loading = true; retry.hidden = true; view.pending = true;
    tracks.replaceChildren(el("p", "hint muted", "수록곡 조회 중…"));
    try {
      const json = await api("/lookup", { id: album.collectionId, country: album.country, entity: "song", limit: 200 }, view);
      if (controller.signal.aborted) return;
      const songs = dedup(json.results.filter(x => Number(x.collectionId) === album.collectionId), "song")
        .sort((a, b) => (a.discNumber || 1) - (b.discNumber || 1) || (a.trackNumber || 0) - (b.trackNumber || 0));
      tracks.replaceChildren();
      if (!songs.length) tracks.append(el("p", "hint", "이 스토어에서 수록곡을 찾지 못했습니다."));
      let currentDisc = null, disc;
      for (const item of songs) {
        if (currentDisc !== (item.discNumber || 1)) {
          currentDisc = item.discNumber || 1; disc = el("section", "disc");
          disc.append(el("h3", "result-heading", `Disc ${currentDisc}`)); tracks.append(disc);
        }
        const row = songRow(normalizeItem(item, "track", album.country), true);
        row.querySelector(".track-main").prepend(el("span", "track-number", String(item.trackNumber || "")));
        disc.append(row);
      }
    } catch (error) {
      tracks.replaceChildren(el("p", controller.signal.aborted ? "hint muted" : "error", controller.signal.aborted ? "조회가 중단되었습니다." : `수록곡 조회 실패: ${error.message}`));
      retry.hidden = false;
    } finally { loading = false; view.pending = false; refreshSearchCount(view); }
  };
  retry.addEventListener("click", loadTracks); mountView(view); await loadTracks();
}

function refreshSavedStatuses() {
  for (const root of [document, ...viewStack.map(view => view.root), ...viewStack.map(view => view.context)]) {
    for (const node of root.querySelectorAll("[data-record-key]")) {
      const record = state.songs.find(x => recordKey(x) === node.dataset.recordKey);
      node.textContent = record ? `${record.rating.toFixed(1)} ★ · 수정` : node.dataset.albumDetail === "true" ? "상세 · 평가" : node.dataset.recordKey.startsWith("album:") ? "발매작 평가하기" : "평가하기";
    }
  }
}

function searchMusic(event) {
  event.preventDefault();
  const query = $("music-query").value.trim();
  if (!query) { alertUser("검색어를 입력하세요.", true); return; }
  startSearch(query);
}

function updateRating() {
  const score = Number($("rating").value);
  $("rating-value").value = `${score.toFixed(1)} / 10`;
  $("rating").setAttribute("aria-valuetext", `${score.toFixed(1)}점 / 10점`);
  $("rating").style.setProperty("--rating-progress", `${(score - 0.5) / 9.5 * 100}%`);
  $("rating-minus").disabled = state.saving || score <= 0.5;
  $("rating-plus").disabled = state.saving || score >= 10;
}

function openEditor(song) {
  if (!appleID(song.id)) { alertUser("Apple 음악 ID를 확인할 수 없습니다.", true); return; }
  const existing = savedRecord(song);
  state.editing = { ...(existing || song) }; state.original = existing ? JSON.stringify(existing) : null;
  $("editor-title").textContent = `${existing ? "평가 수정" : "새 평가"} · ${song.type === "album" ? "발매작" : "곡"}`;
  $("editor-subtitle").textContent = `${state.editing.title} — ${state.editing.artist}`;
  $("display-title").value = state.editing.title;
  $("original-title").textContent = state.editing.originalTitle;
  $("rating").value = existing ? String(existing.rating) : "5"; updateRating();
  $("review").value = existing?.review || ""; errorIn("editor-error", "");
  $("editor").showModal();
}
async function saveReview(event) {
  event?.preventDefault();
  if (!state.editing || state.saving) return;
  const score = Number($("rating").value);
  if (!$("rating").value || !Number.isFinite(score) || score < 0.5 || score > 10 || score * 2 % 1 !== 0) {
    errorIn("editor-error", "평점은 0.5~10점 사이에서 선택해 주세요.");
    return;
  }
  if (!state.token) {
    pendingSave = recordKey(state.editing);
    $("admin").showModal();
    alertUser("관리자 연결 후 작성한 평가를 저장합니다.");
    return;
  }
  pendingSave = null;
  const button = $("save");
  state.saving = true;
  updateRating();
  $("editor-close").disabled = true;
  $("rating").disabled = true;
  $("review").disabled = true;
  $("display-title").disabled = true;
  $("restore-title").disabled = true;
  button.disabled = true;
  button.textContent = "저장 중…";
  errorIn("editor-error", "");
  try {
    const { songs, sha } = await readGitHub(state.token);
    const index = songs.findIndex(x => recordKey(x) === recordKey(state.editing));
    const latest = index >= 0 ? songs[index] : null;
    if ((latest ? JSON.stringify(latest) : null) !== state.original) {
      throw new Error("다른 기기에서 이 평가가 변경되었습니다. 감상평을 복사한 뒤 새로고침해 주세요.");
    }
    const record = {
      ...state.editing,
      type: recordType(state.editing),
      id: state.editing.id,
      title: $("display-title").value.trim() || state.editing.originalTitle,
      originalTitle: state.editing.originalTitle,
      artist: state.editing.artist,
      year: state.editing.year || "",
      rating: score,
      review: $("review").value.trim(),
      updatedAt: new Date().toISOString()
    };
    const updated = songs.slice();
    if (index >= 0) updated[index] = record;
    else updated.push(record);
    validateSongs(updated);
    const response = await fetch(FILE_API, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${state.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: `${index >= 0 ? "Update" : "Add"} rating: ${record.title}`,
        content: encodeBase64(JSON.stringify(updated, null, 2) + "\n"),
        sha,
        branch: "main"
      })
    });
    if (!response.ok) {
      if (response.status === 409) throw new Error("저장 충돌이 발생했습니다. 작성 내용은 유지되어 있으니 다시 시도해 주세요.");
      if (response.status === 401 || response.status === 403) throw new Error(`쓰기 권한이 없습니다 (${response.status}). 토큰 권한을 확인해 주세요.`);
      throw new Error(`저장에 실패했습니다 (${response.status}).`);
    }
    state.songs = updated;
    renderLibrary();
    $("editor").close();
    refreshSavedStatuses();
    alertUser("GitHub에 저장했습니다.");
  } catch (error) {
    errorIn("editor-error", error.message);
  } finally {
    state.saving = false;
    updateRating();
    $("editor-close").disabled = false;
    $("rating").disabled = false;
    $("review").disabled = false;
    $("display-title").disabled = false;
    $("restore-title").disabled = false;
    button.disabled = false;
    button.textContent = "GitHub에 저장";
  }
}

function cancelAdminConnect() {
  authAttempt?.abort(); authAttempt = null; pendingSave = null;
  $("token").value = ""; $("connect").disabled = false;
}

async function connect(event) {
  event.preventDefault();
  if (authAttempt || !$("admin").open) return;
  const controller = new AbortController();
  authAttempt = controller;
  const token = $("token").value.trim();
  const button = $("connect");
  button.disabled = true;
  errorIn("admin-error", "");
  try {
    await readGitHub(token, controller.signal);
    if (controller.signal.aborted || authAttempt !== controller || !$("admin").open) return;
    const resume = pendingSave;
    pendingSave = null; authAttempt = null;
    state.token = token;
    $("token").value = "";
    $("admin").close();
    $("admin-button").textContent = "관리자 연결됨";
    $("disconnect").hidden = false;
    alertUser("GitHub 조회 확인 완료. 쓰기 권한은 실제 저장 시 확인됩니다.");
    if (resume && state.editing && recordKey(state.editing) === resume && $("editor").open) await saveReview();
  } catch (error) {
    if (!controller.signal.aborted && $("admin").open && authAttempt === controller) errorIn("admin-error", `연결 실패: ${error.message}`);
  } finally {
    if (authAttempt === controller) authAttempt = null;
    if (!authAttempt) button.disabled = false;
  }
}

function backup() {
  const blob = new Blob([JSON.stringify(state.songs, null, 2) + "\n"], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = el("a");
  link.href = url;
  link.download = `musicarchive-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

$("rating").addEventListener("input", updateRating);
for (const [id, delta] of [["rating-minus", -0.5], ["rating-plus", 0.5]]) {
  $(id).addEventListener("click", () => {
    if (state.saving) return;
    $("rating").value = String(Math.max(0.5, Math.min(10, Number($("rating").value) + delta)));
    updateRating();
  });
}
updateRating();
$("music-query").addEventListener("input", () => {
  $("search-submit").disabled = false;
  $("search-submit").textContent = "검색";
});
$("library-tab").addEventListener("click", () => showTab("library"));
$("search-tab").addEventListener("click", () => showTab("search"));
for (const button of $("library-types").querySelectorAll("button")) {
  button.addEventListener("click", () => {
    libraryType = button.dataset.type;
    for (const item of $("library-types").querySelectorAll("button")) {
      item.classList.toggle("active", item === button);
      item.setAttribute("aria-pressed", String(item === button));
    }
    renderLibrary();
  });
}
$("library-query").addEventListener("input", renderLibrary);
$("sort").addEventListener("change", renderLibrary);
$("search-form").addEventListener("submit", searchMusic);
$("editor-form").addEventListener("submit", saveReview);
$("editor-close").addEventListener("click", () => { pendingSave = null; $("editor").close(); });
$("editor").addEventListener("cancel", event => { if (state.saving) event.preventDefault(); });
$("admin-button").addEventListener("click", () => $("admin").showModal());
$("admin-close").addEventListener("click", () => { cancelAdminConnect(); $("admin").close(); });
$("admin").addEventListener("cancel", cancelAdminConnect);
$("admin").addEventListener("close", cancelAdminConnect);
$("admin-form").addEventListener("submit", connect);
$("disconnect").addEventListener("click", () => {
  state.token = "";
  $("disconnect").hidden = true;
  $("admin-button").textContent = "관리자 연결";
  $("admin").close();
  alertUser("연결 해제됨");
});
$("export").addEventListener("click", backup);
$("restore-title").addEventListener("click", () => { $("display-title").value = state.editing.originalTitle; });
$("search-country").addEventListener("change", () => startSearch($("music-query").value.trim()));

// Remove only this project's former cover worker and its known public cover caches.
async function removeLegacyCoverCache() {
  const scope = new URL("./", location.href).href;
  if (new URL(scope).pathname !== "/musicarchive/") return;
  try {
    if ("serviceWorker" in navigator) for (const registration of await navigator.serviceWorker.getRegistrations()) {
      const worker = registration.active || registration.waiting || registration.installing;
      if (registration.scope === scope && worker && new URL(worker.scriptURL).pathname === new URL("cover-cache.js", scope).pathname) await registration.unregister();
    }
    if ("caches" in window) await caches.delete("musicarchive-small-images-v1");
    localStorage.removeItem("musicarchive-public-covers-v1");
  } catch { /* Restricted storage does not affect Apple covers or reviews. */ }
}
removeLegacyCoverCache();
load();
