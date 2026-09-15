import fs from 'node:fs';
import assert from 'node:assert/strict';
import { initialProgress } from '../assets/js/domain/memorization.js';
import {
  REVIEW_MODES,
  createReviewPlan,
  createManualReviewSegment,
  createManualReviewSurahRange,
  createManualReviewPageRange,
  createReviewSession,
  reviewInsights,
  reviewHistoryRows,
  reviewModeLabel,
  validateReviewDailyPages,
  validateReviewWeeklyDays,
  memorizedPagesForSurah,
  memorizedPhysicalPages,
  memorizedSurahs,
} from '../assets/js/domain/review.js';

const map = JSON.parse(fs.readFileSync(new URL('../data/quran-map.json', import.meta.url), 'utf8'));

assert.equal(validateReviewDailyPages(10), 10);
assert.throws(() => validateReviewDailyPages(0), /رقمًا صحيحًا/);
assert.equal(validateReviewWeeklyDays(5), 5);
assert.throws(() => validateReviewWeeklyDays(0), /1 إلى 7/);
assert.throws(() => validateReviewWeeklyDays(8), /1 إلى 7/);
assert.throws(() => createReviewPlan('unknown', {}, 604, '2026-09-10'), /نمط مراجعة/);
assert.equal(reviewModeLabel(REVIEW_MODES.free), 'مراجعة حرة');

const student = {
  id: 'review-student',
  name: 'طالب المراجعة',
  direction: 'end_to_start',
};
const progress = initialProgress(map, student, 'completed_surah', 17, null, '2026-09-01');
assert.ok(progress.length > 0);

// المسارات الثلاثة تحفظ الإعداد فقط ولا تنشئ مقترحات مراجعة.
const sequentialPlan = createReviewPlan(REVIEW_MODES.sequential, { dailyPages: 7, weeklyDays: 5, direction: 'start_to_end' }, 604, '2026-09-10');
assert.equal(sequentialPlan.dailyPages, 7);
assert.equal(sequentialPlan.weeklyDays, 5);
assert.equal(sequentialPlan.direction, 'start_to_end');
const balancedPlan = createReviewPlan(REVIEW_MODES.balanced, { dailyPages: 10, weeklyDays: 4 }, 604, '2026-09-10');
assert.equal(balancedPlan.dailyPages, 10);
assert.equal(balancedPlan.weeklyDays, 4);
const legacyPlan = createReviewPlan(REVIEW_MODES.balanced, { dailyPages: 6 }, 604, '2026-09-10');
assert.equal(legacyPlan.weeklyDays, 7);
const freePlan = createReviewPlan(REVIEW_MODES.free, {}, 604, '2026-09-10');
assert.equal(freePlan.dailyPages, undefined);

// الإدخال اليدوي لا يسمح إلا من المحفوظ.
const manual = createManualReviewSegment(map, progress, 17, 282, 285, 'sequential');
assert.deepEqual(manual.pages, [282, 283, 284, 285]);
assert.equal(manual.stream, 'sequential');
assert.throws(() => createManualReviewSegment(map, progress, 16, 267, 270), /لا توجد صفحات محفوظة/);
assert.throws(() => createManualReviewSegment(map, progress, 17, 285, 282), /نطاقًا صحيحًا/);

// حديث + قديم يظل تصنيفًا يحدده الطالب وقت التسجيل.
const recent = createManualReviewSegment(map, progress, 17, 282, 283, 'recent');
const old = createManualReviewSegment(map, progress, 18, 293, 294, 'old');
const recentRecord = createReviewSession(student.id, REVIEW_MODES.balanced, recent, '2026-09-10', 'done');
const oldRecord = createReviewSession(student.id, REVIEW_MODES.balanced, old, '2026-09-10', 'reinforce');
assert.equal(recentRecord.stream, 'recent');
assert.equal(oldRecord.stream, 'old');
assert.equal(oldRecord.status, 'reinforce');

// المعلومات الإحصائية لا تفرض مراجعة، وإنما تصف السجل فقط.
student.reviewPlan = balancedPlan;
let insights = reviewInsights(map, student, progress, [], new Date('2026-09-10T12:00:00'));
assert.equal(insights.neverReviewed, progress.length);
assert.equal(insights.reviewedToday, 0);
assert.equal(insights.remainingToday, 10);

insights = reviewInsights(map, student, progress, [recentRecord, oldRecord], new Date('2026-09-10T12:00:00'));
assert.equal(insights.reviewedToday, recent.unitKeys.length + old.unitKeys.length);
assert.equal(insights.remainingToday, 10 - insights.reviewedToday);
assert.equal(insights.needsReinforcement, old.unitKeys.length);
assert.ok(insights.staleSurahs.length > 0);

// تسجيل لاحق ناجح لنفس الوحدات يمسح حالة "يحتاج تثبيت" لهذه الوحدات.
const oldDoneLater = createReviewSession(student.id, REVIEW_MODES.balanced, old, '2026-09-11', 'done');
insights = reviewInsights(map, student, progress, [oldRecord, oldDoneLater], new Date('2026-09-11T12:00:00'));
assert.equal(insights.needsReinforcement, 0);

// قوائم الاختيار لا تعرض إلا السور والصفحات المحفوظة.
const availableSurahs = memorizedSurahs(map, progress);
assert.ok(availableSurahs.some(item => item.number === 17));
assert.ok(!availableSurahs.some(item => item.number === 16));
assert.deepEqual(memorizedPagesForSurah(map, progress, 17).slice(0, 4), [282, 283, 284, 285]);



// حسب السور يعني من سورة إلى سورة، والسور الجزئية لا تقبل في هذا الوضع.
const bySurahs = createManualReviewSurahRange(map, progress, 17, 18, 'sequential');
assert.equal(bySurahs.scope, 'surahs');
assert.equal(bySurahs.startSurahNumber, 17);
assert.equal(bySurahs.endSurahNumber, 18);
assert.deepEqual(bySurahs.surahSegments.map(item => item.surahNumber), [17, 18]);
assert.ok(bySurahs.pages.length > 0);
const bySurahsDescending = createManualReviewSurahRange(map, progress, 18, 17, 'sequential');
assert.deepEqual(bySurahsDescending.surahSegments.map(item => item.surahNumber), [18, 17]);
assert.throws(() => createManualReviewSurahRange(map, progress, 17, 16), /ليست محفوظة بالكامل/);
const bySurahsRecord = createReviewSession(student.id, REVIEW_MODES.sequential, bySurahs, '2026-09-11', 'done');
assert.equal(bySurahsRecord.scope, 'surahs');
assert.equal(bySurahsRecord.startSurahNumber, 17);
assert.equal(bySurahsRecord.endSurahNumber, 18);

// يمكن التسجيل مباشرة من صفحة إلى صفحة، حتى عبر أكثر من سورة، بشرط أن تكون الصفحات محفوظة بالكامل.
const physicalPages = memorizedPhysicalPages(map, progress);
assert.ok(physicalPages.includes(282));
assert.ok(physicalPages.includes(294));
assert.ok(!physicalPages.includes(281));
const byPages = createManualReviewPageRange(map, progress, 282, 294, 'free');
assert.equal(byPages.scope, 'pages');
assert.equal(byPages.startPage, 282);
assert.equal(byPages.endPage, 294);
assert.equal(byPages.pages.length, 13);
assert.ok(byPages.surahSegments.length >= 2);
assert.throws(() => createManualReviewPageRange(map, progress, 281, 282), /ليست محفوظة بالكامل/);
const byPagesRecord = createReviewSession(student.id, REVIEW_MODES.free, byPages, '2026-09-12', 'done');
assert.equal(byPagesRecord.scope, 'pages');
assert.equal(byPagesRecord.surahNumber, null);
assert.ok(byPagesRecord.unitKeys.length >= byPages.pages.length);

const history = reviewHistoryRows(map, [oldRecord, recentRecord, oldDoneLater, bySurahsRecord, byPagesRecord]);
assert.equal(history[0].reviewedOn, '2026-09-12');
assert.equal(history[0].scope, 'pages');
assert.ok(history[0].surahNames.length >= 2);

console.log('review checks passed');
