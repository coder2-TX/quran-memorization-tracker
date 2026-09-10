import fs from 'node:fs';
import assert from 'node:assert/strict';
import { units, unitIndex, unitKey } from '../assets/js/domain/quran.js';
import { snapshot, initialProgress, createDailyEntry, progressReport } from '../assets/js/domain/memorization.js';

const map = JSON.parse(fs.readFileSync(new URL('../data/quran-map.json', import.meta.url), 'utf8'));
const student = { id:'s1', name:'اختبار', direction:'end_to_start' };

assert.equal(map.meta.verse_count, 6236);
assert.equal(map.meta.surah_count, 114);
assert.equal(map.meta.page_count, 604);
assert.equal(map.surahs['16'].start_page, 267);
assert.equal(map.surahs['15'].start_page, 262);
assert.equal(map.surahs['17'].start_page, 282);

const initial = initialProgress(map, student, 'completed_surah', 17, null, '2026-09-10');
let snap = snapshot(map, student, initial, new Date('2026-09-10T12:00:00'));
assert.equal(snap.next.surahNumber, 16);
assert.equal(snap.next.pageNumber, 267);

const toEndNahl = unitIndex(map, 'end_to_start', 16, map.surahs['16'].end_page);
const route = units(map,'end_to_start');
const progressNahl = route.slice(0,toEndNahl+1).map(u=>({key:`s1|${u.key}`,unitKey:u.key,studentId:'s1',surahNumber:u.surahNumber,pageNumber:u.pageNumber,source:'initial',memorizedOn:'2026-09-10',recordedAt:'2026-09-10T00:00:00Z'}));
snap = snapshot(map, student, progressNahl);
assert.equal(snap.next.surahNumber, 15);
assert.equal(snap.next.pageNumber, 262);

const partial = initialProgress(map, student, 'within_surah', 16, 270, '2026-09-10');
snap = snapshot(map, student, partial);
assert.equal(snap.next.surahNumber, 16);
assert.equal(snap.next.pageNumber, 271);

const entry = createDailyEntry('s1', snap.next, '2026-09-10');
assert.equal(entry.pageNumber, 271);
assert.equal(entry.source, 'daily');

// الصفحة المشتركة لا تعتبر مكتملة إلا باكتمال وحدات كل السور الموجودة عليها.
const s2 = {id:'s2',direction:'start_to_end'};
const upToNisaEnd = initialProgress(map,s2,'completed_surah',4,null,'2026-09-10');
const snap2 = snapshot(map,s2,upToNisaEnd);
const report2 = progressReport(map,snap2,upToNisaEnd);
assert.equal(report2.physicalPagesCompleted, 105, "shared page 106 should not count until all surah units are done");

assert.equal(unitKey(16,267),'16:267');
console.log('9 domain checks passed');

// اختبارات خطة الحفظ اليومية.
const { createMemorizationPlan, planSnapshot, planStatusLabel, validateDailyPages } = await import('../assets/js/domain/plan.js');
assert.equal(validateDailyPages(2), 2);
assert.throws(() => validateDailyPages(0), /رقمًا صحيحًا/);
assert.throws(() => validateDailyPages(2.5), /رقمًا صحيحًا/);

const plan = createMemorizationPlan(3, 100, '2026-09-10', 604);
let planData = planSnapshot(plan, 100, 604, '2026-09-10');
assert.equal(planData.status, 'on_track');
assert.equal(planData.pagesToReachToday, 3);
assert.equal(planData.totalPlanDays, 168);
assert.equal(planData.plannedFinishDate, '2027-02-24');
assert.equal(planData.projectedFinishDate, '2027-02-24');

// في اليوم التالي: كان يجب إكمال 3 صفحات قبل بدء اليوم.
planData = planSnapshot(plan, 102, 604, '2026-09-11');
assert.equal(planData.status, 'behind');
assert.equal(planData.statusPages, 1);
assert.equal(planStatusLabel(planData).label, 'متأخر عن الخطة');

// بين مستهدف بداية اليوم ونهايته = على الخطة.
planData = planSnapshot(plan, 104, 604, '2026-09-11');
assert.equal(planData.status, 'on_track');
assert.equal(planData.pagesToReachToday, 2);

// أكثر من مستهدف نهاية اليوم = متقدم.
planData = planSnapshot(plan, 107, 604, '2026-09-11');
assert.equal(planData.status, 'ahead');
assert.equal(planData.statusPages, 1);
assert.equal(planStatusLabel(planData).label, 'متقدم على الخطة');

// تعديل الخطة يبدأ من الرصيد الحالي ويعيد الحساب بشكل مستقل عن الخطة القديمة.
const revisedPlan = createMemorizationPlan(2, 150, '2026-09-20', 604);
planData = planSnapshot(revisedPlan, 150, 604, '2026-09-20');
assert.equal(planData.status, 'on_track');
assert.equal(planData.pagesToReachToday, 2);
assert.equal(planData.basePhysicalPagesCompleted, 150);

console.log('plan checks passed');

// لو تم التراجع بعد بدء الخطة، لا يصبح خط الأساس أكبر من الحفظ الحالي.
planData = planSnapshot(createMemorizationPlan(2, 150, '2026-09-20', 604), 149, 604, '2026-09-20');
assert.equal(planData.basePhysicalPagesCompleted, 149);
assert.equal(planData.status, 'on_track');
