import assert from 'node:assert/strict';
import { studentActivitySummary, weeklyActivitySummary, relativeDateLabel } from '../assets/js/domain/activity.js';

const progress = [
  { source: 'initial', pageNumber: 10, memorizedOn: '2026-09-01' },
  { source: 'daily', pageNumber: 11, memorizedOn: '2026-09-14' },
  { source: 'daily', pageNumber: 12, memorizedOn: '2026-09-15' },
  { source: 'daily', pageNumber: 12, memorizedOn: '2026-09-15' },
];
const reviews = [
  { reviewedOn: '2026-09-13', pages: [3, 4, 5] },
  { reviewedOn: '2026-09-15', pages: [6, 7] },
];
const now = new Date('2026-09-15T12:00:00');

const activity = studentActivitySummary(progress, reviews, now);
assert.equal(activity.todayStatus, 'both');
assert.equal(activity.memorizedTodayPages, 1);
assert.equal(activity.reviewedTodayPages, 2);
assert.equal(activity.lastMemorizationLabel, 'اليوم');
assert.equal(activity.lastReviewLabel, 'اليوم');

const weekly = weeklyActivitySummary(progress, reviews, now);
assert.equal(weekly.memorizedPages, 2);
assert.equal(weekly.reviewedPages, 5);
assert.equal(weekly.activeDays, 3);
assert.equal(relativeDateLabel('2026-09-14', '2026-09-15'), 'أمس');
assert.equal(relativeDateLabel(null, '2026-09-15'), 'لا يوجد تسجيل');

console.log('activity checks passed');
