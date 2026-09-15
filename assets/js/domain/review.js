import { orderedSurahs, pageUnits, surah, unitKey } from './quran.js';

const DAY_MS = 24 * 60 * 60 * 1000;

export const REVIEW_MODES = Object.freeze({
  sequential: 'sequential',
  balanced: 'balanced',
  free: 'free',
});

export function validateReviewDailyPages(value, totalPages = 604) {
  const pages = Number(value);
  if (!Number.isInteger(pages) || pages < 1 || pages > totalPages) {
    throw new Error(`هدف المراجعة اليومي يجب أن يكون رقمًا صحيحًا من 1 إلى ${totalPages}.`);
  }
  return pages;
}

export function validateReviewWeeklyDays(value) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 7) {
    throw new Error('أيام المراجعة في الأسبوع يجب أن تكون رقمًا صحيحًا من 1 إلى 7.');
  }
  return days;
}

export function createReviewPlan(mode, options = {}, totalPages = 604, todayISO = '') {
  if (!Object.values(REVIEW_MODES).includes(mode)) {
    throw new Error('اختر نمط مراجعة صحيحًا.');
  }

  const plan = {
    mode,
    startedOn: validISO(todayISO) ? todayISO : new Date().toISOString().slice(0, 10),
    updatedAt: new Date().toISOString(),
  };

  if (mode === REVIEW_MODES.free) return plan;

  plan.dailyPages = validateReviewDailyPages(options.dailyPages, totalPages);
  plan.weeklyDays = validateReviewWeeklyDays(options.weeklyDays ?? 7);

  if (mode === REVIEW_MODES.sequential) {
    plan.direction = options.direction === 'end_to_start' ? 'end_to_start' : 'start_to_end';
  }

  return plan;
}

export function reviewModeLabel(mode) {
  if (mode === REVIEW_MODES.sequential) return 'مراجعة تسلسلية';
  if (mode === REVIEW_MODES.balanced) return 'حديث + قديم';
  if (mode === REVIEW_MODES.free) return 'مراجعة حرة';
  return 'بدون إعداد مراجعة';
}

export function createManualReviewSegment(map, progressEntries, surahNumber, startPage, endPage, stream = 'free') {
  const memorized = memorizedUnitMap(progressEntries);
  const item = surah(map, Number(surahNumber));
  if (!item) throw new Error('اختر سورة صحيحة.');

  const available = item.pages
    .filter(page => memorized.has(unitKey(item.number, page)))
    .sort((a, b) => a - b);

  if (!available.length) throw new Error('لا توجد صفحات محفوظة من هذه السورة.');

  const from = Number(startPage);
  const to = Number(endPage);
  if (!available.includes(from) || !available.includes(to) || from > to) {
    throw new Error('اختر نطاقًا صحيحًا من الصفحات المحفوظة.');
  }

  const pages = item.pages.filter(page => page >= from && page <= to);
  if (!pages.length || pages.some(page => !available.includes(page))) {
    throw new Error('النطاق المحدد يحتوي على صفحة غير محفوظة.');
  }

  return {
    stream,
    surahNumber: item.number,
    surahName: item.name,
    pages,
    unitKeys: pages.map(page => unitKey(item.number, page)),
    startPage: pages[0],
    endPage: pages[pages.length - 1],
    completesSurah: pages.length === available.length,
  };
}


export function createManualReviewSurahRange(map, progressEntries, startSurahNumber, endSurahNumber, stream = 'free') {
  const memorized = memorizedUnitMap(progressEntries);
  const from = Number(startSurahNumber);
  const to = Number(endSurahNumber);
  const fromItem = surah(map, from);
  const toItem = surah(map, to);
  if (!fromItem || !toItem) throw new Error('اختر نطاق سور صحيحًا.');

  const direction = from <= to ? 1 : -1;
  const selected = [];
  for (let number = from; direction === 1 ? number <= to : number >= to; number += direction) {
    const item = surah(map, number);
    if (!item) throw new Error('تعذر تحديد إحدى السور في النطاق.');
    const fullyMemorized = item.pages.every(page => memorized.has(unitKey(item.number, page)));
    if (!fullyMemorized) {
      throw new Error(`سورة ${item.name} ليست محفوظة بالكامل. استخدم «حسب الصفحات» إذا أردت مراجعة الجزء المحفوظ منها فقط.`);
    }
    selected.push(item);
  }

  if (!selected.length) throw new Error('لا توجد سور محفوظة في النطاق المحدد.');

  const surahSegments = selected.map(item => ({
    surahNumber: item.number,
    surahName: item.name,
    pages: [...item.pages],
  }));
  const pages = [...new Set(surahSegments.flatMap(item => item.pages))].sort((a, b) => a - b);
  const unitKeys = surahSegments.flatMap(item => item.pages.map(page => unitKey(item.surahNumber, page)));

  return {
    scope: 'surahs',
    stream,
    surahNumber: selected.length === 1 ? selected[0].number : null,
    surahName: selected.length === 1 ? selected[0].name : '',
    surahSegments,
    pages,
    unitKeys,
    startPage: pages[0],
    endPage: pages[pages.length - 1],
    startSurahNumber: selected[0].number,
    endSurahNumber: selected[selected.length - 1].number,
    startSurahName: selected[0].name,
    endSurahName: selected[selected.length - 1].name,
    completesSurah: true,
  };
}


export function memorizedPhysicalPages(map, progressEntries) {
  const memorized = memorizedUnitMap(progressEntries);
  const byPage = pageUnits(map);
  const pages = [];

  for (const [pageNumber, keys] of byPage.entries()) {
    if (keys.length && keys.every(key => memorized.has(key))) pages.push(Number(pageNumber));
  }

  return pages.sort((a, b) => a - b);
}

export function createManualReviewPageRange(map, progressEntries, startPage, endPage, stream = 'free') {
  const available = new Set(memorizedPhysicalPages(map, progressEntries));
  const from = Number(startPage);
  const to = Number(endPage);

  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > Number(map.meta?.page_count || 604) || from > to) {
    throw new Error('اختر نطاق صفحات صحيحًا.');
  }

  const pages = [];
  for (let page = from; page <= to; page += 1) {
    if (!available.has(page)) throw new Error(`الصفحة ${page} ليست محفوظة بالكامل بعد.`);
    pages.push(page);
  }

  const byPage = pageUnits(map);
  const unitKeys = [...new Set(pages.flatMap(page => byPage.get(page) || []))];
  const grouped = new Map();
  for (const key of unitKeys) {
    const [surahNumberRaw, pageNumberRaw] = String(key).split(':');
    const surahNumber = Number(surahNumberRaw);
    const pageNumber = Number(pageNumberRaw);
    if (!grouped.has(surahNumber)) grouped.set(surahNumber, []);
    grouped.get(surahNumber).push(pageNumber);
  }
  const surahSegments = [...grouped.entries()].map(([surahNumber, segmentPages]) => ({
    surahNumber,
    surahName: surah(map, surahNumber)?.name || '',
    pages: [...new Set(segmentPages)].sort((a, b) => a - b),
  }));

  return {
    scope: 'pages',
    stream,
    surahNumber: surahSegments.length === 1 ? surahSegments[0].surahNumber : null,
    surahName: surahSegments.length === 1 ? surahSegments[0].surahName : '',
    surahSegments,
    pages,
    unitKeys,
    startPage: pages[0],
    endPage: pages[pages.length - 1],
    completesSurah: false,
  };
}

export function createReviewSession(studentId, planMode, segment, reviewedOn, status = 'done') {
  if (!validISO(reviewedOn)) throw new Error('تاريخ المراجعة غير صحيح.');
  if (!segment?.unitKeys?.length) throw new Error('لا توجد صفحات لتسجيل المراجعة.');
  if (!['done', 'reinforce'].includes(status)) throw new Error('حالة المراجعة غير صحيحة.');

  return {
    id: cryptoRandomId(),
    studentId,
    mode: planMode,
    stream: segment.stream || 'free',
    reviewedOn,
    status,
    scope: segment.scope || 'surah',
    surahNumber: segment.surahNumber == null ? null : Number(segment.surahNumber),
    surahSegments: Array.isArray(segment.surahSegments) ? segment.surahSegments.map(item => ({ ...item, pages: [...item.pages] })) : [],
    startPage: Number(segment.startPage),
    endPage: Number(segment.endPage),
    startSurahNumber: segment.startSurahNumber == null ? null : Number(segment.startSurahNumber),
    endSurahNumber: segment.endSurahNumber == null ? null : Number(segment.endSurahNumber),
    pages: [...segment.pages],
    unitKeys: [...segment.unitKeys],
    createdAt: new Date().toISOString(),
  };
}

export function reviewInsights(map, student, progressEntries, reviewSessions, now = new Date()) {
  const memorized = memorizedUnitMap(progressEntries);
  const latest = reviewLatestByUnit(reviewSessions);
  const bySurah = memorizedBySurah(map, memorized);
  const today = localISO(now);
  const todayUnits = reviewedUnitsOn(reviewSessions, today);
  const sevenDaysAgo = addDays(today, -6);
  const recentSeven = new Set();

  for (const session of reviewSessions) {
    if (String(session.reviewedOn || '') >= sevenDaysAgo && String(session.reviewedOn || '') <= today) {
      for (const key of session.unitKeys || []) recentSeven.add(key);
    }
  }

  let neverReviewed = 0;
  let needsReinforcement = 0;
  let overdue14 = 0;

  for (const key of memorized.keys()) {
    const last = latest.get(key);
    if (!last) {
      neverReviewed += 1;
      continue;
    }
    if (last.status === 'reinforce') needsReinforcement += 1;
    if (daysBetween(last.reviewedOn, today) >= 14) overdue14 += 1;
  }

  const staleSurahs = [];
  for (const [surahNumber, rows] of bySurah.entries()) {
    let never = 0;
    let reinforce = 0;
    let oldestDays = 0;
    let latestDate = null;

    for (const row of rows) {
      const last = latest.get(row.key);
      if (!last) {
        never += 1;
        continue;
      }
      if (last.status === 'reinforce') reinforce += 1;
      oldestDays = Math.max(oldestDays, daysBetween(last.reviewedOn, today));
      if (!latestDate || last.reviewedOn > latestDate) latestDate = last.reviewedOn;
    }

    staleSurahs.push({
      surahNumber: Number(surahNumber),
      surahName: rows[0].surahName,
      memorizedPages: rows.length,
      neverReviewedPages: never,
      reinforcementPages: reinforce,
      oldestDays,
      latestReviewDate: latestDate,
      priority: reinforce > 0 ? 3 : never > 0 ? 2 : oldestDays >= 14 ? 1 : 0,
    });
  }

  staleSurahs.sort((a, b) =>
    b.priority - a.priority ||
    b.reinforcementPages - a.reinforcementPages ||
    b.neverReviewedPages - a.neverReviewedPages ||
    b.oldestDays - a.oldestDays ||
    a.surahNumber - b.surahNumber,
  );

  const dailyPages = student.reviewPlan?.mode === REVIEW_MODES.free
    ? null
    : Number(student.reviewPlan?.dailyPages) || null;

  const reviewedToday = todayUnits.size;
  const remainingToday = dailyPages ? Math.max(0, dailyPages - reviewedToday) : null;
  const cycleDays = dailyPages ? Math.ceil(memorized.size / dailyPages) : null;

  return {
    memorizedUnits: memorized.size,
    reviewedToday,
    remainingToday,
    reviewedLastSeven: recentSeven.size,
    neverReviewed,
    overdue14,
    needsReinforcement,
    cycleDays,
    staleSurahs: staleSurahs.slice(0, 8),
  };
}

export function reviewHistoryRows(map, reviewSessions) {
  return [...reviewSessions]
    .sort((a, b) =>
      String(b.reviewedOn || '').localeCompare(String(a.reviewedOn || '')) ||
      String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
    )
    .map(session => ({
      ...session,
      scope: session.scope || 'surah',
      surahName: session.surahNumber == null ? '' : (surah(map, Number(session.surahNumber))?.name || ''),
      surahNames: Array.isArray(session.surahSegments)
        ? session.surahSegments.map(item => item.surahName || surah(map, Number(item.surahNumber))?.name || '').filter(Boolean)
        : [],
    }));
}

export function memorizedPagesForSurah(map, progressEntries, surahNumber) {
  const item = surah(map, Number(surahNumber));
  if (!item) return [];
  const memorized = memorizedUnitMap(progressEntries);
  return item.pages.filter(page => memorized.has(unitKey(item.number, page)));
}

export function memorizedSurahs(map, progressEntries) {
  const memorized = memorizedUnitMap(progressEntries);
  return orderedSurahs(map)
    .map(item => ({
      ...item,
      memorizedPages: item.pages.filter(page => memorized.has(unitKey(item.number, page))),
    }))
    .filter(item => item.memorizedPages.length > 0);
}

function memorizedUnitMap(progressEntries) {
  const result = new Map();
  for (const entry of progressEntries) {
    const key = entry.unitKey || unitKey(entry.surahNumber, entry.pageNumber);
    result.set(key, {
      key,
      surahNumber: Number(entry.surahNumber),
      pageNumber: Number(entry.pageNumber),
      source: entry.source,
      memorizedOn: entry.memorizedOn,
      recordedAt: entry.recordedAt,
    });
  }
  return result;
}

function memorizedBySurah(map, memorized) {
  const result = new Map();
  for (const item of orderedSurahs(map)) {
    const rows = item.pages
      .map(page => ({
        key: unitKey(item.number, page),
        surahNumber: item.number,
        surahName: item.name,
        pageNumber: page,
      }))
      .filter(row => memorized.has(row.key));
    if (rows.length) result.set(item.number, rows);
  }
  return result;
}

function reviewLatestByUnit(reviewSessions) {
  const latest = new Map();
  const sorted = [...reviewSessions].sort((a, b) =>
    String(a.reviewedOn || '').localeCompare(String(b.reviewedOn || '')) ||
    String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
  );

  for (const session of sorted) {
    for (const key of session.unitKeys || []) {
      latest.set(key, {
        reviewedOn: session.reviewedOn,
        status: session.status || 'done',
        sessionId: session.id,
      });
    }
  }
  return latest;
}

function reviewedUnitsOn(reviewSessions, dateISO) {
  const keys = new Set();
  for (const session of reviewSessions) {
    if (session.reviewedOn !== dateISO) continue;
    for (const key of session.unitKeys || []) keys.add(key);
  }
  return keys;
}

function localISO(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function daysBetween(fromISO, toISO) {
  if (!validISO(fromISO) || !validISO(toISO)) return 0;
  return Math.max(0, Math.floor((isoToUtc(toISO) - isoToUtc(fromISO)) / DAY_MS));
}

function addDays(iso, days) {
  const date = new Date(isoToUtc(iso));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function isoToUtc(iso) {
  const [year, month, day] = String(iso).split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function validISO(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function cryptoRandomId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `review-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
