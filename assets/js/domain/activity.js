const DAY_MS = 24 * 60 * 60 * 1000;

export function studentActivitySummary(progressEntries, reviewSessions, now = new Date()) {
  const today = localISO(now);
  const dailyMemorization = progressEntries.filter(entry => entry.source === 'daily');
  const memorizedTodayPages = uniqueNumbers(
    dailyMemorization.filter(entry => entry.memorizedOn === today).map(entry => entry.pageNumber),
  ).length;
  const reviewedTodayPages = uniqueNumbers(
    reviewSessions
      .filter(session => session.reviewedOn === today)
      .flatMap(session => session.pages || []),
  ).length;

  const lastMemorizationDate = latestDate(dailyMemorization.map(entry => entry.memorizedOn));
  const lastReviewDate = latestDate(reviewSessions.map(session => session.reviewedOn));

  let todayStatus = 'none';
  if (memorizedTodayPages > 0 && reviewedTodayPages > 0) todayStatus = 'both';
  else if (memorizedTodayPages > 0) todayStatus = 'memorization';
  else if (reviewedTodayPages > 0) todayStatus = 'review';

  return {
    today,
    todayStatus,
    memorizedTodayPages,
    reviewedTodayPages,
    lastMemorizationDate,
    lastReviewDate,
    lastActivityDate: latestDate([lastMemorizationDate, lastReviewDate].filter(Boolean)),
    lastMemorizationLabel: relativeDateLabel(lastMemorizationDate, today),
    lastReviewLabel: relativeDateLabel(lastReviewDate, today),
  };
}

export function weeklyActivitySummary(progressEntries, reviewSessions, now = new Date()) {
  const today = localISO(now);
  const start = addDays(today, -6);
  const dailyMemorization = progressEntries.filter(entry =>
    entry.source === 'daily' && inRange(entry.memorizedOn, start, today),
  );
  const weekReviews = reviewSessions.filter(session => inRange(session.reviewedOn, start, today));

  const memorizedPages = uniqueNumbers(dailyMemorization.map(entry => entry.pageNumber)).length;
  const reviewedPages = weekReviews.reduce(
    (sum, session) => sum + uniqueNumbers(session.pages || []).length,
    0,
  );
  const activeDates = new Set([
    ...dailyMemorization.map(entry => entry.memorizedOn),
    ...weekReviews.map(session => session.reviewedOn),
  ]);

  return {
    from: start,
    to: today,
    memorizedPages,
    reviewedPages,
    activeDays: activeDates.size,
  };
}

export function relativeDateLabel(dateISO, todayISO = localISO()) {
  if (!validISO(dateISO)) return 'لا يوجد تسجيل';
  const days = Math.max(0, diffDays(dateISO, todayISO));
  if (days === 0) return 'اليوم';
  if (days === 1) return 'أمس';
  if (days === 2) return 'منذ يومين';
  if (days <= 10) return `منذ ${days} أيام`;
  return `منذ ${days} يومًا`;
}

function latestDate(values) {
  const valid = values.filter(validISO).sort();
  return valid.length ? valid[valid.length - 1] : null;
}

function uniqueNumbers(values) {
  return [...new Set(values.map(Number).filter(Number.isFinite))];
}

function inRange(value, from, to) {
  return validISO(value) && value >= from && value <= to;
}

function localISO(date = new Date()) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function diffDays(fromISO, toISO) {
  return Math.floor((isoToUtc(toISO) - isoToUtc(fromISO)) / DAY_MS);
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
