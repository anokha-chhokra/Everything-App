// Spots spending in free text ("spent ₹250 on lunch") so a journal entry can
// offer to log it as an expense. It only suggests; nothing is saved from here.
//
//   detectExpenses(text, { refDay, hints })
//     refDay: the entry's day ("YYYY-MM-DD"), needed to understand "on Monday".
//     hints:  category memory from buildHints(), so your own history wins over guesses.
//   returns up to 5 of { amountMinor, category, note, daysAgo }

const CATEGORY_WORDS = [
  ['Bills', /\b(rent|bill|bills|electricity|internet|wifi|recharged?|emi|insurance|subscription|broadband|water bill|gas|dth|maintenance|tuition|fees?|loan|mobile bill|phone bill)\b/],
  ['Health', /\b(doctor|medicine|medicines|pharmacy|gym|hospital|medical|checkup|dentist|clinic|physio|tablets|vitamins|lab test)\b/],
  ['Transport', /\b(uber|ola|rapido|auto|cab|taxi|bus|metro|train|fuel|petrol|diesel|parking|toll|flight|ticket|bike|scooter|bmtc|ride|airport|ferry)\b/],
  ['Food', /\b(lunch|dinner|breakfast|food|coffee|tea|chai|snack|snacks|groceries|grocery|restaurant|zomato|swiggy|biryani|pizza|cafe|meal|juice|dosa|idli|thali|burger|sandwich|dessert|tiffin|mess|canteen|bakery|chicken|eggs|milk|vegetables|fruits|ice cream)\b/],
  ['Fun', /\b(movie|movies|netflix|game|games|gaming|concert|party|trip|drinks|bar|pub|outing|show|cinema|ott|spotify|hotstar|prime)\b/],
  ['Shopping', /\b(shirt|shoes?|amazon|flipkart|clothes|mall|headphones|gift|bought|jeans|bag|watch|shopping|kurta|t-shirt|tshirt|laptop|charger|books?)\b/],
];

const MULTIPLIER = { k: 1e3, lakh: 1e5, lakhs: 1e5, lac: 1e5, lacs: 1e5, crore: 1e7, crores: 1e7 };
const SUFFIX = String.raw`(?:(k|lakhs?|lacs?|crores?)\b)?`;
const NUM = String.raw`(\d[\d,]*(?:\.\d{1,2})?)\s*${SUFFIX}`;
const MARKED_BEFORE = new RegExp(String.raw`(?:₹|\brs\.?|\binr\b|\$|€|£)\s*${NUM}`, 'gi');
const MARKED_AFTER = new RegExp(String.raw`\b${NUM}\s*(?:rs\.?\b|rupees?\b|inr\b|₹|bucks\b)`, 'gi');
const VERB = new RegExp(String.raw`\b(spent|paid|pay|bought|buy|cost|costs|ordered|recharged|booked)\b([^\d.!?;\n]{0,40}?)\b${NUM}`, 'gi');
const ALLOWED_AFTER_VERB_AMOUNT = /^\s*(?:$|[,.;!?]|(?:on|for|at|towards|in|to|via|using|by|only|rupees?|rs|inr|bucks|and|but|then|today|yesterday)\b)/i;
const NOTE_AFTER = /^\s*(?:on|for|at|towards)\s+(.{1,40}?)(?=$|[,.;!?]|\s+(?:and|but|then|today|yesterday|with)\b)/i;

// Money coming in, or numbers that are not spending ("my budget is ₹30000"), are not expenses.
const NOT_SPENDING = /\b(earn(?:ed|ing)?|receiv(?:ed|e)|salary|credited|refund(?:ed)?|cashback|income|reimburs\w*|budget|saved|savings|balance|target|goal|limit|won|invoice[d]?|payment received)\b/i;
const SPEND_VERB = /\b(spent|bought|ordered|booked|recharged|paid|pay|cost|costs)\b/i;
const BEING_PAID = /\b(?:got|get|getting|was|were|am|been|will be|be)\s+paid\b/gi;

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

function parseAmount(numText, suffix) {
  let n = Number(numText.replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  if (suffix) n *= MULTIPLIER[suffix.toLowerCase()] || 1;
  const minor = Math.round(n * 100);
  if (minor <= 0 || minor > 1_000_000_000 * 100) return null;
  return minor;
}

const STOP = new Set(['the', 'and', 'for', 'with', 'from', 'some', 'my', 'was', 'had', 'got', 'new', 'one']);
const wordsOf = (text) => (String(text).toLowerCase().match(/[a-z]{3,}/g) || []).filter((w) => !STOP.has(w));

/**
 * Learns "this word usually means this category" from past expenses.
 * expenses: [{ note, category }]  ->  { word: { category, n, share } }
 */
export function buildHints(expenses) {
  const counts = new Map();
  for (const e of expenses || []) {
    if (!e.note || !e.category) continue;
    for (const w of new Set(wordsOf(e.note))) {
      const m = counts.get(w) || new Map();
      m.set(e.category, (m.get(e.category) || 0) + 1);
      counts.set(w, m);
    }
  }
  const hints = {};
  for (const [w, m] of counts) {
    const total = [...m.values()].reduce((a, b) => a + b, 0);
    const [category, n] = [...m.entries()].sort((a, b) => b[1] - a[1])[0];
    hints[w] = { category, n, share: n / total };
  }
  return hints;
}

function categoryFor(text, hints) {
  const s = text.toLowerCase();
  let byKeyword = 'Other';
  for (const [name, re] of CATEGORY_WORDS) if (re.test(s)) { byKeyword = name; break; }
  if (!hints) return byKeyword;
  let best = null;
  for (const w of wordsOf(s)) {
    const hint = hints[w];
    if (hint && hint.share >= 0.6 && (!best || hint.n > best.n)) best = hint;
  }
  if (!best) return byKeyword;
  // Your own history beats the built-in word list once it has been seen twice; a single
  // past expense only fills in when the word list had no idea.
  if (best.n >= 2 || byKeyword === 'Other') return best.category;
  return byKeyword;
}

/** How many days before refDay the sentence says this happened (0 = same day). */
function daysAgoIn(sentence, refDay) {
  const s = sentence.toLowerCase();
  if (/\bday before yesterday\b/.test(s)) return 2;
  if (/\byesterday\b|\blast night\b/.test(s)) return 1;
  const n = s.match(/\b(\d{1,2}) days ago\b/);
  if (n) return Math.min(30, Number(n[1]));
  if (refDay && /^\d{4}-\d{2}-\d{2}$/.test(refDay)) {
    const named = s.match(/\b(?:last|on)\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/);
    if (named) {
      const ref = new Date(`${refDay}T00:00:00Z`).getUTCDay();
      const diff = (ref - WEEKDAYS.indexOf(named[1]) + 7) % 7;
      return diff === 0 ? 7 : diff;
    }
  }
  return 0;
}

// The part of a sentence between the nearest separators (comma, " and ", "+") around an amount.
function clauseAround(sentence, from, to) {
  const sep = /,|\band\b|\+/gi;
  let start = 0;
  let end = sentence.length;
  for (const m of sentence.matchAll(sep)) {
    if (m.index + m[0].length <= from) start = m.index + m[0].length;
    else if (m.index >= to) { end = m.index; break; }
  }
  return { start, text: sentence.slice(start, end) };
}

function notSpending(clauseText) {
  const t = clauseText.replace(BEING_PAID, ' <income> ');
  if (SPEND_VERB.test(t)) return false;
  return NOT_SPENDING.test(t) || t.includes('<income>');
}

function cleanNote(text) {
  return text
    .replace(/\b(a|an|the|my|some|of|for|on|at|is|was|to)\s*$/i, '')
    .replace(/^\s*(a|an|the|my|some)\s+/i, '')
    .replace(/\s+(?:on|last)\s+(?:sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i, '')
    .replace(/\s+(?:yesterday|today|last night)\b/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/** Returns up to 5 suggestions: [{ amountMinor, category, note, daysAgo }] */
export function detectExpenses(text, { refDay = null, hints = null } = {}) {
  if (typeof text !== 'string' || !text.trim()) return [];
  const found = [];
  const seen = new Set();
  const push = (sentence, clauseText, minor, note) => {
    const key = `${sentence}|${minor}`;
    if (minor === null || seen.has(key)) return;
    if (notSpending(clauseText)) return;
    seen.add(key);
    found.push({
      amountMinor: minor,
      category: categoryFor(`${clauseText} ${note || ''}`, hints),
      note: note || '',
      daysAgo: daysAgoIn(sentence, refDay),
    });
  };

  for (const sentence of text.split(/(?<=[.!?\n;])\s+|\n/)) {
    if (!sentence.trim()) continue;
    const marked = new Set();

    for (const re of [MARKED_BEFORE, MARKED_AFTER]) {
      re.lastIndex = 0;
      for (const m of sentence.matchAll(re)) {
        const clause = clauseAround(sentence, m.index, m.index + m[0].length);
        const at = m.index - clause.start;
        const after = clause.text.slice(at + m[0].length);
        const before = clause.text.slice(0, at);
        let note = (after.match(NOTE_AFTER) || [])[1] || '';
        if (!note) {
          // "lunch ₹250" or "paid rent of ₹12000": use the words before the amount
          note = before.replace(/\b(spent|paid|pay|bought|buy|cost|costs|ordered)\b/i, ' ').replace(/[₹$€£]/g, ' ').trim().split(/\s+/).slice(-3).join(' ');
        }
        const minor = parseAmount(m[1], m[2]);
        if (minor !== null) marked.add(minor);
        push(sentence, clause.text, minor, cleanNote(note));
      }
    }
    VERB.lastIndex = 0;
    for (const m of sentence.matchAll(VERB)) {
      const minor = parseAmount(m[3], m[4]);
      if (marked.has(minor)) continue; // already found with its currency symbol
      const after = sentence.slice(m.index + m[0].length);
      const bare = Number(m[3].replace(/,/g, ''));
      if (!ALLOWED_AFTER_VERB_AMOUNT.test(after)) continue; // "bought 3 apples" is not a price
      if (bare < 10 && !m[4]) continue; // small bare numbers are usually counts
      let note = (after.match(NOTE_AFTER) || [])[1] || '';
      if (!note) note = cleanNote(m[2]);
      const clause = clauseAround(sentence, m.index, m.index + m[0].length);
      push(sentence, clause.text, minor, cleanNote(note));
    }
  }
  return found.slice(0, 5);
}
