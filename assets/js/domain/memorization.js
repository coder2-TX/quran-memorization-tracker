import { units, unitIndex, unitKey, surah, pageUnits, orderedSurahs } from './quran.js';

export function todayISO(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

export function snapshot(map, student, progressEntries, now = new Date()) {
  const route = units(map, student.direction);
  const stored = new Map(progressEntries.map(item => [item.unitKey || unitKey(item.surahNumber, item.pageNumber), item]));
  let completedUnits = 0;
  let next = null;
  let last = null;

  for (const unit of route) {
    if (stored.has(unit.key)) {
      completedUnits += 1;
      last = unit;
      continue;
    }
    next = unit;
    break;
  }

  const today = todayISO(now);
  const todayCount = progressEntries.filter(item => item.source === 'daily' && item.memorizedOn === today).length;
  return {
    totalUnits: route.length,
    completedUnits,
    progressPercent: route.length ? round1(completedUnits / route.length * 100) : 0,
    next,
    last,
    currentSurah: next ? surah(map, next.surahNumber) : null,
    todayCount,
    completed: !next,
    stored,
  };
}

export function initialProgress(map, student, mode, surahNumber, pageNumber, date = todayISO()) {
  if (mode === 'none') return [];
  const item = surah(map, Number(surahNumber));
  if (!item) throw new Error('اختر سورة صحيحة للحفظ السابق.');

  const targetPage = mode === 'completed_surah' ? item.pages[item.pages.length - 1] : Number(pageNumber);
  if (!item.pages.includes(targetPage)) throw new Error('اختر صفحة صحيحة ضمن السورة المحددة.');

  const route = units(map, student.direction);
  const index = unitIndex(map, student.direction, item.number, targetPage);
  if (index < 0) throw new Error('تعذر تحديد موضع الحفظ السابق.');
  const recordedAt = new Date().toISOString();
  return route.slice(0, index + 1).map(unit => ({
    key: `${student.id}|${unit.key}`,
    unitKey: unit.key,
    studentId: student.id,
    surahNumber: unit.surahNumber,
    pageNumber: unit.pageNumber,
    source: 'initial',
    memorizedOn: date,
    recordedAt,
  }));
}

export function createDailyEntry(studentId, nextUnit, memorizedOn = todayISO()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(memorizedOn)) throw new Error('تاريخ الحفظ غير صحيح.');
  return {
    key: `${studentId}|${nextUnit.key}`,
    unitKey: nextUnit.key,
    studentId,
    surahNumber: nextUnit.surahNumber,
    pageNumber: nextUnit.pageNumber,
    source: 'daily',
    memorizedOn,
    recordedAt: new Date().toISOString(),
  };
}

export function progressReport(map, snapshotData, progressEntries, now = new Date()) {
  const stored = new Map(progressEntries.map(item => [item.unitKey || unitKey(item.surahNumber, item.pageNumber), item]));
  const physicalPages = pageUnits(map);
  let physicalPagesCompleted = 0;
  for (const keys of physicalPages.values()) {
    if (keys.every(key => stored.has(key))) physicalPagesCompleted += 1;
  }

  let completedSurahs = 0;
  let partialSurahs = 0;
  for (const item of orderedSurahs(map)) {
    const completed = item.pages.filter(page => stored.has(unitKey(item.number, page))).length;
    if (completed === item.pages.length) completedSurahs += 1;
    else if (completed > 0) partialSurahs += 1;
  }

  const dailyEntries = progressEntries.filter(item => item.source === 'daily');
  const initialUnits = progressEntries.length - dailyEntries.length;
  const dailyByDate = new Map();
  for (const entry of dailyEntries) {
    dailyByDate.set(entry.memorizedOn, (dailyByDate.get(entry.memorizedOn) || 0) + 1);
  }

  const seven = lastSevenDays(dailyByDate, now);
  const sevenTotal = seven.reduce((sum, row) => sum + row.count, 0);
  let currentSurah = null;
  if (snapshotData.currentSurah) {
    const item = snapshotData.currentSurah;
    const completed = item.pages.filter(page => stored.has(unitKey(item.number, page))).length;
    currentSurah = {
      completed,
      remaining: item.pages.length - completed,
      total: item.pages.length,
      percent: item.pages.length ? round1(completed / item.pages.length * 100) : 0,
    };
  }

  const dates = [...dailyByDate.keys()].sort();
  return {
    physicalPagesCompleted,
    physicalPagesRemaining: map.meta.page_count - physicalPagesCompleted,
    physicalPagesTotal: map.meta.page_count,
    physicalProgressPercent: round1(physicalPagesCompleted / map.meta.page_count * 100),
    completedSurahs,
    remainingSurahs: map.meta.surah_count - completedSurahs,
    partialSurahs,
    totalSurahs: map.meta.surah_count,
    remainingUnits: snapshotData.totalUnits - snapshotData.completedUnits,
    initialUnits,
    dailyUnits: dailyEntries.length,
    activeDays: dailyByDate.size,
    lastSevenDays: seven,
    lastSevenTotal: sevenTotal,
    lastSevenAverage: round1(sevenTotal / 7),
    currentSurah,
    lastDailyDate: dates.length ? dates[dates.length - 1] : null,
  };
}

export function historyRows(map, progressEntries) {
  return [...progressEntries]
    .sort((a, b) => b.memorizedOn.localeCompare(a.memorizedOn) || b.recordedAt.localeCompare(a.recordedAt))
    .map(entry => ({ ...entry, surahName: surah(map, entry.surahNumber)?.name || '' }));
}

export function dashboardReport(items) {
  const count = items.length;
  const todayTotal = items.reduce((sum, item) => sum + item.snapshot.todayCount, 0);
  const activeToday = items.filter(item => item.snapshot.todayCount > 0).length;
  const completedStudents = items.filter(item => item.snapshot.completed).length;
  const avg = count ? items.reduce((sum, item) => sum + item.report.physicalProgressPercent, 0) / count : 0;
  return { studentsCount: count, activeToday, todayTotal, completedStudents, averageProgress: round1(avg) };
}

function lastSevenDays(dailyByDate, now) {
  const labels = ['ح', 'ن', 'ث', 'ر', 'خ', 'ج', 'س'];
  const rows = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date(now);
    date.setHours(12, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const key = todayISO(date);
    rows.push({ date: key, label: labels[date.getDay()], count: dailyByDate.get(key) || 0 });
  }
  return rows;
}

function round1(value) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}
