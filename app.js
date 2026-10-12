"use strict";

const OWNER = "hyeonwoo-hyu";
const REPO = "musicarchive";
const FILE_API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/data.json`;
const $ = id => document.getElementById(id);
const state = { songs: [], token: "", editing: null, original: null, lastLookup: 0, saving: false };
const isMBID = value => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value || "");
let musicQueue = Promise.resolve();
let searchRun = null;
let lastSearchQuery = "";
let libraryType = "all";
let viewStack = [];
const albumCache = new Map();
const recordType = song => song.type === undefined ? "track" : song.type;
const recordKey = song => `${recordType(song)}:${song.id}`;
const savedRecord = song => state.songs.find(x => recordKey(x) === recordKey(song));

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
  const ids = new Set();
  for (const song of songs) {
    if (!song || !isMBID(song.id) || !["track", "album"].includes(recordType(song)) || ids.has(recordKey(song))
      || typeof song.title !== "string" || typeof song.artist !== "string"
      || (recordType(song) === "album" && song.releaseGroupId !== song.id)
      || !Number.isFinite(song.rating) || song.rating < 0.5 || song.rating > 10 || song.rating * 2 % 1 !== 0
      || (song.review !== undefined && typeof song.review !== "string")
      || (song.alternateReleaseIds !== undefined && (!Array.isArray(song.alternateReleaseIds) || !song.alternateReleaseIds.every(isMBID)))
      || (song.coverReleaseIds !== undefined && (!Array.isArray(song.coverReleaseIds) || !song.coverReleaseIds.every(isMBID)))) {
      throw new Error("data.json에 잘못된 평가 또는 중복 곡이 있습니다. 파일을 확인해 주세요.");
    }
    ids.add(recordKey(song));
  }
  return songs;
}

async function readGitHub(token = "") {
  const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${FILE_API}?ref=main`, { headers, cache: "no-store" });
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

function coverCandidates(song) {
  const urls = [];
  if (isMBID(song.releaseGroupId)) urls.push(`https://coverartarchive.org/release-group/${song.releaseGroupId}/front-250`);
  if (isMBID(song.releaseId)) urls.push(`https://coverartarchive.org/release/${song.releaseId}/front-250`);
  // Only use alternate releases verified to belong to the selected group.
  for (const id of song.coverReleaseIds || []) {
    if (isMBID(id)) urls.push(`https://coverartarchive.org/release/${id}/front-250`);
  }
  return [...new Set(urls)].slice(0, 5);
}

function artwork(song) {
  const box = el("span", "art", "♫");
  const urls = coverCandidates(song);
  if (urls.length) {
    const image = document.createElement("img");
    image.alt = "";
    image.loading = "lazy";
    let i = 0;
    image.onerror = () => {
      i += 1;
      if (i < urls.length) image.src = urls[i];
      else { image.remove(); box.textContent = "♫"; }
    };
    box.textContent = "";
    box.append(image);
    image.src = urls[0];
  }
  return box;
}

function songRow(song, fromSearch = false) {
  const button = el("button", "track");
  button.type = "button";
  button.append(artwork(song));
  const info = el("span", "track-info");
  info.append(el("span", "track-title", song.title || "제목 없음"));
  info.append(el("span", "track-sub", song.artist || "아티스트 미상"));
  const kind = recordType(song) === "album" ? (song.releaseType || "발매작") : "곡";
  const detail = [kind, song.version, fromSearch ? song.releaseTitle : String(song.review || "").replace(/\s+/g, " ").slice(0, 80), song.year].filter(Boolean).join(" · ");
  if (fromSearch) button.title = [song.title, song.artist, detail].filter(Boolean).join(" · ");
  if (detail) info.append(el("span", "track-note", detail));
  button.append(info);
  const existing = savedRecord(song);
  const status = el("span", fromSearch ? "add" : "score");
  const refresh = () => { const record = savedRecord(song); status.textContent = record ? `${Number(record.rating).toFixed(1)} ★ · 수정` : "평가하기"; };
  refresh();
  status.dataset.recordKey = recordKey(song);
  button.append(status);
  button.addEventListener("click", () => recordType(song) === "album" && !fromSearch ? openAlbum(song) : openEditor(savedRecord(song) || song));
  return button;
}

function renderLibrary() {
  const all = state.songs;
  const tracks = all.filter(x => recordType(x) === "track");
  const albums = all.filter(x => recordType(x) === "album");
  $("song-count").textContent = `${tracks.length} · ${albums.length}`;
  $("artist-count").textContent = String(new Set(all.map(x => x.artist).filter(Boolean)).size);
  const average = items => items.length ? (items.reduce((a, x) => a + x.rating, 0) / items.length).toFixed(1) : "—";
  $("average-score").textContent = `${average(tracks)} · ${average(albums)}`;

  const query = $("library-query").value.trim().toLocaleLowerCase();
  const items = all.filter(x => (libraryType === "all" || recordType(x) === libraryType) && `${x.title || ""} ${x.artist || ""}`.toLocaleLowerCase().includes(query));
  if ($("sort").value === "score") items.sort((a, b) => Number(b.rating) - Number(a.rating));
  else if ($("sort").value === "artist") items.sort((a, b) => (a.artist || "").localeCompare(b.artist || "", "ko"));
  else items.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  const list = $("library-list");
  list.replaceChildren();
  if (!items.length) {
    list.append(el("div", "empty", all.length
      ? "검색 조건에 맞는 곡이 없습니다."
      : "아직 평가한 곡이 없습니다. '곡 검색 · 추가'에서 첫 곡을 등록해 보세요."));
  } else items.forEach(song => list.append(songRow(song)));
}

function showTab(which) {
  const library = which === "library";
  $("library-panel").hidden = !library;
  $("search-panel").hidden = library;
  for (const [id, active] of [["library-tab", library], ["search-tab", !library]]) {
    $(id).classList.toggle("active", active);
    $(id).setAttribute("aria-selected", String(active));
  }
}

function artistName(recording) {
  return (recording["artist-credit"] || []).map(x => typeof x === "string" ? x : (x.name || x.artist?.name || "") + (x.joinphrase || "")).join("");
}

function normalizeRecording(rec) {
  const releases = rec.releases || [];
  const official = releases.filter(x => x.status === "Official");
  const options = official.length ? official : releases;
  const singles = options.filter(x => x["release-group"]?.["primary-type"] === "Single");
  const chosen = singles.find(x => x.title === rec.title) || singles[0] || options[0] || {};
  const groupId = chosen["release-group"]?.id || "";
  const coverReleaseIds = options.filter(x => x.id !== chosen.id && groupId && x["release-group"]?.id === groupId).slice(0, 3).map(x => x.id);
  return {
    id: rec.id,
    title: rec.title || "",
    artist: artistName(rec),
    releaseTitle: chosen.title || "",
    releaseId: chosen.id || "",
    releaseGroupId: groupId,
    alternateReleaseIds: coverReleaseIds,
    coverReleaseIds,
    version: rec.disambiguation || (chosen["release-group"]?.["secondary-types"] || []).join(" · "),
    year: String(rec["first-release-date"] || chosen.date || "").slice(0, 4)
  };
}

function quoteSearch(text) {
  return `"${text.replace(/[\\"]/g, "\\$&")}"`;
}

// Search, pagination and detail lookups share the same throttled queue.
function requestBrainz(path, params, view) {
  const task = musicQueue.then(async () => {
    const signal = view.controller.signal;
    if (signal.aborted) throw new DOMException("취소됨", "AbortError");
    const delay = Math.max(0, 1100 - (Date.now() - state.lastLookup));
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (signal.aborted) throw new DOMException("취소됨", "AbortError");
    state.lastLookup = Date.now();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(cancel, 20000);
    try {
      const query = new URLSearchParams({ ...params, fmt: "json" });
      const response = await fetch(`https://musicbrainz.org/ws/2/${path}?${query}`, { headers: { Accept: "application/json" }, signal: controller.signal });
      if (!response.ok) {
        if ([429, 503].includes(response.status)) throw new Error("MusicBrainz가 혼잡하거나 요청이 제한되었습니다. 잠시 후 다시 시도해 주세요.");
        throw new Error(`MusicBrainz 응답 ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (error.name === "AbortError" && !signal.aborted) throw new Error("응답이 늦어 조회를 중단했습니다. 다시 시도해 주세요.");
      throw error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener("abort", cancel);
    }
  });
  musicQueue = task.catch(() => {});
  return task;
}

function searchBrainz(entity, query, limit, view, offset = 0) {
  return requestBrainz(`${entity}/`, { query, limit: String(limit), offset: String(offset) }, view);
}

const searchKey = text => String(text || "").normalize("NFKC").toLocaleLowerCase().trim().replace(/\s+/g, " ");
const artistNames = artist => [artist.name, artist["sort-name"], ...(artist.aliases || []).map(x => x.name)].filter(Boolean);
const artistMatches = (artist, text) => artistNames(artist).some(x => searchKey(x) === searchKey(text));

function rankedResults(items, query) {
  const seen = new Set();
  const wanted = (Array.isArray(query) ? query : [query]).filter(Boolean).map(searchKey);
  const exact = item => [item.name, item.title, item["sort-name"], ...(item.aliases || []).map(x => x.name)].reduce((rank, text) => {
    const index = text ? wanted.indexOf(searchKey(text)) : -1;
    return Math.max(rank, index < 0 ? 0 : wanted.length - index);
  }, 0);
  return items.filter(item => isMBID(item.id) && !seen.has(item.id) && seen.add(item.id))
    .sort((a, b) => exact(b) - exact(a));
}

function compoundCandidates(query) {
  // At most two prefix/title splits. Keep the original title search in all cases.
  const spaces = [...query.matchAll(/\s+/g)].map(x => [x.index, x[0].length]);
  const separators = spaces.length ? spaces : [...query.matchAll(/[-–—]/g)].map(x => [x.index, 1]);
  const choices = separators.length ? [separators.at(-1), separators[0]] : [];
  const seen = new Set();
  return choices.map(([index, length]) => ({ artist: query.slice(0, index).trim().replace(/\s*[-–—]\s*$/, ""), title: query.slice(index + length).trim().replace(/^[-–—]\s*/, "") }))
    .filter(x => x.artist && x.title && !seen.has(`${x.artist}|${x.title}`) && seen.add(`${x.artist}|${x.title}`));
}

function artistQuery(text) {
  const q = quoteSearch(text);
  return `(artist:${q} OR alias:${q} OR sortname:${q})`;
}

function titleQuery(entity, text) {
  const q = quoteSearch(text);
  return entity === "recording" ? `(recording:${q} OR alias:${q})` : `(releasegroup:${q} OR release:${q} OR alias:${q})`;
}

function combinedQuery(entity, query, candidates, artists) {
  const terms = [`${titleQuery(entity, query)}^2`];
  for (const part of candidates) {
    const matches = artists.filter(x => artistMatches(x, part.artist)).slice(0, 2);
    if (matches.length) for (const artist of matches) terms.push(`(arid:${artist.id} AND ${titleQuery(entity, part.title)})`);
    else terms.push(`(artist:${quoteSearch(part.artist)} AND ${titleQuery(entity, part.title)})`);
  }
  return terms.length > 1 ? `(${terms.join(" OR ")})` : terms[0];
}

function externalLink(entity, id, text = "MusicBrainz 상세 ↗") {
  const link = el("a", "text-button", text);
  link.href = `https://musicbrainz.org/${entity}/${id}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  return link;
}

function artistInfo(artist) {
  const span = artist["life-span"] || {};
  return [artist.type, artist.country || artist.area?.name, artist.disambiguation, span.begin && `${span.begin}~${span.end || "현재"}`].filter(Boolean).join(" · ");
}

function artistRow(artist) {
  const button = el("button", "track");
  button.type = "button";
  button.append(el("span", "art", "♬"));
  const info = el("span", "track-info");
  info.append(el("span", "track-title", artist.name), el("span", "track-sub", `아티스트 · ${artistInfo(artist) || "정보 미등록"}`));
  const aliases = artistNames(artist).filter(x => x !== artist.name).slice(0, 3);
  if (aliases.length) info.append(el("span", "track-note", `다른 표기: ${aliases.join(", ")}`));
  button.append(info, el("span", "add", "탐색 ↗"));
  button.title = info.textContent;
  button.addEventListener("click", () => openArtist(artist));
  return button;
}

function normalizeAlbum(group) {
  if (group.type === "album") return group;
  return { type: "album", id: group.id, releaseGroupId: group.id, title: group.title || "", artist: artistName(group), year: String(group["first-release-date"] || "").slice(0, 4), releaseType: group["primary-type"] || "Other", secondaryTypes: group["secondary-types"] || [], version: group.disambiguation || "" };
}

function albumRow(group) {
  const album = normalizeAlbum(group);
  const button = el("button", "track");
  button.type = "button";
  button.append(artwork(album));
  const info = el("span", "track-info");
  const detail = [album.releaseType, ...(album.secondaryTypes || []), album.year, album.version].filter(Boolean).join(" · ");
  info.append(el("span", "track-title", album.title), el("span", "track-sub", album.artist || "아티스트 미상"), el("span", "track-note", detail));
  const status = el("span", "add");
  status.dataset.recordKey = recordKey(album);
  status.textContent = savedRecord(album) ? `${savedRecord(album).rating.toFixed(1)} ★ · 수정` : "상세 · 평가 ↗";
  button.append(info, status);
  button.title = `${album.title} · ${album.artist} · ${detail}`;
  button.addEventListener("click", () => openAlbum(album));
  return button;
}

function makeView(kind, name, push = false) {
  if (searchRun) {
    searchRun.controller.abort();
    if (push) viewStack.push(searchRun);
  }
  if (!push) { for (const old of viewStack) old.controller.abort(); viewStack = []; }
  const view = { kind, name, controller: new AbortController(), pending: true, root: el("div", "search-results"), context: el("div", ""), sections: [] };
  searchRun = view;
  mountView(view);
  return view;
}

function mountView(view) {
  $("search-context").replaceChildren(view.context);
  $("search-context").hidden = !view.context.childNodes.length;
  $("results").replaceChildren(view.root);
  $("search-submit").disabled = false;
  $("search-submit").textContent = "검색";
  refreshSearchCount(view);
  refreshSavedStatuses();
}

function goBack() {
  if (searchRun?.returnLibrary) {
    searchRun.controller.abort();
    searchRun = viewStack.pop() || null;
    if (searchRun) { searchRun.controller = new AbortController(); for (const page of searchRun.sections) page.controller = searchRun.controller; mountView(searchRun); }
    showTab("library");
    return;
  }
  if (!viewStack.length) return;
  searchRun.controller.abort();
  searchRun = viewStack.pop();
  searchRun.controller = new AbortController();
  mountView(searchRun);
  for (const page of searchRun.sections) { page.controller = searchRun.controller; updatePageControls(page); }
}

function addBack(view) {
  const button = el("button", "text-button", "← 이전 결과");
  button.type = "button";
  button.addEventListener("click", goBack);
  view.context.append(button);
}

function refreshSearchCount(view) {
  if (searchRun !== view) return;
  const count = view.sections.reduce((sum, page) => sum + page.items.length, 0);
  $("search-count").textContent = view.kind === "album" ? "발매작 상세" : `${count}개 표시${view.pending ? " · 조회 중…" : ""}`;
}

function createPage(view, entity, query, label, limit, row, rankQuery = "") {
  const page = { view, entity, query, label, limit, row, rankQuery, controller: view.controller, offset: 0, count: null, items: [], ids: new Set(), loading: false, done: false, failed: false };
  const section = el("section", "result-section");
  page.section = section;
  const heading = el("div", "section-header");
  page.summary = el("span", "muted hint", "조회 대기 중…");
  heading.append(el("h3", "result-heading", label), page.summary);
  page.list = el("div", "track-list");
  page.list.id = `results-${entity}`;
  page.message = el("p", "hint");
  page.more = el("button", "secondary more-button", "더보기");
  page.more.type = "button";
  page.more.addEventListener("click", () => loadPage(page));
  section.append(heading, page.list, page.message, page.more);
  view.root.append(section);
  view.sections.push(page);
  updatePageControls(page);
  return page;
}

function updatePageControls(page) {
  page.summary.textContent = `${page.items.length}${page.count === null ? "" : ` / ${page.count}`}개 표시`;
  page.more.disabled = page.loading || !page.query;
  page.more.hidden = page.done;
  page.more.textContent = page.loading ? "조회 중…" : page.failed ? "다시 시도" : page.offset ? "더보기" : "조회하기";
}

async function loadPage(page) {
  if (page.loading || page.done || !page.query || page.controller.signal.aborted) return null;
  const controller = page.controller;
  page.loading = true;
  page.failed = false;
  page.message.textContent = "요청 대기 · 조회 중…";
  page.message.className = "hint muted";
  updatePageControls(page);
  try {
    const json = await searchBrainz(page.entity, page.query, page.limit, { controller }, page.offset);
    if (controller.signal.aborted) return null;
    const field = page.entity === "artist" ? "artists" : page.entity === "recording" ? "recordings" : "release-groups";
    const raw = json[field] || [];
    const count = Number(json.count ?? json[`${page.entity}-count`]);
    page.count = Number.isFinite(count) ? count : null;
    const items = rankedResults(raw, page.rankQuery);
    for (const item of items) {
      if (page.ids.has(item.id)) continue;
      page.ids.add(item.id);
      page.items.push(item);
      page.list.append(page.row(item));
    }
    // The API offset counts raw results, including duplicate IDs.
    page.offset += raw.length;
    page.done = raw.length < page.limit || (page.count !== null && page.offset >= page.count);
    page.message.textContent = page.items.length ? "" : "결과가 없습니다. 다른 이름이나 별칭으로 검색해 보세요.";
    return json;
  } catch (error) {
    if (controller.signal.aborted) { page.message.textContent = "조회가 중단되었습니다. 필요하면 다시 조회하세요."; return null; }
    page.failed = true;
    page.message.className = "error";
    page.message.textContent = `${page.label} 조회 실패: ${error.message}`;
    return null;
  } finally {
    page.loading = false;
    updatePageControls(page);
    refreshSearchCount(page.view);
  }
}

async function startSearch(query) {
  if (searchRun?.kind === "search" && searchRun.pending && searchRun.name === query) return;
  lastSearchQuery = query;
  const view = makeView("search", query);
  const controller = view.controller;
  const candidates = compoundCandidates(query);
  const names = [...new Set([query, ...candidates.map(x => x.artist)])];
  const artistPage = createPage(view, "artist", names.map(artistQuery).join(" OR "), "아티스트", 8, artistRow, query);
  const albumPage = createPage(view, "release-group", "", "발매작 · Album / EP / Single", 12, albumRow, query);
  const trackPage = createPage(view, "recording", "", "곡", 20, rec => songRow(normalizeRecording(rec), true), query);
  // Dependent title queries wait for artist identification; do not expose an empty-query request.
  albumPage.more.disabled = true;
  trackPage.more.disabled = true;
  try {
    await loadPage(artistPage);
    if (controller.signal.aborted) return;
    const parts = artistPage.items.some(x => artistMatches(x, query)) ? [] : candidates;
    const exactTitles = parts.filter(part => artistPage.failed || artistPage.items.some(x => artistMatches(x, part.artist))).map(part => part.title);
    albumPage.rankQuery = trackPage.rankQuery = [query, ...exactTitles];
    albumPage.query = combinedQuery("release-group", query, parts, artistPage.items);
    trackPage.query = combinedQuery("recording", query, parts, artistPage.items);
    updatePageControls(albumPage); updatePageControls(trackPage);
    await loadPage(albumPage);
    if (!controller.signal.aborted) await loadPage(trackPage);
  } finally { view.pending = false; refreshSearchCount(view); }
}

async function openArtist(artist) {
  const view = makeView("artist", artist.name, true);
  view.artist = artist;
  addBack(view);
  view.context.append(el("h3", "", artist.name), el("p", "muted hint", artistInfo(artist)), el("p", "muted hint", `다른 표기: ${artistNames(artist).filter(x => x !== artist.name).slice(0, 5).join(", ") || "—"}`), externalLink("artist", artist.id));
  const form = el("form", "artist-search");
  const label = el("label", "sr-only", "이 아티스트의 곡·발매작 검색");
  const input = el("input"); input.type = "search"; input.placeholder = "이 아티스트의 곡·발매작 검색"; input.id = "artist-within-query"; label.htmlFor = input.id;
  const filter = el("select"); filter.id = "artist-release-type"; filter.setAttribute("aria-label", "발매작 종류");
  for (const [value, text] of [["", "전체 발매작"], ["Album", "앨범"], ["EP", "EP"], ["Single", "싱글"]]) { const option = el("option", "", text); option.value = value; filter.append(option); }
  const button = el("button", "primary", "검색"); button.type = "submit";
  form.append(label, input, filter, button); view.context.append(form);
  form.addEventListener("submit", event => { event.preventDefault(); artistSearch(view, input.value.trim(), filter.value); });
  filter.addEventListener("change", () => artistSearch(view, input.value.trim(), filter.value));
  mountView(view);
  await artistSearch(view, "", "");
}

async function artistSearch(view, text, type) {
  const signature = `${text}|${type}`;
  if (view.signature === signature && view.pending && view.sections.length) return;
  const previousTracks = view.searchText === text ? view.sections.find(page => page.entity === "recording" && !page.loading && (page.offset > 0 || page.done)) : null;
  view.controller.abort(); view.controller = new AbortController();
  const controller = view.controller;
  view.signature = signature; view.searchText = text; view.pending = true;
  view.root.replaceChildren(); view.sections = [];
  const base = `arid:${view.artist.id}`;
  const albums = createPage(view, "release-group", [base, text && titleQuery("release-group", text), type && `primarytype:${quoteSearch(type)}`].filter(Boolean).join(" AND "), "발매작", 12, albumRow, text);
  const tracks = previousTracks || createPage(view, "recording", [base, text && titleQuery("recording", text)].filter(Boolean).join(" AND "), "곡", 20, rec => songRow(normalizeRecording(rec), true), text);
  if (previousTracks) { tracks.controller = controller; view.sections.push(tracks); view.root.append(tracks.section); updatePageControls(tracks); }
  try { await loadPage(albums); if (!controller.signal.aborted && !previousTracks) await loadPage(tracks); }
  finally { if (view.controller === controller) { view.pending = false; refreshSearchCount(view); } }
}

function searchMusic(event) {
  event.preventDefault();
  const query = $("music-query").value.trim();
  if (!query) { alertUser("검색어를 입력하세요.", true); return; }
  startSearch(query);
}

function refreshSavedStatuses() {
  const roots = [document, ...viewStack.map(x => x.root)];
  for (const root of roots) for (const node of root.querySelectorAll("[data-record-key]")) {
    const record = state.songs.find(x => recordKey(x) === node.dataset.recordKey);
    node.textContent = record ? `${record.rating.toFixed(1)} ★ · 수정` : (node.dataset.albumDetail ? "발매작 평가하기" : node.dataset.recordKey.startsWith("album:") ? "상세 · 평가 ↗" : "평가하기");
  }
}

function releaseScore(release, album) {
  const media = release.media || [];
  const special = /deluxe|bonus|limited|expanded|anniversary|remaster|live|初回|限定/i.test(`${release.title || ""} ${release.disambiguation || ""}`);
  return (release.status === "Official" ? 100 : 0) + (media.some(x => x.format === "Digital Media") ? 20 : media.some(x => x.format === "CD") ? 10 : 0)
    + (searchKey(release.title) === searchKey(album.title) ? 10 : 0) - (special ? 40 : 0);
}

function releaseDescription(release) {
  return [release.date || "발매일 미상", release.country, ...(release.media || []).map(x => x.format).filter(Boolean), release.disambiguation].filter(Boolean).join(" · ");
}

async function openAlbum(group) {
  if (!isMBID(group.id)) return;
  const returnLibrary = !$("library-panel").hidden;
  showTab("search");
  const album = normalizeAlbum(group);
  const view = makeView("album", album.title, Boolean(searchRun));
  view.album = { ...album };
  view.returnLibrary = returnLibrary;
  addBack(view);
  const hero = el("div", "album-hero");
  hero.append(artwork(album));
  const info = el("div", "track-info");
  info.append(el("h2", "", album.title), el("p", "muted", album.artist), el("p", "hint", [album.releaseType, ...(album.secondaryTypes || []), album.year].filter(Boolean).join(" · ")), externalLink("release-group", album.id));
  hero.append(info); view.context.append(hero);
  const rate = el("button", "primary", "발매작 평가하기");
  rate.type = "button"; rate.dataset.recordKey = recordKey(album); rate.dataset.albumDetail = "true";
  rate.addEventListener("click", () => openEditor(savedRecord(album) || view.album));
  view.context.append(rate);
  const edition = el("div", "edition-info"); view.root.append(edition);
  const tracks = el("div", "album-tracks"); tracks.id = "album-tracks"; view.root.append(tracks);
  const retry = el("button", "secondary", "수록곡 다시 조회"); retry.type = "button"; retry.hidden = true; view.root.append(retry);
  let releases = [];
  let selected = "";
  let fetching = false;
  const loadRelease = async release => {
    if (fetching || view.controller.signal.aborted) return;
    const controller = view.controller;
    fetching = true; view.pending = true; retry.hidden = true;
    const selector = edition.querySelector("select"); if (selector) selector.disabled = true;
    selected = release?.id || "";
    tracks.replaceChildren(el("div", "empty", "수록곡 요청 대기 · 조회 중…"));
    try {
      let detail = release && albumCache.get(`release:${release.id}`);
      if (!detail) {
        if (!release) {
          let payload = albumCache.get(`group:${album.id}`);
          if (!payload) {
            payload = await requestBrainz("release/", { "release-group": album.id, inc: "media+artist-credits", limit: "100", offset: "0" }, { controller });
            if (controller.signal.aborted) return;
            albumCache.set(`group:${album.id}`, payload);
          }
          const raw = (payload.releases || []).filter(x => isMBID(x.id));
          const official = raw.filter(x => x.status === "Official");
          releases = (official.length ? official : raw).sort((a, b) => releaseScore(b, album) - releaseScore(a, album) || (a.date || "9999").localeCompare(b.date || "9999") || a.id.localeCompare(b.id));
          if (!releases.length) { tracks.replaceChildren(el("div", "empty", "등록된 발매판이 없어 수록곡을 확인할 수 없습니다.")); return; }
          release = releases[0]; selected = release.id;
          edition.replaceChildren();
          if (releases.length > 1) {
            const label = el("label", "hint", "수록곡 표시 판본");
            const select = el("select"); select.setAttribute("aria-label", "수록곡 표시 판본"); select.id = "album-edition";
            for (const item of releases) { const option = el("option", "", `${item.title} · ${releaseDescription(item)} · ${item.id.slice(0, 8)}`); option.value = item.id; select.append(option); }
            select.value = release.id; select.disabled = true;
            select.addEventListener("change", () => loadRelease(releases.find(x => x.id === select.value)));
            label.append(select); edition.append(label);
          }
          if (Number(payload["release-count"]) > raw.length) edition.append(el("p", "caption", `발매판 ${raw.length}개 중 대표 판본을 선택했습니다. 전체 발매판은 MusicBrainz에서 확인할 수 있습니다.`));
          detail = albumCache.get(`release:${release.id}`);
        }
        if (!detail) {
          detail = await requestBrainz(`release/${release.id}`, { inc: "recordings+artist-credits" }, { controller });
          if (controller.signal.aborted) return;
          albumCache.set(`release:${release.id}`, detail);
        }
      }
      if (controller.signal.aborted) return;
      view.album.releaseId = detail.id;
      const previous = edition.querySelector(".selected-edition"); previous?.remove();
      const chosen = el("div", "selected-edition");
      chosen.append(el("p", "hint", `표시 판본: ${detail.title} · ${releaseDescription(detail)}`), externalLink("release", detail.id, `Release ${detail.id.slice(0, 8)}… ↗`)); edition.append(chosen);
      tracks.replaceChildren();
      const media = (detail.media || []).slice().sort((a, b) => a.position - b.position);
      let total = 0;
      for (const medium of media) {
        const disc = el("section", "disc");
        const rows = [...(medium.pregap ? [medium.pregap] : []), ...(medium.tracks || [])].sort((a, b) => a.position - b.position);
        disc.append(el("h3", "result-heading", `Disc ${medium.position || 1}${medium.title ? ` · ${medium.title}` : ""} · ${medium.format || "매체 미상"}`));
        const list = el("div", "track-list");
        for (const track of rows) {
          total += 1;
          const rec = track.recording || {};
          if (!isMBID(rec.id)) { list.append(el("div", "empty", `${track.number || track.position}. ${track.title || rec.title || "제목 미등록"} — Recording 정보가 없어 평가할 수 없습니다.`)); continue; }
          const song = { type: "track", id: rec.id, title: track.title || rec.title || "", artist: artistName(track) || artistName(rec) || artistName(detail) || album.artist, releaseTitle: detail.title || album.title, releaseId: detail.id, releaseGroupId: album.id, alternateReleaseIds: [], coverReleaseIds: [], year: album.year, version: rec.disambiguation || (album.secondaryTypes || []).join(" · ") };
          const row = songRow(song, true);
          row.prepend(el("span", "track-number", String(track.number || track.position)));
          list.append(row);
        }
        if (!rows.length) list.append(el("div", "empty", "이 디스크의 수록곡 정보가 등록되어 있지 않습니다."));
        disc.append(list); tracks.append(disc);
      }
      if (!total) tracks.append(el("div", "empty", "이 판본에는 수록곡 정보가 없습니다. 다른 판본이나 MusicBrainz 원본을 확인해 주세요."));
      else tracks.prepend(el("p", "muted hint", `${total}곡 · 선택한 Release의 디스크·트랙 순서`));
    } catch (error) {
      if (!controller.signal.aborted) { tracks.replaceChildren(el("p", "error", `수록곡 조회 실패: ${error.message}`)); retry.hidden = false; }
    } finally {
      fetching = false; view.pending = false;
      const select = edition.querySelector("select"); if (select) { select.disabled = false; if (selected) select.value = selected; }
      refreshSearchCount(view); refreshSavedStatuses();
    }
  };
  retry.addEventListener("click", () => loadRelease(releases.find(x => x.id === selected)));
  mountView(view);
  await loadRelease(null);
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
  if (!isMBID(song.id)) { alertUser("MusicBrainz 곡 ID를 확인할 수 없습니다.", true); return; }
  const existing = savedRecord(song);
  state.editing = { ...(existing || song) };
  state.original = existing ? JSON.stringify(existing) : null;
  $("editor-title").textContent = `${existing ? "평가 수정" : "새 평가"} · ${recordType(song) === "album" ? (song.releaseType || "발매작") : "곡"}`;
  $("editor-subtitle").textContent = [`${song.title} — ${song.artist}`, song.version, song.releaseTitle].filter(Boolean).join(" · ");
  $("rating").value = existing ? String(existing.rating) : "5";
  updateRating();
  $("review").value = existing?.review || "";
  errorIn("editor-error", "");
  $("editor").showModal();
}

async function saveReview(event) {
  event.preventDefault();
  if (!state.editing || state.saving) return;
  if (!state.token) {
    $("admin").showModal();
    alertUser("먼저 관리자 연결을 완료해 주세요.");
    return;
  }
  const score = Number($("rating").value);
  if (!$("rating").value || !Number.isFinite(score) || score < 0.5 || score > 10 || score * 2 % 1 !== 0) {
    errorIn("editor-error", "평점은 0.5~10점 사이에서 선택해 주세요.");
    return;
  }
  const button = $("save");
  state.saving = true;
  updateRating();
  $("editor-close").disabled = true;
  $("rating").disabled = true;
  $("review").disabled = true;
  button.disabled = true;
  button.textContent = "저장 중…";
  errorIn("editor-error", "");
  try {
    const { songs, sha } = await readGitHub(state.token);
    const index = songs.findIndex(x => recordKey(x) === recordKey(state.editing));
    const latest = index >= 0 ? songs[index] : null;
    if ((latest ? JSON.stringify(latest) : null) !== state.original) {
      throw new Error("다른 기기에서 이 곡이 변경되었습니다. 감상평을 복사한 뒤 새로고침해 주세요.");
    }
    const record = {
      ...state.editing,
      type: recordType(state.editing),
      id: state.editing.id,
      title: state.editing.title,
      artist: state.editing.artist,
      releaseTitle: state.editing.releaseTitle || "",
      releaseId: state.editing.releaseId || "",
      releaseGroupId: state.editing.releaseGroupId || "",
      alternateReleaseIds: state.editing.alternateReleaseIds || [],
      coverReleaseIds: state.editing.coverReleaseIds || [],
      version: state.editing.version || "",
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
    button.disabled = false;
    button.textContent = "GitHub에 저장";
  }
}

async function connect(event) {
  event.preventDefault();
  const token = $("token").value.trim();
  const button = $("connect");
  button.disabled = true;
  errorIn("admin-error", "");
  try {
    await readGitHub(token);
    state.token = token;
    $("token").value = "";
    $("admin").close();
    $("admin-button").textContent = "관리자 연결됨";
    $("disconnect").hidden = false;
    alertUser("GitHub 조회 확인 완료. 쓰기 권한은 실제 저장 시 확인됩니다.");
  } catch (error) {
    errorIn("admin-error", `연결 실패: ${error.message}`);
  } finally {
    button.disabled = false;
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
$("editor-close").addEventListener("click", () => $("editor").close());
$("editor").addEventListener("cancel", event => { if (state.saving) event.preventDefault(); });
$("admin-button").addEventListener("click", () => $("admin").showModal());
$("admin-close").addEventListener("click", () => $("admin").close());
$("admin").addEventListener("close", () => { $("token").value = ""; });
$("admin-form").addEventListener("submit", connect);
$("disconnect").addEventListener("click", () => {
  state.token = "";
  $("disconnect").hidden = true;
  $("admin-button").textContent = "관리자 연결";
  $("admin").close();
  alertUser("연결 해제됨");
});
$("export").addEventListener("click", backup);
load();



