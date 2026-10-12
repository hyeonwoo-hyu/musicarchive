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
    if (!song || !isMBID(song.id) || ids.has(song.id)
      || typeof song.title !== "string" || typeof song.artist !== "string"
      || !Number.isFinite(song.rating) || song.rating < 0.5 || song.rating > 10 || song.rating * 2 % 1 !== 0
      || (song.review !== undefined && typeof song.review !== "string")
      || (song.alternateReleaseIds !== undefined && (!Array.isArray(song.alternateReleaseIds) || !song.alternateReleaseIds.every(isMBID)))) {
      throw new Error("data.json에 잘못된 평가 또는 중복 곡이 있습니다. 파일을 확인해 주세요.");
    }
    ids.add(song.id);
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
  const detail = fromSearch
    ? [song.version, song.releaseTitle, song.year].filter(Boolean).join(" · ")
    : String(song.review || "").replace(/\s+/g, " ").slice(0, 80);
  if (fromSearch) button.title = [song.title, song.artist, detail].filter(Boolean).join(" · ");
  if (detail) info.append(el("span", "track-note", detail));
  button.append(info);
  const existing = state.songs.find(x => x.id === song.id);
  button.append(el("span", fromSearch ? "add" : "score",
    fromSearch ? (existing ? "수정 ↗" : "추가 +") : `${Number(song.rating).toFixed(1)} ★`));
  button.addEventListener("click", () => openEditor(existing || song));
  return button;
}

function renderLibrary() {
  const all = state.songs;
  $("song-count").textContent = String(all.length);
  $("artist-count").textContent = String(new Set(all.map(x => x.artist).filter(Boolean)).size);
  $("average-score").textContent = all.length
    ? (all.reduce((a, x) => a + Number(x.rating || 0), 0) / all.length).toFixed(1)
    : "—";

  const query = $("library-query").value.trim().toLocaleLowerCase();
  const items = all.filter(x => `${x.title || ""} ${x.artist || ""}`.toLocaleLowerCase().includes(query));
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

// One queue for every MusicBrainz endpoint, including searches interrupted by a new query.
function searchBrainz(entity, query, limit, run) {
  const task = musicQueue.then(async () => {
    if (run.controller.signal.aborted) throw new DOMException("취소됨", "AbortError");
    const delay = Math.max(0, 1100 - (Date.now() - state.lastLookup));
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    if (run.controller.signal.aborted) throw new DOMException("취소됨", "AbortError");
    state.lastLookup = Date.now();
    const controller = new AbortController();
    const cancel = () => controller.abort();
    run.controller.signal.addEventListener("abort", cancel, { once: true });
    const timeout = setTimeout(cancel, 15000);
    try {
      const params = new URLSearchParams({ query, fmt: "json", limit: String(limit) });
      const response = await fetch(`https://musicbrainz.org/ws/2/${entity}/?${params}`, {
        headers: { Accept: "application/json" }, signal: controller.signal
      });
      if (!response.ok) {
        if (response.status === 429 || response.status === 503) throw new Error("MusicBrainz가 혼잡하거나 요청이 제한되었습니다. 잠시 후 다시 검색해 주세요.");
        throw new Error(`MusicBrainz 응답 ${response.status}`);
      }
      return await response.json();
    } catch (error) {
      if (error.name === "AbortError" && !run.controller.signal.aborted) throw new Error("응답이 늦어 검색을 중단했습니다. 다시 검색해 주세요.");
      throw error;
    } finally {
      clearTimeout(timeout);
      run.controller.signal.removeEventListener("abort", cancel);
    }
  });
  musicQueue = task.catch(() => {});
  return task;
}

function rankedResults(items, query) {
  const seen = new Set();
  const key = text => String(text || "").normalize("NFKC").toLocaleLowerCase().trim();
  const wanted = key(query);
  const exact = item => [item.name, item.title, item["sort-name"], ...(item.aliases || []).map(x => x.name)].some(x => key(x) === wanted);
  return items.filter(item => isMBID(item.id) && !seen.has(item.id) && seen.add(item.id))
    .sort((a, b) => Number(exact(b)) - Number(exact(a)) || Number(b.score || 0) - Number(a.score || 0));
}

function artistRow(artist) {
  const button = el("button", "track");
  button.type = "button";
  button.append(el("span", "art", "♬"));
  const info = el("span", "track-info");
  info.append(el("span", "track-title", artist.name));
  info.append(el("span", "track-sub", [artist.type, artist.country || artist.area?.name, artist.disambiguation].filter(Boolean).join(" · ") || "아티스트"));
  const aliases = (artist.aliases || []).map(x => x.name).filter(x => x !== artist.name).slice(0, 3);
  const detail = [artist["life-span"]?.begin && `시작: ${artist["life-span"].begin}`, aliases.length && `별칭: ${aliases.join(", ")}`].filter(Boolean).join(" · ");
  if (detail) info.append(el("span", "track-note", detail));
  button.append(info, el("span", "add", "곡·앨범 보기 ↗"));
  button.title = [artist.name, info.textContent].join(" · ");
  button.addEventListener("click", () => startSearch(lastSearchQuery, artist));
  return button;
}

function albumRow(group) {
  const link = el("a", "track");
  link.href = `https://musicbrainz.org/release-group/${group.id}`;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.append(artwork({ releaseGroupId: group.id }));
  const info = el("span", "track-info");
  info.append(el("span", "track-title", group.title));
  info.append(el("span", "track-sub", artistName(group) || "아티스트 미상"));
  const detail = [group["primary-type"], ...(group["secondary-types"] || []), String(group["first-release-date"] || "").slice(0, 4), group.disambiguation].filter(Boolean).join(" · ");
  if (detail) info.append(el("span", "track-note", detail));
  link.append(info, el("span", "add", "상세 ↗"));
  link.title = `${group.title} · ${artistName(group)} · ${detail} — MusicBrainz 상세 보기`;
  return link;
}

async function startSearch(query, artist = null) {
  const signature = artist ? `artist:${artist.id}` : `query:${query}`;
  if (searchRun?.pending && searchRun.signature === signature) return;
  searchRun?.controller.abort();
  const run = { controller: new AbortController(), signature, pending: true };
  searchRun = run;
  if (!artist) lastSearchQuery = query;
  const button = $("search-submit");
  button.disabled = true;
  button.textContent = "검색 중…";
  $("search-count").textContent = "검색 중…";
  const context = $("search-context");
  context.replaceChildren();
  context.hidden = !artist;
  if (artist) {
    const back = el("button", "text-button", "← 통합 검색 결과");
    back.type = "button";
    back.addEventListener("click", () => startSearch(lastSearchQuery));
    const original = el("a", "text-button", "MusicBrainz 상세 ↗");
    original.href = `https://musicbrainz.org/artist/${artist.id}`;
    original.target = "_blank";
    original.rel = "noopener noreferrer";
    context.append(el("h3", "", `${artist.name}의 곡·앨범`), el("p", "muted hint", artist.disambiguation || "선택한 아티스트의 결과만 표시합니다."), back, original);
  }
  const q = quoteSearch(query);
  const definitions = artist ? [
    { entity: "release-group", field: "release-groups", label: "앨범 · EP · 싱글", query: `arid:${artist.id}`, limit: 12, row: albumRow },
    { entity: "recording", field: "recordings", label: "곡", query: `arid:${artist.id}`, limit: 20, row: rec => songRow(normalizeRecording(rec), true) }
  ] : [
    { entity: "artist", field: "artists", label: "아티스트", query: `(artist:${q} OR alias:${q} OR sortname:${q})`, limit: 8, row: artistRow },
    { entity: "release-group", field: "release-groups", label: "앨범 · EP · 싱글", query: `releasegroup:${q}`, limit: 12, row: albumRow },
    { entity: "recording", field: "recordings", label: "곡", query: `recording:${q}`, limit: 20, row: rec => songRow(normalizeRecording(rec), true) }
  ];
  const results = $("results");
  results.replaceChildren();
  let count = 0;
  let failures = 0;
  for (const item of definitions) {
    const section = el("section", "result-section");
    section.append(el("h3", "result-heading", item.label));
    item.list = el("div", "track-list");
    item.list.id = `results-${item.entity}`;
    item.list.append(el("div", "empty", "검색 대기 중…"));
    section.append(item.list);
    results.append(section);
  }
  try {
    for (const item of definitions) {
      if (searchRun !== run) return;
      item.list.replaceChildren(el("div", "empty", "검색 중…"));
      try {
        const json = await searchBrainz(item.entity, item.query, item.limit, run);
        if (searchRun !== run) return;
        const items = rankedResults(json[item.field] || [], artist ? "" : query);
        count += items.length;
        item.list.replaceChildren();
        if (!items.length) item.list.append(el("div", "empty", "결과가 없습니다. 다른 이름이나 별칭으로 검색해 보세요."));
        else items.forEach(value => item.list.append(item.row(value)));
        $("search-count").textContent = `${count}개 표시 · 검색 중…`;
      } catch (error) {
        if (searchRun !== run || run.controller.signal.aborted) return;
        failures += 1;
        item.list.replaceChildren(el("div", "error", `${item.label} 검색 실패: ${error.message}`));
      }
    }
  } finally {
    run.pending = false;
    if (searchRun === run) {
      button.disabled = false;
      button.textContent = "검색";
      $("search-count").textContent = `${count}개 표시${failures ? ` · ${failures}개 종류 조회 실패` : ""}`;
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
  if (!isMBID(song.id)) { alertUser("MusicBrainz 곡 ID를 확인할 수 없습니다.", true); return; }
  const existing = state.songs.find(x => x.id === song.id);
  state.editing = { ...song };
  state.original = existing ? JSON.stringify(existing) : null;
  $("editor-title").textContent = existing ? "평가 수정" : "새 곡 평가";
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
    const index = songs.findIndex(x => x.id === state.editing.id);
    const latest = index >= 0 ? songs[index] : null;
    if ((latest ? JSON.stringify(latest) : null) !== state.original) {
      throw new Error("다른 기기에서 이 곡이 변경되었습니다. 감상평을 복사한 뒤 새로고침해 주세요.");
    }
    const record = {
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
    showTab("library");
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


