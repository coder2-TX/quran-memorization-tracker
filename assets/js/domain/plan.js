const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function validateDailyPages(value, totalPages = 604) {
  const pages = Number(value);
  if (!Number.isInteger(pages) || pages < 1 || pages > totalPages) {
    throw new Error(`هدف الحفظ اليومي يجب أن يكون رقمًا صحيحًا من 1 إلى ${totalPages}.`);
  }
  return pages;
}

export function createMemorizationPlan(dailyPages, basePhysicalPagesCompleted, startedOn, totalPages = 604) {
  const target = validateDailyPages(dailyPages, totalPages);
  const base = clampInteger(basePhysicalPagesCompleted, 0, totalPages);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(startedOn || ''))) {
    throw new Error('تاريخ بداية الخطة غير صحيح.');
  }
  return {
    dailyPages: target,
    startedOn,
    basePhysicalPagesCompleted: base,
    updatedAt: new Date().toISOString(),
  };
}

export function planSnapshot(plan, currentPhysicalPagesCompleted, totalPages, todayISO) {
  if (!plan) return null;

  const target = validateDailyPages(plan.dailyPages, totalPages);
  const current = clampInteger(currentPhysicalPagesCompleted, 0, totalPages);
  // قد يتراجع المستخدم عن آخر تسجيل بعد تعديل الخطة؛ لا نسمح لخط الأساس أن يتجاوز الرصيد الحالي.
  const base = Math.min(clampInteger(plan.basePhysicalPagesCompleted, 0, totalPages), current);
  const start = String(plan.startedOn || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(String(todayISO || ''))) {
    return null;
  }

  const totalPlannedPages = Math.max(0, totalPages - base);
  const gained = Math.max(0, current - base);
  const remaining = Math.max(0, totalPages - current);
  const elapsedBeforeToday = Math.max(0, diffDays(start, todayISO));
  const expectedBeforeToday = Math.min(totalPlannedPages, target * elapsedBeforeToday);
  const expectedByEndToday = Math.min(totalPlannedPages, target * (elapsedBeforeToday + 1));

  let status = 'on_track';
  let statusPages = 0;
  if (current >= totalPages) {
    status = 'completed';
  } else if (gained < expectedBeforeToday) {
    status = 'behind';
    statusPages = expectedBeforeToday - gained;
  } else if (gained > expectedByEndToday) {
    status = 'ahead';
    statusPages = gained - expectedByEndToday;
  }

  const totalPlanDays = totalPlannedPages === 0 ? 0 : Math.ceil(totalPlannedPages / target);
  const plannedFinishDate = totalPlanDays === 0 ? start : addDays(start, totalPlanDays - 1);
  const daysFromCurrent = remaining === 0 ? 0 : Math.ceil(remaining / target);
  const projectedFinishDate = remaining === 0 ? todayISO : addDays(todayISO, daysFromCurrent - 1);
  const pagesToReachToday = Math.max(0, expectedByEndToday - gained);

  return {
    dailyPages: target,
    startedOn: start,
    basePhysicalPagesCompleted: base,
    currentPhysicalPagesCompleted: current,
    gainedSincePlan: gained,
    remainingPages: remaining,
    elapsedBeforeToday,
    expectedBeforeToday,
    expectedByEndToday,
    pagesToReachToday,
    status,
    statusPages,
    totalPlanDays,
    plannedFinishDate,
    daysFromCurrent,
    projectedFinishDate,
  };
}

export function planStatusLabel(planData) {
  if (!planData) return { label: 'بدون خطة', tone: 'neutral', detail: 'لم يتم تحديد هدف يومي بعد.' };
  if (planData.status === 'completed') return { label: 'مكتمل', tone: 'success', detail: 'تم إكمال المصحف.' };
  if (planData.status === 'behind') return { label: 'متأخر عن الخطة', tone: 'danger', detail: `متأخر ${planData.statusPages} صفحة عن الحد المطلوب حتى بداية اليوم.` };
  if (planData.status === 'ahead') return { label: 'متقدم على الخطة', tone: 'success', detail: `متقدم ${planData.statusPages} صفحة عن المطلوب حتى نهاية اليوم.` };
  return { label: 'على الخطة', tone: 'primary', detail: planData.pagesToReachToday > 0 ? `يحتاج ${planData.pagesToReachToday} صفحة للوصول إلى مستهدف نهاية اليوم.` : 'أكمل المستهدف المطلوب حتى نهاية اليوم.' };
}

function diffDays(fromISO, toISO) {
  return Math.floor((isoToUtc(toISO) - isoToUtc(fromISO)) / MS_PER_DAY);
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

function clampInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}
