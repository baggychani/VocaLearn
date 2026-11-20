// data/teps_vocab.csv → words.js
// index.html을 파일로 바로 열어도 동작하도록 단어장을 스크립트 파일로 굽는다(파일 열기에서는 fetch를 쓸 수 없다).
// 사용법: node scripts/build-words.mjs [CSV 경로]
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = resolve(root, process.argv[2] ?? "data/teps_vocab.csv");
const target = resolve(root, "words.js");

/** RFC 4180 CSV: 큰따옴표로 감싼 칸 안의 쉼표·줄바꿈·"" 를 처리한다. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((cells) => cells.some((cell) => cell.trim()));
}

const [header, ...body] = parseCsv(readFileSync(source, "utf8").replace(/^﻿/, ""));
const column = (name) => {
  const at = header.indexOf(name);
  if (at < 0) throw new Error(`CSV에 ${name} 열이 없습니다: ${header.join(", ")}`);
  return at;
};
const [word, meaning, explanation, category] = ["word", "meaning", "explanation", "category"].map(column);

// 칸 수가 다르면 따옴표 없이 쉼표가 들어간 것이다. 그대로 두면 분류 칸이 설명 조각으로 밀린다.
body.forEach((cells, index) => {
  if (cells.length !== header.length) {
    throw new Error(`${index + 2}번째 줄의 칸 수가 ${cells.length}개입니다(${header.length}개여야 함). 쉼표가 든 칸은 큰따옴표로 감싸세요: ${cells[1]}`);
  }
});

const words = body.map((cells, index) => {
  const entry = {
    word: cells[word]?.trim(),
    meaning: cells[meaning]?.trim(),
    description: cells[explanation]?.trim() ?? "",
    category: cells[category]?.trim() ?? "",
  };
  if (!entry.word || !entry.meaning) throw new Error(`${index + 2}번째 줄의 word·meaning이 비어 있습니다.`);
  return entry;
});

const seen = new Set();
for (const { word: w } of words) {
  const key = w.toLowerCase();
  if (seen.has(key)) throw new Error(`단어가 중복됩니다: ${w}`);
  seen.add(key);
}

// 글자가 달라도 같은 단어족(abate·abatement, precedent·unprecedented)이면 사실상 중복이다.
// 한 단어짜리 표제어끼리 앞 6글자가 같거나 한쪽이 다른 쪽을 통째로 품으면 알려 준다.
// 일부러 함께 둔 짝은 ALLOWED_PAIRS에 적어 두면 더는 경고하지 않는다.
const ALLOWED_PAIRS = new Set([
  // 처음 500개에 있던 짝. 형태만 비슷한 것: command·commandeer 등. 실제 단어족: 아래 세 짝(형용사·부사·명사로 쓰임이 달라 둠).
  "commandeer|command", "contravene|contract", "expedite|expedient", "proliferate|prolific",
  "observe|serve", "serve|reserve",
  "inadvertent|inadvertently", "lethargic|lethargy", "ostensible|ostensibly",
  // 501번부터 추가한 단어: 모두 뜻이 다른 단어. tacit·taciturn, impetus·impetuous는 설명에 혼동 주의를 적었다.
  "circumvent|circumspect", "impetus|impetuous", "address|dress", "redress|dress", "tacit|taciturn", "conducive|conduct",
]);
const singles = words.map(({ word: w }) => w.toLowerCase()).filter((w) => !w.includes(" "));
const similar = [];
for (let i = 0; i < singles.length; i++) {
  for (let j = i + 1; j < singles.length; j++) {
    const [a, b] = [singles[i], singles[j]];
    const prefix = a.length >= 6 && b.length >= 6 && a.slice(0, 6) === b.slice(0, 6);
    const contains = Math.min(a.length, b.length) >= 5 && (a.includes(b) || b.includes(a));
    if ((prefix || contains) && !ALLOWED_PAIRS.has(`${a}|${b}`) && !ALLOWED_PAIRS.has(`${b}|${a}`)) similar.push(`${a} · ${b}`);
  }
}
if (similar.length) console.warn(`형태가 비슷한 표제어 ${similar.length}쌍(같은 단어족인지 확인하세요):\n  ${similar.join("\n  ")}`);

writeFileSync(target, `// 자동 생성 파일입니다. 직접 고치지 말고 data/teps_vocab.csv를 고친 뒤
// node scripts/build-words.mjs 를 실행하세요.
window.NEWTEPS_WORDS = ${JSON.stringify(words, null, 1)};
`);
console.log(`${words.length}개 단어 → ${target}`);
