"use strict";

const $ = (selector) => document.querySelector(selector);
const study = $("#study");
const dialog = $("#import-dialog");
const wordInput = $("#word-input");
const wordFile = $("#word-file");
const importError = $("#import-error");
const applyDeck = $("#apply-deck");
const storageKey = "newteps.study.v1";
/** 단어 가져오기 화면. 데이터베이스를 붙이기 전까지는 꺼 둔다(코드는 그대로 남긴다). */
const IMPORT_ENABLED = false;

const htmlEntities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (text) => text.replace(/[&<>"']/g, (character) => htmlEntities[character]);
const cleanKey = (text) => text.normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

// 24px 격자, 1.8px 선으로 그린 아이콘. 모양이 모두 같은 규칙을 따르도록 한곳에 모은다.
const ICONS = {
  left: '<path d="m14.5 5.5-6.5 6.5 6.5 6.5"/>',
  right: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  shuffle: '<path d="M3.5 7h3.2a4 4 0 0 1 3.2 1.6l4.2 6.8a4 4 0 0 0 3.2 1.6h3.2"/><path d="M3.5 17h3.2a4 4 0 0 0 3.2-1.6l.6-1M13.5 9.6l.6-1A4 4 0 0 1 17.3 7h3.2"/><path d="m18 4.5 2.5 2.5L18 9.5M18 14.5l2.5 2.5-2.5 2.5"/>',
  list: '<rect x="3.5" y="3.5" width="7" height="7" rx="1.9"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.9"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.9"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.9"/>',
  close: '<path d="M6.5 6.5l11 11m0-11-11 11"/>',
  restart: '<path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3L4.5 9"/><path d="M4.5 4.5V9H9"/>',
  clock: '<circle cx="12" cy="13" r="7.5"/><path d="M12 9.5V13l2.4 1.7M9.5 2.8h5"/>',
  check: '<path d="m5.5 12.5 4 4 9-9.5"/>',
  circle: '<circle cx="12" cy="12" r="7.5"/>',
  checkCircle: '<circle cx="12" cy="12" r="8.5"/><path d="m8.4 12.2 2.5 2.5 4.8-5"/>',
  correct: '<circle cx="12" cy="12" r="7"/>',
  wrong: '<path d="M6.5 6.5l11 11m0-11-11 11"/>',
  minus: '<path d="M6 12h12"/>',
  plus: '<path d="M12 6v12M6 12h12"/>',
  bookmark: '<path class="fillable" d="M7.2 3.8h9.6a1.4 1.4 0 0 1 1.4 1.4v15.1L12 16.1l-6.2 4.2V5.2a1.4 1.4 0 0 1 1.4-1.4z"/>',
  search: '<circle cx="10.8" cy="10.8" r="6.3"/><path d="m15.6 15.6 4.4 4.4"/>',
};
const icon = (name) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name]}</svg>`;

function parseDeck(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("단어가 한 개 이상 담긴 JSON 배열을 입력해 주세요.");
  }
  const seen = new Set();
  const parsed = [];
  for (const [index, item] of items.entries()) {
    if (!item || typeof item.word !== "string" || !item.word.trim() ||
        typeof item.meaning !== "string" || !item.meaning.trim()) {
      throw new Error(`${index + 1}번째 항목의 word(단어)와 meaning(뜻)을 확인해 주세요.`);
    }
    // 설명은 description 또는 explanation(CSV 열 이름) 어느 쪽으로 와도 받는다.
    const rawDescription = item.description ?? item.explanation;
    if (rawDescription !== undefined && typeof rawDescription !== "string") {
      throw new Error(`${index + 1}번째 항목의 description(설명문)은 문자열이어야 합니다.`);
    }
    if (item.category !== undefined && typeof item.category !== "string") {
      throw new Error(`${index + 1}번째 항목의 category(분류)는 문자열이어야 합니다.`);
    }
    const word = item.word.trim();
    const meaning = item.meaning.trim();
    const description = rawDescription?.trim() ?? "";
    const category = item.category?.trim() ?? "";
    const wordKey = cleanKey(word);
    const meaningKey = cleanKey(meaning);
    const id = JSON.stringify([wordKey, meaningKey]);
    if (seen.has(id)) continue;
    seen.add(id);
    parsed.push({ word, meaning, description, category, wordKey, meaningKey, id, position: parsed.length, senses: senses(meaning) });
  }
  linkSynonyms(parsed);
  return parsed;
}

/** 뜻을 쉼표·세미콜론·빗금으로 나눈 낱낱의 뜻. 괄호 속 보충 설명은 뺀다. "(왕위·책임을) 포기하다" → ["포기하다"] */
function senses(meaning) {
  return meaning.replace(/\([^)]*\)|\[[^\]]*\]/g, " ").split(/[,;/]/)
    .map((part) => part.replace(/\s+/g, " ").trim()).filter((part) => part.length >= 2);
}

/**
 * 설명에 "~와 유의어", "~ 계열", "~와 같은 뜻"으로 적힌 단어를 서로의 유의어로 묶는다.
 * 반의어·혼동 주의로 적힌 단어는 묶지 않는다. 그런 단어는 오히려 좋은 오답 보기다.
 */
function linkSynonyms(entries) {
  const byWord = new Map(entries.map((entry) => [entry.wordKey, entry]));
  for (const entry of entries) entry.synonyms = entry.synonyms ?? new Set();
  for (const entry of entries) {
    for (const sentence of entry.description.split(/(?<=[.!?])\s+/)) {
      if (!/유의어|계열|비슷|같은 뜻|가깝/.test(sentence) || /반의어|반대|혼동|구별|구분|다름|다르|형태/.test(sentence)) continue;
      for (const [key, other] of byWord) {
        if (other === entry || !sentence.toLowerCase().includes(key)) continue;
        if (!new RegExp(`(^|[^a-z])${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z]|$)`).test(sentence.toLowerCase())) continue;
        entry.synonyms.add(other.wordKey);
        other.synonyms.add(entry.wordKey);
      }
    }
  }
}

/* ---------- 퀴즈 설정 ---------- */

const EACH = { min: 5, max: 60, step: 5 };
const TOTAL = { min: 30, max: 3600, step: 30 };
const DEFAULT_SETTINGS = { count: 10, direction: "mixed", scope: "all", limit: "off", each: 10, total: null };
/** 전체 시간의 기본값: 문항당 10초꼴을 30초 단위로 맞춘다. */
const defaultTotal = (questions) => Math.max(TOTAL.min, Math.round(questions * 10 / TOTAL.step) * TOTAL.step);
const spoken = (seconds) => seconds < 60 ? `${seconds}초` : `${Math.floor(seconds / 60)}분${seconds % 60 ? ` ${seconds % 60}초` : ""}`;
const clock = (ms) => {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
};

function readSettings(raw) {
  const settings = { ...DEFAULT_SETTINGS };
  if (!raw || typeof raw !== "object") return settings;
  if (raw.count === "all" || (Number.isInteger(raw.count) && raw.count > 0)) settings.count = raw.count;
  if (["mixed", "meaning", "word"].includes(raw.direction)) settings.direction = raw.direction;
  if (["all", "unmastered", "bookmarked"].includes(raw.scope)) settings.scope = raw.scope;
  if (["off", "each", "total"].includes(raw.limit)) settings.limit = raw.limit;
  if (Number.isInteger(raw.each)) settings.each = clamp(raw.each, EACH.min, EACH.max);
  if (Number.isInteger(raw.total)) settings.total = clamp(raw.total, TOTAL.min, TOTAL.max);
  return settings;
}

function loadStudy() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(storageKey));
  } catch {
    saved = null;
  }
  let customDeck = null;
  try {
    customDeck = saved?.deck ? parseDeck(saved.deck) : null;
  } catch {
    customDeck = null;
  }
  return {
    customDeck,
    mastered: Array.isArray(saved?.mastered) ? new Set(saved.mastered) : new Set(),
    bookmarked: Array.isArray(saved?.bookmarks) ? new Set(saved.bookmarks) : new Set(),
    settings: readSettings(saved?.settings),
    view: saved?.view && typeof saved.view === "object" ? saved.view : {},
  };
}

const saved = loadStudy();
let customDeck = saved.customDeck;
let deck = customDeck ?? parseDeck(window.NEWTEPS_WORDS);
let mastered = saved.mastered;
/** 외웠는지와 상관없이 따로 모아 볼 단어. */
let bookmarked = saved.bookmarked;
let settings = saved.settings;
// 새로고침해도 보던 화면(모드·카드·필터)으로 돌아온다. 퀴즈 진행 상황은 남기지 않는다.
let mode = saved.view.mode === "quiz" ? "quiz" : "cards";

/**
 * subset: 퀴즈 오답처럼 일부 단어만 카드로 볼 때의 목록. onlyUnmastered·onlyBookmarked: 필터.
 * query: 목록 보기의 검색어.
 */
const cards = {
  order: [], index: 0, revealed: false, shuffled: false, subset: null, list: false, query: "",
  onlyUnmastered: saved.view.onlyUnmastered === true, onlyBookmarked: saved.view.onlyBookmarked === true,
};
cards.order = cardBase();
{
  // 보던 카드가 그새 필터에서 빠졌다면(외움 표시 등) 그 뒤의 첫 카드에서 이어 본다.
  const at = Math.max(0, deck.findIndex(({ id }) => id === saved.view.cardId));
  const resume = [...deck.slice(at), ...deck.slice(0, at)].find(fits);
  cards.index = Math.max(0, cards.order.indexOf(resume));
}

const TIMEOUT = "timeout";
const SKIP = "skip";
/** questions[].selected: null(아직) · 고른 단어 · TIMEOUT · SKIP. index가 문항 수와 같으면 결과 화면이다. */
let quiz = null;
let timerId = null;
let touchX = null;
/** 마지막 입력이 마우스·터치였는지. 키보드를 쓰기 시작하면 다시 false가 된다. */
let usingPointer = false;

function saveStudy() {
  const notice = $("#storage-notice");
  try {
    const entries = customDeck?.map(({ word, meaning, description, category }) => ({ word, meaning, description, category }));
    const view = { mode, cardId: cards.order[cards.index]?.id, onlyUnmastered: cards.onlyUnmastered, onlyBookmarked: cards.onlyBookmarked };
    localStorage.setItem(storageKey, JSON.stringify({ deck: entries, mastered: [...mastered], bookmarks: [...bookmarked], settings, view }));
    notice.hidden = true;
  } catch {
    notice.textContent = "브라우저 저장소를 사용할 수 없어 단어장과 암기 기록을 현재 탭에만 유지합니다.";
    notice.hidden = false;
  }
}

function shuffle(items) {
  const reordered = [...items];
  for (let index = reordered.length - 1; index > 0; index--) {
    const pick = Math.floor(Math.random() * (index + 1));
    [reordered[index], reordered[pick]] = [reordered[pick], reordered[index]];
  }
  return reordered;
}

function announce(message) {
  $("#announcement").textContent = message;
}

function stageTop(label, position, total, tools, completed = position, note = "") {
  return `<div class="stage-top">
      <p class="stage-count">${total ? `<span class="visually-hidden">${label} </span><strong>${position}</strong> / ${total}` : ""}${note ? `<span class="stage-note">${note}</span>` : ""}</p>
      ${tools}
    </div>
    <div class="progress" aria-hidden="true"><span style="width: ${total ? completed / total * 100 : 0}%"></span></div>`;
}

/* ---------- 플래시카드 ---------- */

/** 지금 켜 둔 필터(안 외운 단어만·북마크만)에 맞는 카드인지. */
function fits({ id }) {
  return (!cards.onlyUnmastered || !mastered.has(id)) && (!cards.onlyBookmarked || bookmarked.has(id));
}

/** 필터를 적용하기 전의 목록: 퀴즈 오답만 보는 중이면 그 단어들, 아니면 단어장 전체. */
function cardSource() {
  return cards.subset ?? deck;
}
function cardBase() {
  return cardSource().filter(fits);
}
const filtering = () => Boolean(cards.subset || cards.onlyUnmastered || cards.onlyBookmarked);

/** 순서를 다시 만든다. 섞지 않았다면 보던 카드를 그대로 연다. */
function rebuildCards(shuffled = cards.shuffled) {
  const currentId = cards.order[cards.index]?.id;
  const base = cardBase();
  cards.shuffled = shuffled;
  cards.order = shuffled ? shuffle(base) : [...base];
  const keep = shuffled ? -1 : cards.order.findIndex(({ id }) => id === currentId);
  cards.index = Math.max(0, keep);
  cards.revealed = false;
}

/**
 * 필터를 켠 채 외움·북마크 표시를 바꿔도 보던 카드는 바로 사라지지 않는다.
 * 다른 카드로 옮겨 갈 때 비로소 필터에 안 맞는 카드를 목록에서 뺀다. keepId 카드는 남긴다.
 */
function settle(keepId) {
  cards.order = cards.order.filter((card) => card.id === keepId || fits(card));
  cards.index = Math.max(0, cards.order.findIndex(({ id }) => id === keepId));
}

function emptyMarkup() {
  const source = cardSource();
  const marked = source.filter(({ id }) => bookmarked.has(id));
  if (cards.onlyBookmarked && !marked.length) {
    return `<div class="empty-state">
        <span class="empty-icon is-bookmark">${icon("bookmark")}</span>
        <p class="empty-title">아직 북마크한 단어가 없어요</p>
        <p class="muted">카드 왼쪽 위의 북마크를 누르거나 <kbd>B</kbd> 키로 담아 두면 여기서 모아 볼 수 있어요.</p>
        <div class="empty-actions"><button type="button" class="button primary" id="show-all-cards">전체 단어 보기</button></div>
      </div>`;
  }
  const scope = cards.onlyBookmarked ? marked : source;
  const name = cards.subset ? "퀴즈 오답" : cards.onlyBookmarked ? "북마크한 단어" : "단어";
  return `<div class="empty-state">
      <span class="empty-icon">${icon("checkCircle")}</span>
      <p class="empty-title">${name} ${scope.length}개를 모두 외웠어요</p>
      <p class="muted">전체 단어로 복습하거나, 암기 표시를 지우고 처음부터 다시 외울 수 있어요.</p>
      <div class="empty-actions">
        <button type="button" class="button" id="show-all-cards">전체 단어 보기</button>
        <button type="button" class="button primary" id="relearn-cards">${icon("restart")}처음부터 다시 외우기</button>
      </div>
    </div>`;
}

function listMarkup() {
  const { order, index } = cards;
  return `<label class="list-search">
      ${icon("search")}
      <input type="search" id="word-search" value="${escapeHtml(cards.query)}" placeholder="단어나 뜻으로 찾기" aria-label="단어 목록에서 찾기" autocomplete="off" spellcheck="false" enterkeyhint="go">
      <span class="search-count" id="search-count"></span>
    </label>
    <ol class="word-grid" id="word-grid">${order.map((item, at) => `<li data-at="${at}">
      <button type="button" class="word-tile" id="tile-${at}" data-card="${at}" ${at === index ? 'aria-current="true"' : ""}>
        <span class="tile-word" lang="en">${escapeHtml(item.word)}</span>
        <span class="tile-meaning">${escapeHtml(item.meaning)}</span>
        <span class="tile-marks">${bookmarked.has(item.id) ? `<span class="tile-bookmark" title="북마크">${icon("bookmark")}<span class="visually-hidden">북마크</span></span>` : ""}${mastered.has(item.id) ? `<span class="tile-check" title="암기 완료">${icon("check")}<span class="visually-hidden">암기 완료</span></span>` : ""}</span>
      </button>
    </li>`).join("")}</ol>
    <div class="search-empty" id="search-empty" hidden>
      <p id="search-empty-text"></p>
      ${filtering() ? '<button type="button" class="button" id="search-everywhere">전체 단어에서 찾기</button>' : ""}
    </div>`;
}

const searchKey = (text) => cleanKey(text).replace(/[·,;()[\]]/g, " ").replace(/\s+/g, " ").trim();
const matchesQuery = (item, query) => !query || item.wordKey.includes(query) || searchKey(item.meaning).includes(query);

/** 검색어에 맞는 칸만 남긴다. 입력할 때마다 화면 전체를 다시 그리지 않아야 입력 중인 글자가 끊기지 않는다. */
function applySearch() {
  const grid = $("#word-grid");
  if (!grid) return;
  const query = searchKey(cards.query);
  let shown = 0;
  for (const row of grid.children) {
    const visible = matchesQuery(cards.order[Number(row.dataset.at)], query);
    row.hidden = !visible;
    if (visible) shown++;
  }
  $("#search-count").textContent = query ? `${shown}개` : "";
  $("#search-empty").hidden = shown > 0;
  if (!shown) $("#search-empty-text").textContent = `‘${cards.query.trim()}’에 맞는 단어가 ${filtering() ? "이 목록에 " : ""}없어요.`;
}

function cardsMarkup() {
  const { order, index, list } = cards;
  const total = order.length;
  const markedCount = cardSource().filter(({ id }) => bookmarked.has(id)).length;
  const tools = `<div class="stage-tools">
      ${cards.subset ? `<button type="button" class="chip is-on" id="clear-subset" title="전체 단어로 돌아가기">퀴즈 오답 ${cards.subset.length}개${icon("close")}</button>` : ""}
      <button type="button" class="chip" id="filter-cards" aria-pressed="${cards.onlyUnmastered}">안 외운 단어만</button>
      <button type="button" class="chip bookmark-chip" id="filter-bookmarks" aria-pressed="${cards.onlyBookmarked}" title="북마크한 단어만 보기">${icon("bookmark")}북마크<span class="chip-count">${markedCount}</span></button>
      <button type="button" class="icon-button" id="shuffle-cards" aria-pressed="${cards.shuffled}" aria-label="순서 섞기" title="순서 섞기" ${cardBase().length < 2 ? "disabled" : ""}>${icon("shuffle")}</button>
      <button type="button" class="icon-button" id="toggle-list" aria-pressed="${list}" aria-label="단어 목록" title="단어 목록 (/ 로 검색)" ${total ? "" : "disabled"}>${icon("list")}</button>
    </div>`;

  if (!total) return `${stageTop("카드", 0, 0, tools)}${emptyMarkup()}`;
  if (list) return `${stageTop("카드", index + 1, total, tools)}${listMarkup()}`;

  const card = order[index];
  const { id, word, meaning, description } = card;
  const isMastered = mastered.has(id);
  const isMarked = bookmarked.has(id);
  // 필터에서 빠질 카드: 넘기기 전까지는 그대로 두고, 넘기면 빠진다는 것만 알린다.
  const leaving = !fits(card);
  const last = index === total - 1;
  const side = cards.revealed ? "back" : "front";
  return `${stageTop("카드", index + 1, total, tools, index + 1, leaving ? "넘기면 목록에서 빠져요" : "")}
    <div class="card-stage">
      <button type="button" class="card-bookmark" id="bookmark-card" data-side="${side}" aria-pressed="${isMarked}" aria-label="북마크" title="${isMarked ? "북마크 해제" : "북마크"} (B)">${icon("bookmark")}</button>
      <button type="button" class="flash-card" id="flip-card" data-side="${side}">
        ${isMastered ? `<span class="card-badge" title="암기 완료">${icon("check")}<span class="visually-hidden">암기 완료한 단어.</span></span>` : ""}
        <span class="card-face">${cards.revealed
          ? `<span class="card-word-small" lang="en">${escapeHtml(word)}</span>
            <span class="card-meaning">${escapeHtml(meaning)}</span>
            ${description ? `<span class="card-description">${escapeHtml(description)}</span>` : ""}`
          : `<span class="card-word" lang="en">${escapeHtml(word)}</span>`}</span>
        <span class="card-action">${cards.revealed ? "단어 보기" : "뜻 보기"}</span>
      </button>
    </div>
    <div class="card-actions">
      <button type="button" class="button" id="previous-card" ${index === 0 ? "disabled" : ""}>${icon("left")}이전</button>
      <button type="button" class="button master-button" id="master-card" aria-pressed="${isMastered}">${icon(isMastered ? "checkCircle" : "circle")}암기 완료</button>
      <button type="button" class="button primary" id="next-card" ${total < 2 && !leaving ? "disabled" : ""}>${last ? `처음으로${icon("restart")}` : `다음${icon("right")}`}</button>
    </div>`;
}

function flipCard() {
  if (!cards.order.length || cards.list) return;
  cards.revealed = !cards.revealed;
  render();
  const { word, meaning, description } = cards.order[cards.index];
  announce(cards.revealed ? [meaning, description].filter(Boolean).join(". ") : word);
}

function toggleMark(set, on, off) {
  const card = cards.order[cards.index];
  if (!card || cards.list) return;
  if (set.has(card.id)) set.delete(card.id);
  else set.add(card.id);
  render();
  announce(`${card.word}, ${set.has(card.id) ? on : off}${fits(card) ? "" : " 다음 카드로 넘기면 목록에서 빠져요."}`);
}
const toggleMastered = () => toggleMark(mastered, "암기 완료로 표시했어요.", "암기 완료 표시를 해제했어요.");
const toggleBookmark = () => toggleMark(bookmarked, "북마크했어요.", "북마크를 해제했어요.");

function moveCard(step, wrap = false) {
  const total = cards.order.length;
  const current = cards.order[cards.index];
  if (!current) return;
  const leaving = !fits(current);
  let next = cards.index + step;
  if (wrap) next = (next + total) % total;
  if (next < 0 || next >= total || (next === cards.index && !leaving)) return;
  settle(next === cards.index ? undefined : cards.order[next].id);
  cards.revealed = false;
  render();
  const now = cards.order[cards.index];
  announce(now ? `카드 ${cards.index + 1} / ${cards.order.length}. ${now.word}` : "이 목록의 카드를 모두 넘겼어요.");
}

/** 목록에서 카드를 골라 연다. 필터에서 빠질 카드는 이때 정리한다. */
function openCard(at) {
  const target = cards.order[at];
  if (!target) return;
  settle(target.id);
  cards.list = false;
  cards.revealed = false;
  render("flip-card");
}

function setList(on, focusId) {
  settle(cards.order[cards.index]?.id);
  cards.list = on;
  render(focusId ?? (on ? `tile-${cards.index}` : "flip-card"));
}

/** 암기 표시를 지운다. 되돌릴 수 있도록 지우기 전 기록을 알림에 붙여 둔다. */
function resetMastery(words, focusId) {
  const cleared = words.filter(({ id }) => mastered.has(id));
  if (!cleared.length) return;
  const before = new Set(mastered);
  for (const { id } of cleared) mastered.delete(id);
  rebuildCards();
  render(focusId);
  showToast(`암기 표시 ${cleared.length}개를 지웠어요.`, () => {
    mastered = before;
    rebuildCards();
    render();
    announce("암기 표시를 되돌렸어요.");
  });
}

/* ---------- 알림 ---------- */

let toastTimer = null;
let toastUndo = null;

function showToast(message, undo) {
  clearTimeout(toastTimer);
  toastUndo = undo;
  $("#toast-text").textContent = message;
  $("#toast-undo").hidden = !undo;
  $("#toast").hidden = false;
  announce(`${message}${undo ? " 되돌리기 버튼으로 되돌릴 수 있어요." : ""}`);
  toastTimer = setTimeout(hideToast, 8000);
}

function hideToast() {
  clearTimeout(toastTimer);
  toastUndo = null;
  $("#toast").hidden = true;
}

/* ---------- 퀴즈: 출제 ---------- */

function canDistract(target, option) {
  return target.wordKey !== option.wordKey && target.meaningKey !== option.meaningKey;
}

function eligibleWords() {
  return deck.filter((target) => deck.some((option) => canDistract(target, option)));
}

/**
 * 오답 보기가 정답과 헷갈릴수록 좋다. 같은 접미사(-ate, -ive, -tion…)나 비슷한 길이·첫 글자,
 * 그리고 단어장에서 가까이 적힌 단어(대개 같은 주제)에 점수를 주고, 약간의 무작위를 섞는다.
 */
function likeness(target, option) {
  const a = target.wordKey;
  const b = option.wordKey;
  // 같은 분류(동사·구어 표현 등)에서 먼저 고른다. 숙어 문제에 한 단어 보기가 섞이면 형태만 보고도 지울 수 있다.
  const sameKind = target.category === option.category ? 10 : 0;
  // 분류가 없는 단어장에서는 한 단어/여러 단어 표현끼리라도 맞춘다.
  const sameShape = a.includes(" ") === b.includes(" ") ? 3 : 0;
  let suffix = 0;
  while (suffix < Math.min(a.length, b.length) && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) suffix++;
  let score = Math.min(suffix, 4) * 1.1;
  if (Math.abs(a.length - b.length) <= 2) score += 1;
  if (a[0] === b[0]) score += .6;
  if (Math.abs(target.position - option.position) <= 3) score += .8;
  return sameKind + sameShape + score + Math.random() * 1.6;
}

/**
 * 보기로 같이 내면 정답이 둘이 되는 짝. 설명에 유의어로 묶였거나, 낱낱의 뜻이 같거나
 * 한쪽 뜻이 다른 쪽 뜻의 끝부분과 같으면("비용을 부담하다" ⊂ "책임·비용을 부담하다") 겹친다고 본다.
 */
function overlaps(a, b) {
  if (a.synonyms.has(b.wordKey) || b.synonyms.has(a.wordKey)) return true;
  return a.senses.some((x) => b.senses.some((y) => x === y ||
    (Math.min(x.length, y.length) >= 3 && (x.endsWith(y) || y.endsWith(x)))));
}

function makeQuestion(target, direction) {
  const optionKey = `${direction}Key`;
  const seen = new Set([target[optionKey]]);
  const choices = [target];
  const ranked = deck.filter((option) => canDistract(target, option) && !overlaps(target, option))
    .map((option) => ({ option, score: likeness(target, option) }))
    .sort((a, b) => b.score - a.score);
  for (const { option } of ranked) {
    if (seen.has(option[optionKey])) continue;
    seen.add(option[optionKey]);
    choices.push(option);
    if (choices.length === 4) break;
  }
  return { target, direction, choices: shuffle(choices), selected: null };
}

/** 설정 화면과 시작 버튼이 같은 값을 쓰도록 한곳에서 계산한다. */
function setupInfo() {
  const eligible = eligibleWords();
  const pools = {
    all: eligible,
    unmastered: eligible.filter(({ id }) => !mastered.has(id)),
    bookmarked: eligible.filter(({ id }) => bookmarked.has(id)),
  };
  // 고른 범위에 단어가 없으면(모두 외웠거나 북마크가 없으면) 전체에서 낸다.
  const scope = pools[settings.scope]?.length ? settings.scope : "all";
  const pool = pools[scope];
  const available = pool.length;
  const step = available > 10 ? 5 : 1;
  const min = Math.min(available, step === 5 ? 5 : 1);
  const count = settings.count === "all" ? available : clamp(settings.count, min, available);
  return { eligible, pools, scope, pool, available, step, min, count };
}

function limitFor(count) {
  if (settings.limit === "each") return { mode: "each", seconds: settings.each };
  if (settings.limit === "total") return { mode: "total", seconds: settings.total ?? defaultTotal(count) };
  return { mode: "off", seconds: 0 };
}

function stepper({ id, label, value, text, unit, min, max, small }) {
  return `<div class="stepper${small ? " is-small" : ""}" role="group" aria-label="${label}">
      <button type="button" id="${id}-down" data-stepper="${id}" data-delta="-1" aria-label="${label} 줄이기" ${value <= min ? "disabled" : ""}>${icon("minus")}</button>
      <output aria-live="polite"><strong>${text}</strong>${unit ? `<span>${unit}</span>` : ""}</output>
      <button type="button" id="${id}-up" data-stepper="${id}" data-delta="1" aria-label="${label} 늘리기" ${value >= max ? "disabled" : ""}>${icon("plus")}</button>
    </div>`;
}

function segmented(name, items, current, disabled = []) {
  return `<div class="segmented" role="group" aria-labelledby="label-${name}">${items.map(([value, label]) =>
    `<button type="button" id="set-${name}-${value}" data-setting="${name}" data-value="${value}" aria-pressed="${value === current}" ${disabled.includes(value) ? "disabled" : ""}>${label}</button>`).join("")}</div>`;
}

function quizSetupMarkup() {
  const info = setupInfo();
  if (!info.eligible.length) {
    return `<div class="quiz-setup">
      <h2 class="quiz-title" id="quiz-title" tabindex="-1">단어 퀴즈</h2>
      <p class="quiz-note muted">객관식 퀴즈를 만들려면 단어와 뜻이 서로 다른 항목이 2개 이상 필요합니다.</p>
      ${IMPORT_ENABLED ? '<button type="button" class="button primary" id="import-from-quiz">단어 가져오기</button>' : ""}
    </div>`;
  }
  const { available, count, min, pools, scope } = info;
  const scopes = [["all", "전체"], ["unmastered", "안 외운 단어"], ["bookmarked", "북마크"]];
  const presets = [10, 20, 50, 100].filter((size) => size >= min && size < available);
  const presetButtons = [...presets.map((size) => [String(size), size, String(size)]), ["all", available, "전체"]]
    .map(([key, size, label]) => `<button type="button" id="preset-${key}" data-preset="${key}" aria-pressed="${count === size}">${label}</button>`).join("");
  const limit = limitFor(count);

  return `<div class="quiz-setup">
    <h2 class="quiz-title" id="quiz-title" tabindex="-1">단어 퀴즈</h2>
    <div class="count-setting">
      ${stepper({ id: "count", label: "문항 수", value: count, text: String(count), unit: "문항", min, max: available })}
      <div class="presets" role="group" aria-label="문항 수 빠른 선택">${presetButtons}</div>
    </div>
    <div class="setting-rows">
      <div class="setting-row"><span id="label-direction">문제 유형</span>${segmented("direction", [["mixed", "혼합"], ["meaning", "뜻 고르기"], ["word", "단어 고르기"]], settings.direction)}</div>
      <div class="setting-row"><span id="label-scope">출제 범위</span>${segmented("scope",
        scopes.map(([key, label]) => [key, `${label} <span class="seg-count">${pools[key].length}</span>`]), scope,
        scopes.map(([key]) => key).filter((key) => !pools[key].length))}</div>
      <div class="setting-row"><span id="label-limit">시간 제한</span>${segmented("limit", [["off", "없음"], ["each", "문항당"], ["total", "전체"]], settings.limit)}</div>
      ${limit.mode === "off" ? "" : `<div class="setting-row is-sub"><span>${limit.mode === "each" ? "문항당 시간" : "전체 시간"}</span>${limit.mode === "each"
        ? stepper({ id: "each", label: "문항당 제한 시간", value: limit.seconds, text: spoken(limit.seconds), min: EACH.min, max: EACH.max, small: true })
        : stepper({ id: "total", label: "퀴즈 전체 제한 시간", value: limit.seconds, text: spoken(limit.seconds), min: TOTAL.min, max: TOTAL.max, small: true })}</div>`}
    </div>
    <button type="button" class="button primary start-button" id="start-quiz">퀴즈 시작</button>
  </div>`;
}

function stepSetting(name, delta) {
  const info = setupInfo();
  if (name === "count") {
    const { count, step, min, available } = info;
    const value = delta > 0 ? count - count % step + step : count % step ? count - count % step : count - step;
    settings.count = clamp(value, min, available);
    settings.total = null;
  } else if (name === "each") {
    settings.each = clamp(settings.each + delta * EACH.step, EACH.min, EACH.max);
  } else if (name === "total") {
    settings.total = clamp(limitFor(info.count).seconds + delta * TOTAL.step, TOTAL.min, TOTAL.max);
  }
  saveStudy();
  render();
}

/* ---------- 퀴즈: 진행 ---------- */

function startQuiz(targets, limit) {
  if (!targets) {
    const info = setupInfo();
    targets = shuffle(info.pool).slice(0, info.count);
    limit = limitFor(info.count);
  } else {
    targets = shuffle(targets);
  }
  if (!targets.length) return;
  const first = Math.random() < .5 ? "meaning" : "word";
  const second = first === "meaning" ? "word" : "meaning";
  const questions = targets.map((target, index) =>
    makeQuestion(target, settings.direction === "mixed" ? (index % 2 ? second : first) : settings.direction));
  const span = limit.seconds * 1000;
  quiz = { questions, targets, index: 0, limit, left: span, span: span || 1, expired: false };
  render("quiz-prompt");
  announce(`퀴즈를 시작해요. ${questions.length}문항.`);
}

const currentQuestion = () => quiz?.questions[quiz.index];

function selectChoice(index) {
  const question = currentQuestion();
  if (!question || question.selected !== null || !question.choices[index]) return;
  question.selected = question.choices[index];
  render("advance-quiz");
  const { word, meaning, description } = question.target;
  announce([question.selected === question.target ? "정답" : "오답", word, meaning, description].filter(Boolean).join(". "));
}

function skipQuestion() {
  const question = currentQuestion();
  if (!question || question.selected !== null) return;
  question.selected = SKIP;
  render("advance-quiz");
  announce(`정답은 ${question.target.word}, ${question.target.meaning}`);
}

function advanceQuiz() {
  if (currentQuestion()?.selected == null) return;
  quiz.index++;
  if (quiz.limit.mode === "each") quiz.left = quiz.span;
  const done = quiz.index >= quiz.questions.length;
  render(done ? "retry-all" : "quiz-prompt");
  if (done) announceResult();
}

function quitQuiz() {
  quiz = null;
  render("quiz-title");
}

function expire() {
  const question = currentQuestion();
  if (!question) return;
  if (quiz.limit.mode === "each") {
    question.selected = TIMEOUT;
    render("advance-quiz");
    announce(`시간 초과. 정답은 ${question.target.word}, ${question.target.meaning}`);
  } else {
    quiz.expired = true;
    quiz.index = quiz.questions.length;
    render("retry-all");
    announceResult();
  }
}

function timerState() {
  const fraction = clamp(quiz.left / quiz.span, 0, 1);
  return { fraction, low: fraction <= .25 || quiz.left <= 3000 };
}

function paintTimer() {
  const text = $("#quiz-clock-text");
  if (!text) return;
  const { fraction, low } = timerState();
  text.textContent = clock(quiz.left);
  $("#quiz-clock").classList.toggle("is-low", low);
  const fill = $("#quiz-timer-fill");
  if (fill) {
    fill.style.transform = `scaleX(${fraction})`;
    fill.classList.toggle("is-low", low);
  }
}

/** 시계는 답을 고르는 동안에만 간다. 답을 확인하는 동안, 다른 모드나 가져오기 창을 보는 동안에는 멈춘다. */
function syncTimer() {
  const question = currentQuestion();
  const ticking = mode === "quiz" && !dialog.open && question?.selected === null && quiz.limit.mode !== "off";
  if (ticking && timerId === null) {
    let last = performance.now();
    timerId = setInterval(() => {
      const now = performance.now();
      quiz.left = Math.max(0, quiz.left - (now - last));
      last = now;
      paintTimer();
      if (quiz.left <= 0) expire();
    }, 100);
  } else if (!ticking && timerId !== null) {
    clearInterval(timerId);
    timerId = null;
  }
}

function questionMarkup(question) {
  const { target, direction, choices, selected } = question;
  const answered = selected !== null;
  const asksMeaning = direction === "meaning";
  const timed = quiz.limit.mode !== "off";
  const total = quiz.questions.length;
  const last = quiz.index === total - 1;
  const { fraction, low } = timed ? timerState() : { fraction: 1, low: false };
  const tools = `<div class="stage-tools">
      ${timed ? `<span class="quiz-clock${low ? " is-low" : ""}" id="quiz-clock" role="timer" aria-label="남은 시간">${icon("clock")}<span id="quiz-clock-text">${clock(quiz.left)}</span></span>` : ""}
      <button type="button" class="icon-button" id="restart-quiz" aria-label="같은 문제로 처음부터 다시" title="처음부터 다시">${icon("restart")}</button>
      <button type="button" class="icon-button" id="quit-quiz" aria-label="퀴즈 끝내고 설정으로" title="퀴즈 끝내기 (Esc)">${icon("close")}</button>
    </div>`;

  const choiceButtons = choices.map((choice, index) => {
    const isTarget = choice === target;
    const state = !answered ? "" : isTarget ? "is-correct" : choice === selected ? "is-wrong" : "is-dim";
    const main = asksMeaning
      ? `<span class="choice-main">${escapeHtml(choice.meaning)}</span>`
      : `<span class="choice-main" lang="en">${escapeHtml(choice.word)}</span>`;
    // 답한 뒤에는 보기마다 짝이 되는 단어·뜻을 보여 준다. 오답 보기도 공부거리가 된다.
    const pair = answered ? `<small${asksMeaning ? ' lang="en"' : ""}>${escapeHtml(asksMeaning ? choice.word : choice.meaning)}</small>` : "";
    const mark = state === "is-correct" ? `<span class="choice-mark">${icon("correct")}<span class="visually-hidden">정답</span></span>`
      : state === "is-wrong" ? `<span class="choice-mark">${icon("wrong")}<span class="visually-hidden">고른 답</span></span>` : "";
    return `<button type="button" class="choice ${state}" id="choice-${index}" data-choice="${index}" ${answered ? "disabled" : ""}>
        <kbd class="choice-key" aria-hidden="true">${index + 1}</kbd>
        <span class="choice-text">${main}${pair}</span>${mark}
      </button>`;
  }).join("");

  let feedback = "";
  if (answered) {
    const right = selected === target;
    const status = right ? "정답" : selected === TIMEOUT ? "시간 초과" : selected === SKIP ? "모름" : "오답";
    feedback = `<div class="feedback ${right ? "is-good" : "is-bad"}">
        <p class="feedback-head">
          <span class="feedback-status">${icon(right ? "correct" : "wrong")}${status}</span>
          <span class="feedback-word" lang="en">${escapeHtml(target.word)}</span>
          <span class="feedback-meaning">${escapeHtml(target.meaning)}</span>
        </p>
        ${target.description ? `<p class="feedback-desc">${escapeHtml(target.description)}</p>` : ""}
      </div>`;
  }

  return `${stageTop("문제", quiz.index + 1, total, tools, quiz.index + Number(answered))}
    <div class="quiz-prompt-card">
      ${timed ? `<div class="quiz-timer" aria-hidden="true"><i id="quiz-timer-fill" class="${low ? "is-low" : ""}" style="transform: scaleX(${fraction})"></i></div>` : ""}
      <p class="quiz-prompt" id="quiz-prompt" tabindex="-1" lang="${asksMeaning ? "en" : "ko"}">${escapeHtml(asksMeaning ? target.word : target.meaning)}</p>
    </div>
    <div class="choices is-${direction}" role="group" aria-label="보기">${choiceButtons}</div>
    ${feedback}
    <div class="quiz-footer">${answered
      ? `<button type="button" class="button primary" id="advance-quiz">${last ? "결과 보기" : "다음 문제"}${icon("right")}</button>`
      : '<button type="button" class="button ghost" id="skip-question">잘 모르겠어요</button>'}</div>`;
}

const missedQuestions = () => quiz.questions.filter(({ selected, target }) => selected !== target);

function announceResult() {
  const total = quiz.questions.length;
  const right = total - missedQuestions().length;
  announce(`${quiz.expired ? "시간이 끝났어요. " : ""}${total}문항 중 ${right}문항 정답.`);
}

function quizResultsMarkup() {
  const missed = missedQuestions();
  const total = quiz.questions.length;
  const right = total - missed.length;
  const percent = Math.round(right / total * 100);
  const unanswered = quiz.questions.filter(({ selected }) => selected === null).length;
  return `<div class="quiz-results">
    <div class="result-head">
      ${quiz.expired ? `<p class="timeout-note">${icon("clock")}시간 종료 · 못 푼 문제 ${unanswered}개</p>` : ""}
      <h2 class="visually-hidden">퀴즈 결과</h2>
      <p class="score"><strong>${right}</strong><span>/ ${total}</span></p>
      <p class="score-caption">${missed.length ? `정답률 ${percent}%` : "모두 맞혔어요"}</p>
    </div>
    ${missed.length ? `<div>
      <p class="missed-title">다시 볼 단어 ${missed.length}개</p>
      <ul class="missed-list">${missed.map(({ target }) => `<li>
        <span class="missed-word" lang="en">${escapeHtml(target.word)}</span>
        <span class="missed-meaning">${escapeHtml(target.meaning)}</span>
        ${target.description ? `<p class="missed-desc">${escapeHtml(target.description)}</p>` : ""}
      </li>`).join("")}</ul>
    </div>` : ""}
    <div class="result-actions">
      <button type="button" class="button" id="quit-quiz">설정</button>
      ${missed.length ? `<button type="button" class="button" id="missed-cards">오답 카드로 복습</button>
        <button type="button" class="button" id="retry-missed">틀린 것만</button>` : ""}
      <button type="button" class="button primary" id="retry-all">다시 풀기</button>
    </div>
  </div>`;
}

/* ---------- 화면 ---------- */

function renderMastery() {
  const count = deck.filter(({ id }) => mastered.has(id)).length;
  const percent = Math.round(count / deck.length * 100);
  $("#mastery-ring").style.setProperty("--mastery", `${percent}%`);
  $("#mastery-percent").textContent = `${percent}%`;
  $("#mastery-count").innerHTML = `<strong>${count}</strong> / ${deck.length}`;
  $("#reset-mastery").hidden = count === 0;
}

function renderQuizPanel() {
  const panel = $("#quiz-panel");
  panel.hidden = !(mode === "quiz" && quiz);
  if (panel.hidden) return;
  const total = quiz.questions.length;
  const answered = quiz.questions.filter(({ selected }) => selected !== null).length;
  const right = quiz.questions.filter(({ selected, target }) => selected === target).length;
  const wrong = quiz.expired ? total - right : answered - right;
  const left = quiz.expired ? 0 : total - answered;
  $("#quiz-stats").innerHTML = `<div class="is-good"><dt>정답</dt><dd>${right}</dd></div>
    <div class="is-bad"><dt>오답</dt><dd>${wrong}</dd></div>
    <div><dt>남음</dt><dd>${left}</dd></div>`;
}

const SHORTCUTS = {
  cards: [["카드 뒤집기", ["Space"]], ["이전·다음 카드", ["←", "→"]], ["암기 완료", ["M"]], ["북마크", ["B"]], ["단어 찾기", ["/"]]],
  quiz: [["보기 선택", ["1", "–", "4"]], ["다음 문제", ["Enter"]], ["퀴즈 끝내기", ["Esc"]]],
};

function render(focusId) {
  const active = document.activeElement;
  const previousId = study.contains(active) ? active.id : "";
  const question = currentQuestion();
  $("#deck-label").textContent = customDeck ? "내 단어장" : "TEPS 단어장";
  document.querySelectorAll("[data-mode]").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.mode === mode));
  });
  $("#shortcut-list").innerHTML = SHORTCUTS[mode].map(([label, keys]) =>
    `<div><dt>${label}</dt><dd>${keys.map((key) => key === "–" ? "<span>–</span>" : `<kbd>${key}</kbd>`).join("")}</dd></div>`).join("");
  study.dataset.view = mode === "cards" ? (cards.list ? "list" : "cards") : !quiz ? "setup" : question ? "question" : "results";
  study.innerHTML = mode === "cards" ? cardsMarkup() : !quiz ? quizSetupMarkup() : question ? questionMarkup(question) : quizResultsMarkup();
  applySearch();
  renderMastery();
  renderQuizPanel();
  saveStudy();

  // 마우스·터치로 누른 뒤에는 포커스를 버튼에 남기지 않고 학습 영역에 둔다.
  // 그래야 방금 누른 '다음'에 테두리가 남지 않고, 이어서 누르는 Space·Enter가 그 버튼을 다시 누르지 않는다.
  const focusTarget = document.getElementById(focusId ?? previousId);
  if (usingPointer && (focusId || previousId)) study.focus({ preventScroll: true });
  else if (focusTarget && !focusTarget.disabled) focusTarget.focus({ preventScroll: !focusId });
  else if (previousId) study.focus({ preventScroll: true });
  syncTimer();
}

/* ---------- 입력 ---------- */

document.querySelectorAll("[data-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    if (mode === button.dataset.mode) return;
    mode = button.dataset.mode;
    render();
  });
});

study.addEventListener("click", (event) => {
  const button = event.target.closest("button");
  if (!button || button.disabled) return;
  const data = button.dataset;
  if (data.choice !== undefined) return selectChoice(Number(data.choice));
  if (data.card !== undefined) return openCard(Number(data.card));
  if (data.setting) {
    settings[data.setting] = data.value;
    saveStudy();
    return render();
  }
  if (data.preset) {
    settings.count = data.preset === "all" ? "all" : Number(data.preset);
    settings.total = null;
    saveStudy();
    return render();
  }
  if (data.stepper) return stepSetting(data.stepper, Number(data.delta));

  switch (button.id) {
    case "flip-card": flipCard(); break;
    case "previous-card": moveCard(-1); break;
    case "next-card": moveCard(1, true); break;
    case "shuffle-cards":
      rebuildCards(!cards.shuffled);
      render();
      announce(cards.shuffled ? `카드 순서를 섞었어요. ${cards.order[0]?.word ?? ""}` : "원래 순서로 돌아왔어요.");
      break;
    case "filter-cards":
    case "filter-bookmarks":
    case "show-all-cards":
    case "search-everywhere":
      if (button.id === "filter-cards") cards.onlyUnmastered = !cards.onlyUnmastered;
      else if (button.id === "filter-bookmarks") cards.onlyBookmarked = !cards.onlyBookmarked;
      else {
        cards.onlyUnmastered = false;
        cards.onlyBookmarked = false;
        cards.subset = null;
      }
      rebuildCards();
      render(button.id === "search-everywhere" ? "word-search" : cards.order.length ? undefined : "show-all-cards");
      announce(`카드 ${cards.order.length}장.`);
      break;
    case "relearn-cards":
      resetMastery(cards.onlyBookmarked ? cardSource().filter(({ id }) => bookmarked.has(id)) : cardSource(), "flip-card");
      break;
    case "clear-subset":
      cards.subset = null;
      rebuildCards();
      render("filter-cards");
      break;
    case "toggle-list": setList(!cards.list); break;
    case "master-card": toggleMastered(); break;
    case "bookmark-card": toggleBookmark(); break;
    case "start-quiz": startQuiz(); break;
    case "skip-question": skipQuestion(); break;
    case "advance-quiz": advanceQuiz(); break;
    case "restart-quiz":
    case "retry-all": startQuiz(quiz.targets, quiz.limit); break;
    case "retry-missed": {
      const missed = missedQuestions().map(({ target }) => target);
      // 틀린 것만 다시 풀 때 전체 시간은 문항 수에 맞춰 줄인다.
      const limit = quiz.limit.mode === "total"
        ? { mode: "total", seconds: Math.max(10, Math.round(quiz.limit.seconds / quiz.questions.length * missed.length)) }
        : quiz.limit;
      startQuiz(missed, limit);
      break;
    }
    case "missed-cards":
      cards.subset = missedQuestions().map(({ target }) => target);
      cards.onlyUnmastered = false;
      cards.onlyBookmarked = false;
      cards.list = false;
      cards.order = [...cards.subset];
      cards.shuffled = false;
      cards.index = 0;
      cards.revealed = false;
      mode = "cards";
      render("flip-card");
      announce(`퀴즈에서 틀린 단어 ${cards.order.length}개를 카드로 봐요.`);
      break;
    case "quit-quiz": quitQuiz(); break;
    case "import-from-quiz": openImport(); break;
  }
});

// 목록 검색: 입력할 때마다 칸만 거른다. Enter는 맨 위 결과를 열고, Esc는 검색어를 지운다.
study.addEventListener("input", (event) => {
  if (event.target.id !== "word-search") return;
  cards.query = event.target.value;
  applySearch();
});
study.addEventListener("keydown", (event) => {
  if (event.target.id !== "word-search" || event.isComposing) return;
  if (event.key === "Enter") {
    event.preventDefault();
    const first = [...$("#word-grid").children].find((row) => !row.hidden);
    if (first) openCard(Number(first.dataset.at));
  } else if (event.key === "Escape") {
    event.preventDefault();
    if (event.target.value) {
      event.target.value = "";
      cards.query = "";
      applySearch();
    } else {
      study.focus({ preventScroll: true });
    }
  } else if (event.key === "ArrowDown") {
    const first = [...$("#word-grid").children].find((row) => !row.hidden);
    if (first) {
      event.preventDefault();
      first.querySelector("button").focus();
    }
  }
});

$("#reset-mastery").addEventListener("click", () => resetMastery(deck));
$("#toast-undo").addEventListener("click", () => {
  const undo = toastUndo;
  hideToast();
  undo?.();
});

// 휴대폰에서는 카드를 옆으로 밀어 넘긴다.
study.addEventListener("touchstart", (event) => {
  touchX = mode === "cards" && event.target.closest("#flip-card") ? event.touches[0].clientX : null;
}, { passive: true });
study.addEventListener("touchend", (event) => {
  if (touchX === null) return;
  const distance = event.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(distance) > 60) moveCard(distance < 0 ? 1 : -1);
});

window.addEventListener("pointerdown", () => { usingPointer = true; }, true);

const typingIn = (target) => Boolean(target.closest?.("input, select, textarea, [contenteditable]"));
/** 카드 모드에서 Space는 어떤 버튼에 포커스가 있든 카드 뒤집기다. 버튼은 Enter로 누른다. */
const spaceFlips = (event) => mode === "cards" && !cards.list && event.key === " " && !dialog.open && !typingIn(event.target) &&
  !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;

// 버튼은 Space를 뗄 때 눌리므로, keyup도 막아야 포커스된 버튼이 함께 눌리지 않는다.
window.addEventListener("keyup", (event) => {
  if (spaceFlips(event)) event.preventDefault();
}, true);

window.addEventListener("keydown", (event) => {
  if (!["Shift", "Control", "Alt", "Meta"].includes(event.key)) usingPointer = false;
  if (dialog.open || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return;
  if (typingIn(event.target)) return;
  const onButton = event.target.closest?.("button, a");
  if (mode === "cards") {
    if (spaceFlips(event)) {
      event.preventDefault();
      if (!event.repeat) flipCard();
      return;
    }
    if (event.shiftKey) return;
    if (event.key === "/" || event.code === "Slash") {
      // 카드를 보다가도 /를 누르면 목록으로 바꾸고 검색창으로 간다.
      event.preventDefault();
      if (!cards.order.length) return;
      if (cards.list) $("#word-search").focus();
      else setList(true, "word-search");
      return;
    }
    if (cards.list) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      moveCard(event.key === "ArrowRight" ? 1 : -1);
    } else if ((event.code === "KeyM" || event.code === "KeyB") && !event.repeat) {
      // 한글 입력 상태여도 같은 자리의 키(ㅡ·ㅠ)로 동작하도록 key 대신 code를 본다.
      event.preventDefault();
      if (event.code === "KeyM") toggleMastered();
      else toggleBookmark();
    }
    return;
  }
  const question = currentQuestion();
  if (!question || event.repeat) return;
  if (event.key === "Escape") {
    event.preventDefault();
    quitQuiz();
  } else if (question.selected === null && /^[1-4]$/.test(event.key)) {
    event.preventDefault();
    selectChoice(Number(event.key) - 1);
  } else if (question.selected !== null && event.key === "Enter" && !onButton) {
    event.preventDefault();
    advanceQuiz();
  }
});

/* ---------- 단어 가져오기 ---------- */

function showImportError(message) {
  importError.textContent = message;
  importError.hidden = !message;
}

function openImport() {
  showImportError("");
  dialog.showModal();
  syncTimer();
  wordInput.focus();
}

$("#open-import").hidden = !IMPORT_ENABLED;
$("#open-import").addEventListener("click", openImport);
$("#close-import").addEventListener("click", () => dialog.close());
dialog.addEventListener("close", syncTimer);
wordInput.addEventListener("input", () => showImportError(""));
wordFile.addEventListener("change", async () => {
  const file = wordFile.files[0];
  if (!file) return;
  showImportError("");
  applyDeck.disabled = true;
  try {
    const contents = await file.text();
    if (wordFile.files[0] === file) wordInput.value = contents;
  } catch {
    if (wordFile.files[0] === file) showImportError("파일을 읽을 수 없어요. 내용을 복사해 붙여넣어 주세요.");
  } finally {
    if (wordFile.files[0] === file || !wordFile.files.length) applyDeck.disabled = false;
  }
});

$("#import-form").addEventListener("submit", (event) => {
  event.preventDefault();
  if (applyDeck.disabled) return;
  let incoming;
  try {
    incoming = parseDeck(JSON.parse(wordInput.value));
  } catch (error) {
    showImportError(error instanceof SyntaxError ? "JSON 형식을 확인해 주세요. 목록은 [로 시작하고 ]로 끝납니다." : error.message);
    return;
  }

  deck = customDeck = incoming;
  mastered = new Set(deck.filter(({ id }) => mastered.has(id)).map(({ id }) => id));
  Object.assign(cards, { order: [...deck], index: 0, revealed: false, shuffled: false, onlyUnmastered: false, subset: null, list: false });
  mode = "cards";
  quiz = null;
  saveStudy();
  event.currentTarget.reset();
  dialog.close();
  render("flip-card");
  announce(`내 단어장에 단어 ${deck.length}개를 적용했어요.`);
});

render();
