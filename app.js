"use strict";

const OWNER = "hyeonwoo-hyu";
const REPO = "musicarchive";
const FILE_API = `https://api.github.com/repos/${OWNER}/${REPO}/contents/data.json`;
const $ = id => document.getElementById(id);
const state = { songs: [], token: "", editing: null, original: null, lastLookup: 0, saving: false };
const isMBID = value => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value || "");

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

async function searchMusic(event) {
  event.preventDefault();
  const name = $("song-query").value.trim();
  const artist = $("artist-query").value.trim();
  if (!name && !artist) { alertUser("곡명이나 아티스트를 입력하세요.", true); return; }
  const button = $("search-submit");
  const results = $("results");
  button.disabled = true;
  button.textContent = "검색 중…";
  results.replaceChildren(el("div", "empty", "음악 검색 중…"));
  try {
    const delay = Math.max(0, 1100 - (Date.now() - state.lastLookup));
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    state.lastLookup = Date.now();
    const quote = x => `"${x.replace(/["\\]/g, " ")}"`;
    const q = [name && `recording:${quote(name)}`, artist && `artist:${quote(artist)}`].filter(Boolean).join(" AND ");
    const params = new URLSearchParams({ query: q, fmt: "json", limit: "20" });
    const response = await fetch(`https://musicbrainz.org/ws/2/recording/?${params}`, { headers: { Accept: "application/json" } });
    if (!response.ok) {
      if (response.status === 429 || response.status === 503) throw new Error("MusicBrainz가 혼잡하거나 요청이 제한되었습니다. 잠시 후 다시 검색해 주세요.");
      throw new Error(`MusicBrainz 응답 ${response.status}`);
    }
    const json = await response.json();
    const songs = (json.recordings || []).filter(x => isMBID(x.id)).map(normalizeRecording);
    results.replaceChildren();
    $("search-count").textContent = songs.length ? `${songs.length}개 표시` : "";
    if (!songs.length) results.append(el("div", "empty", "검색 결과가 없습니다. 아티스트를 비우거나 다른 표기(예: 아이유 → IU)로 검색해 보세요."));
    else songs.forEach(song => results.append(songRow(song, true)));
  } catch (error) {
    results.replaceChildren(el("div", "empty", `검색 실패: ${error.message}`));
    $("search-count").textContent = "";
    alertUser("MusicBrainz 검색 연결을 확인해 주세요.", true);
  } finally {
    button.disabled = false;
    button.textContent = "검색";
  }
}

function openEditor(song) {
  if (!isMBID(song.id)) { alertUser("MusicBrainz 곡 ID를 확인할 수 없습니다.", true); return; }
  const existing = state.songs.find(x => x.id === song.id);
  state.editing = { ...song };
  state.original = existing ? JSON.stringify(existing) : null;
  $("editor-title").textContent = existing ? "평가 수정" : "새 곡 평가";
  $("editor-subtitle").textContent = [`${song.title} — ${song.artist}`, song.version, song.releaseTitle].filter(Boolean).join(" · ");
  $("rating").value = existing ? String(existing.rating) : "";
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

for (let n = 10; n >= 0.5; n -= 0.5) {
  const option = el("option", "", n.toFixed(1));
  option.value = String(n);
  $("rating").append(option);
}
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

