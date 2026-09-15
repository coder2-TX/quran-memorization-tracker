const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function validateDailyPages(value, totalPages = 604) {
  const pages = Number(value);
  if (!Number.isInteger(pages) || pages < 1 || pages > totalPages) {
    throw new Error(`هدف الحفظ اليومي يجب أن يكون رقمًا صحيحًا من 1 إلى ${totalPages}.`);
  }
  return pages;
}

export function validateWeeklyDays(value) {
  const days = Number(value);
  if (!Number.isInteger(days) || days < 1 || days > 7) {
    throw new Error('عدد أيام الحفظ في الأسبوع يجب أن يكون رقمًا صحيحًا من 1 إلى 7.');
  }
  return days;
}

export function createMemorizationPlan(
  dailyPages,
  basePhysicalPagesCompleted,
  startedOn,
  totalPages = 604,
  weeklyDays = 7,
) {
  const target = validateDailyPages(dailyPages, totalPages);
  const daysPerWeek = validateWeeklyDays(weeklyDays);
  const base = clampInteger(basePhysicalPagesCompleted, 0, totalPages);

  if (!validISO(startedOn)) throw new Error('تاريخ بداية الخطة غير صحيح.');

  return {
    dailyPages: target,
    weeklyDays: daysPerWeek,
    startedOn,
    basePhysicalPagesCompleted: base,
    pausedOn: null,
    pausedDays: 0,
    updatedAt: new Date().toISOString(),
  };
}

export function pauseMemorizationPlan(plan, pausedOn) {
  if (!plan) throw new Error('لا توجد خطة لإيقافها.');
  if (!validISO(pausedOn)) throw new Error('تاريخ إيقاف الخطة غير صحيح.');
  if (plan.pausedOn) return { ...plan };
  if (diffDays(String(plan.startedOn || ''), pausedOn) < 0) {
    throw new Error('لا يمكن إيقاف الخطة قبل تاريخ بدايتها.');
  }
  return {
    ...plan,
    pausedOn,
    pausedDays: clampInteger(plan.pausedDays ?? 0, 0, 100000),
    updatedAt: new Date().toISOString(),
  };
}

export function resumeMemorizationPlan(plan, resumedOn) {
  if (!plan) throw new Error('لا توجد خطة لاستئنافها.');
  if (!plan.pausedOn) return { ...plan };
  if (!validISO(resumedOn)) throw new Error('تاريخ استئناف الخطة غير صحيح.');
  const currentPauseDays = diffDays(String(plan.pausedOn), resumedOn);
  if (currentPauseDays < 0) throw new Error('تاريخ الاستئناف يجب ألا يسبق تاريخ الإيقاف.');
  return {
    ...plan,
    pausedOn: null,
    pausedDays: clampInteger(plan.pausedDays ?? 0, 0, 100000) + currentPauseDays,
    updatedAt: new Date().toISOString(),
  };
}

export function planSnapshot(plan, currentPhysicalPagesCompleted, totalPages, todayISO) {
  if (!plan) return null;

  const target = validateDailyPages(plan.dailyPages, totalPages);
  const weeklyDays = validateWeeklyDays(plan.weeklyDays ?? 7);
  const current = clampInteger(currentPhysicalPagesCompleted, 0, totalPages);
  const base = Math.min(clampInteger(plan.basePhysicalPagesCompleted, 0, totalPages), current);
  const start = String(plan.startedOn || '');
  const pausedOn = validISO(plan.pausedOn) ? String(plan.pausedOn) : null;
  const pastPausedDays = clampInteger(plan.pausedDays ?? 0, 0, 100000);

  if (!validISO(start) || !validISO(todayISO)) return null;

  const totalPlannedPages = Math.max(0, totalPages - base);
  const gained = Math.max(0, current - base);
  const remaining = Math.max(0, totalPages - current);
  const freezeDate = pausedOn && pausedOn <= todayISO ? pausedOn : todayISO;
  const elapsedCalendarBeforeToday = Math.max(0, diffDays(start, freezeDate));
  const elapsedBeforeToday = Math.max(0, elapsedCalendarBeforeToday - pastPausedDays);

  // المستخدم يحدد عدد أيام الأسبوع فقط، وليس أسماء الأيام.
  // لذلك نوزع جلسات الحفظ تقديريًا على الأسبوع مع اعتبار يوم البداية أول يوم متاح.
  const sessionsBeforeToday = sessionsByCalendarDays(elapsedBeforeToday, weeklyDays);
  const sessionsByEndToday = pausedOn
    ? sessionsBeforeToday
    : sessionsByCalendarDays(elapsedBeforeToday + 1, weeklyDays);
  const expectedBeforeToday = Math.min(totalPlannedPages, target * sessionsBeforeToday);
  const expectedByEndToday = Math.min(totalPlannedPages, target * sessionsByEndToday);

  let status = pausedOn ? 'paused' : 'on_track';
  let statusPages = 0;

  if (current >= totalPages) {
    status = 'completed';
  } else if (!pausedOn && gained < expectedBeforeToday) {
    status = 'behind';
    statusPages = expectedBeforeToday - gained;
  } else if (!pausedOn && gained > expectedByEndToday) {
    status = 'ahead';
    statusPages = gained - expectedByEndToday;
  }

  const totalPlanSessions = totalPlannedPages === 0 ? 0 : Math.ceil(totalPlannedPages / target);
  const totalCalendarDays = calendarDaysForSessions(totalPlanSessions, weeklyDays);
  const plannedFinishDate = totalCalendarDays === 0
    ? start
    : addDays(start, totalCalendarDays - 1 + pastPausedDays);

  const sessionsFromCurrent = remaining === 0 ? 0 : Math.ceil(remaining / target);
  const daysFromCurrent = pausedOn ? null : calendarDaysForSessions(sessionsFromCurrent, weeklyDays);
  const projectedFinishDate = remaining === 0
    ? todayISO
    : pausedOn ? null : addDays(todayISO, Math.max(0, daysFromCurrent - 1));
  const pagesToReachToday = pausedOn ? 0 : Math.max(0, expectedByEndToday - gained);

  return {
    dailyPages: target,
    weeklyDays,
    startedOn: start,
    basePhysicalPagesCompleted: base,
    currentPhysicalPagesCompleted: current,
    gainedSincePlan: gained,
    remainingPages: remaining,
    elapsedBeforeToday,
    sessionsBeforeToday,
    sessionsByEndToday,
    expectedBeforeToday,
    expectedByEndToday,
    pagesToReachToday,
    status,
    statusPages,
    paused: Boolean(pausedOn),
    pausedOn,
    pausedDays: pastPausedDays,
    totalPlanSessions,
    totalCalendarDays,
    plannedFinishDate,
    sessionsFromCurrent,
    daysFromCurrent,
    projectedFinishDate,
  };
}

export function planStatusLabel(planData) {
  if (!planData) return { label: 'بدون خطة', tone: 'neutral', detail: 'لم يتم تحديد هدف يومي بعد.' };
  if (planData.status === 'completed') return { label: 'مكتمل', tone: 'success', detail: 'تم إكمال المصحف.' };
  if (planData.status === 'paused') return { label: 'الخطة متوقفة', tone: 'neutral', detail: 'لن يحسب النظام تأخرًا جديدًا حتى يتم استئناف الخطة.' };
  if (planData.status === 'behind') return { label: 'متأخر عن الخطة', tone: 'danger', detail: `متأخر ${planData.statusPages} صفحة عن الحد التقديري المطلوب حتى بداية اليوم.` };
  if (planData.status === 'ahead') return { label: 'متقدم على الخطة', tone: 'success', detail: `متقدم ${planData.statusPages} صفحة عن المستهدف التقديري حتى نهاية اليوم.` };
  return {
    label: 'على الخطة',
    tone: 'primary',
    detail: planData.pagesToReachToday > 0
      ? `يحتاج ${planData.pagesToReachToday} صفحة للوصول إلى مستهدف اليوم التقديري.`
      : 'أكمل المستهدف المطلوب وفق وتيرة الخطة.',
  };
}

function sessionsByCalendarDays(calendarDays, weeklyDays) {
  if (calendarDays <= 0) return 0;
  return Math.ceil(calendarDays * weeklyDays / 7);
}

function calendarDaysForSessions(sessions, weeklyDays) {
  if (sessions <= 0) return 0;
  return Math.floor((sessions - 1) * 7 / weeklyDays) + 1;
}

function diffDays(fromISO, toISO) {
  if (!validISO(fromISO) || !validISO(toISO)) return 0;
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

function validISO(value) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
}

function clampInteger(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(max, Math.max(min, Math.trunc(number)));
}
