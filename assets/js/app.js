import { APP_CONFIG } from './config.js';
import { getStudents, getStudent, saveStudent, deleteStudent, getProgress, putProgress, deleteProgress, getReviewSessions, saveReviewSession, resetReviewState, exportDatabase, replaceDatabase } from './core/db.js';
import { loadQuranMap, orderedSurahs, surah, unitKey } from './domain/quran.js';
import { snapshot, initialProgress, createDailyEntry, progressReport, historyRows, dashboardReport, todayISO } from './domain/memorization.js';
import { createMemorizationPlan, pauseMemorizationPlan, resumeMemorizationPlan, planSnapshot, planStatusLabel } from './domain/plan.js';
import { REVIEW_MODES, createReviewPlan, reviewModeLabel, createManualReviewSurahRange, createManualReviewPageRange, createReviewSession, reviewInsights, reviewHistoryRows, memorizedPhysicalPages, memorizedSurahs } from './domain/review.js';
import { studentActivitySummary, weeklyActivitySummary } from './domain/activity.js';
import { escapeHtml, formatDate, toast, setBusy } from './ui/helpers.js';

const root = document.querySelector('#app');
let quranMap;
let deferredInstallPrompt = null;

boot().catch(error => renderFatal(error));

async function boot() {
  applyConfig();
  quranMap = await loadQuranMap(APP_CONFIG.quran.mapUrl);
  await registerServiceWorker();
  requestPersistentStorage();
  bindGlobalEvents();
  await renderRoute();
}

function applyConfig() {
  document.title = APP_CONFIG.name;
  document.documentElement.style.setProperty('--primary', APP_CONFIG.theme.primary);
  document.documentElement.style.setProperty('--secondary', APP_CONFIG.theme.secondary);
  document.documentElement.style.setProperty('--text', APP_CONFIG.theme.text);
  document.documentElement.style.setProperty('--background', APP_CONFIG.theme.background);
  document.documentElement.style.setProperty('--surface', APP_CONFIG.theme.surface);
  document.documentElement.style.setProperty('--muted', APP_CONFIG.theme.muted);
  document.documentElement.style.setProperty('--border', APP_CONFIG.theme.border);
  document.documentElement.style.setProperty('--success', APP_CONFIG.theme.success);
  document.documentElement.style.setProperty('--danger', APP_CONFIG.theme.danger);
  document.documentElement.style.setProperty('--app-font', `'${APP_CONFIG.font.family}', ${APP_CONFIG.font.fallback}`);
  document.querySelectorAll('[data-app-name]').forEach(el => { el.textContent = APP_CONFIG.name; });
  document.querySelectorAll('[data-app-logo]').forEach(el => { el.src = APP_CONFIG.logo; });
  const version = document.querySelector('[data-app-version]');
  if (version) version.textContent = `v${APP_CONFIG.version}`;
}

function bindGlobalEvents() {
  window.addEventListener('hashchange', () => renderRoute());
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredInstallPrompt = event;
    document.body.classList.add('install-available');
  });
  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    document.body.classList.remove('install-available');
    toast('تم تثبيت التطبيق على الهاتف.');
  });

  document.addEventListener('click', async event => {
    const install = event.target.closest('[data-install-app]');
    if (install) {
      if (deferredInstallPrompt) {
        deferredInstallPrompt.prompt();
        await deferredInstallPrompt.userChoice;
        deferredInstallPrompt = null;
      } else {
        showInstallHelp();
      }
    }
    const backup = event.target.closest('[data-backup]');
    if (backup) await downloadBackup();
  });

  document.querySelector('#restore-input')?.addEventListener('change', restoreBackup);
}

async function renderRoute() {
  window.scrollTo({ top: 0, behavior: 'instant' });
  const hash = location.hash || '#/';
  const reviewMatch = hash.match(/^#\/students\/([^/]+)\/review$/);
  const match = hash.match(/^#\/students\/([^/]+)$/);
  if (hash === '#/students/new') return renderCreateStudent();
  if (reviewMatch) return renderReview(reviewMatch[1]);
  if (match) return renderStudent(match[1]);
  return renderDashboard();
}

async function renderDashboard() {
  showLoading();
  const students = (await getStudents()).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const items = [];
  for (const student of students) {
    const progress = await getProgress(student.id);
    const reviews = await getReviewSessions(student.id);
    const snap = snapshot(quranMap, student, progress);
    const report = progressReport(quranMap, snap, progress);
    const plan = planSnapshot(student.plan, report.physicalPagesCompleted, report.physicalPagesTotal, todayISO());
    const activity = studentActivitySummary(progress, reviews);
    items.push({ student, progress, reviews, snapshot: snap, report, plan, activity });
  }
  const dashboard = dashboardReport(items);

  root.innerHTML = `
    <section class="page-heading">
      <div>
        <span class="eyebrow">لوحة المتابعة</span>
        <h1>الطلاب والحفظ اليومي</h1>
        <p>متابعة بسيطة ودقيقة لتقدم كل طالب في المصحف.</p>
      </div>
      <a class="button button-primary" href="#/students/new"><i class="fa-solid fa-user-plus"></i> إضافة طالب</a>
    </section>

    <section class="stats-grid dashboard-stats">
      ${statCard('fa-users', dashboard.studentsCount, 'إجمالي الطلاب')}
      ${statCard('fa-calendar-check', dashboard.activeToday, 'طلاب حفظوا اليوم')}
      ${statCard('fa-book-open', dashboard.todayTotal, 'وحدات حفظ اليوم')}
      ${statCard('fa-chart-line', `${dashboard.averageProgress}%`, 'متوسط تقدم الطلاب')}
    </section>

    <section class="panel toolbar-panel">
      <div class="search-box"><i class="fa-solid fa-magnifying-glass"></i><input id="student-search" type="search" placeholder="ابحث عن طالب..." autocomplete="off"></div>
      <div class="toolbar-actions">
        <button class="button button-ghost" data-install-app><i class="fa-solid fa-mobile-screen-button"></i> تثبيت على الهاتف</button>
        <button class="button button-ghost" data-backup><i class="fa-solid fa-download"></i> نسخة احتياطية</button>
        <label class="button button-ghost" for="restore-input"><i class="fa-solid fa-upload"></i> استعادة</label>
      </div>
    </section>

    <section class="student-grid" id="student-grid">
      ${items.length ? items.map(studentCard).join('') : emptyStudents()}
    </section>
  `;

  const search = root.querySelector('#student-search');
  search?.addEventListener('input', () => {
    const term = search.value.trim().toLocaleLowerCase('ar');
    root.querySelectorAll('[data-student-card]').forEach(card => {
      card.hidden = !card.dataset.studentName.includes(term);
    });
  });
}

function studentCard(item) {
  const { student, snapshot: snap, report, plan, activity } = item;
  const nextText = snap.completed ? 'تم إكمال المصحف' : `${snap.next.surahName} · صفحة ${snap.next.pageNumber}`;
  const planState = planStatusLabel(plan);
  return `
    <article class="student-card" data-student-card data-student-name="${escapeHtml(student.name.toLocaleLowerCase('ar'))}">
      <div class="student-card-top">
        <div class="avatar"><i class="fa-solid fa-user"></i></div>
        <div class="student-card-title"><h2>${escapeHtml(student.name)}</h2><span class="direction-badge"><i class="fa-solid fa-arrow-${student.direction === 'end_to_start' ? 'left' : 'right'}"></i> ${student.direction === 'end_to_start' ? 'من نهاية المصحف' : 'من بداية المصحف'}</span></div>
      </div>
      <div class="next-box"><span>التالي</span><strong>${escapeHtml(nextText)}</strong></div>
      <div class="progress-row"><span>التقدم في المصحف</span><strong>${report.physicalProgressPercent}%</strong></div>
      <div class="progress-track"><span style="width:${report.physicalProgressPercent}%"></span></div>
      <div class="mini-metrics"><span><b>${report.physicalPagesCompleted}</b> محفوظ</span><span><b>${report.physicalPagesRemaining}</b> متبقي</span><span><b>${snap.todayCount}</b> اليوم</span></div>
      ${todayActivityStrip(activity)}
      <div class="last-activity-row"><span><i class="fa-solid fa-book-open-reader"></i> آخر حفظ: <strong>${escapeHtml(activity.lastMemorizationLabel)}</strong></span><span><i class="fa-solid fa-arrows-rotate"></i> آخر مراجعة: <strong>${escapeHtml(activity.lastReviewLabel)}</strong></span></div>
      <div class="plan-card-strip ${planState.tone}"><span><i class="fa-solid ${planStatusIcon(plan?.status)}"></i> ${escapeHtml(planState.label)}</span><strong>${plan ? `${plan.dailyPages} صفحة × ${plan.weeklyDays} أيام/أسبوع` : 'حدد هدفًا أسبوعيًا'}</strong></div>
      <a class="button button-secondary button-block" href="#/students/${encodeURIComponent(student.id)}"><i class="fa-solid fa-book-open-reader"></i> متابعة الطالب</a>
    </article>`;
}

async function renderCreateStudent() {
  const surahs = orderedSurahs(quranMap);
  root.innerHTML = `
    <section class="page-heading compact">
      <div><a class="back-link" href="#/"><i class="fa-solid fa-arrow-right"></i> الطلاب</a><h1>إضافة طالب</h1><p>حدد نقطة البداية الحالية، والنظام سيبني التسلسل تلقائيًا.</p></div>
    </section>
    <form class="panel form-panel" id="student-form">
      <div class="field"><label for="name">اسم الطالب</label><input id="name" name="name" required maxlength="80" placeholder="مثال: أحمد محمد"></div>
      <fieldset class="field"><legend>اتجاه الحفظ</legend><div class="choice-grid">
        <label class="choice-card"><input type="radio" name="direction" value="start_to_end" checked><span class="choice-icon"><i class="fa-solid fa-arrow-left-long"></i></span><span class="choice-copy"><strong>من بداية المصحف</strong><small>الفاتحة ثم البقرة ثم ما بعدها</small></span><span class="choice-selected" aria-hidden="true"><i class="fa-solid fa-circle-check"></i></span></label>
        <label class="choice-card"><input type="radio" name="direction" value="end_to_start"><span class="choice-icon"><i class="fa-solid fa-arrow-right-long"></i></span><span class="choice-copy"><strong>من نهاية المصحف</strong><small>الناس ثم الفلق ثم ما قبلها</small></span><span class="choice-selected" aria-hidden="true"><i class="fa-solid fa-circle-check"></i></span></label>
      </div></fieldset>
      <div class="field"><label for="initial-mode">الحفظ الموجود قبل استخدام النظام</label><select id="initial-mode" name="initialMode"><option value="none">يبدأ المتابعة من البداية</option><option value="completed_surah">آخر سورة أكملها</option><option value="within_surah">وصل إلى صفحة داخل سورة</option></select></div>
      <div id="initial-fields" class="initial-fields" hidden>
        <div class="field"><label for="surah-number">السورة</label><select id="surah-number" name="surahNumber"><option value="">اختر السورة</option>${surahs.map(s => `<option value="${s.number}">${s.number}. ${escapeHtml(s.name)}</option>`).join('')}</select></div>
        <div class="field" id="page-field" hidden><label for="page-number">آخر صفحة محفوظة داخل السورة</label><select id="page-number" name="pageNumber"></select></div>
      </div>
      <div class="plan-target-field">
        <div class="plan-target-grid">
          <div class="field"><label for="daily-pages">صفحات الحفظ في يوم الحفظ</label><div class="number-input-wrap"><input id="daily-pages" name="dailyPages" type="number" inputmode="numeric" min="1" max="604" step="1" value="2" required><span>صفحة</span></div></div>
          <div class="field"><label for="weekly-days">أيام الحفظ في الأسبوع</label><div class="number-input-wrap"><input id="weekly-days" name="weeklyDays" type="number" inputmode="numeric" min="1" max="7" step="1" value="7" required><span>يوم</span></div></div>
        </div>
        <small class="field-help"><i class="fa-solid fa-circle-info"></i> مثال: صفحتان في 5 أيام أسبوعيًا. يحسب النظام موعد الختم وحالة التقدم على هذه الوتيرة بشكل تقديري.</small>
      </div>
      <div class="form-actions"><a class="button button-ghost" href="#/">إلغاء</a><button class="button button-primary" type="submit"><i class="fa-solid fa-floppy-disk"></i> حفظ الطالب</button></div>
    </form>`;

  const form = root.querySelector('#student-form');
  const mode = root.querySelector('#initial-mode');
  const initialFields = root.querySelector('#initial-fields');
  const surahSelect = root.querySelector('#surah-number');
  const pageField = root.querySelector('#page-field');
  const pageSelect = root.querySelector('#page-number');

  const refreshInitial = () => {
    initialFields.hidden = mode.value === 'none';
    pageField.hidden = mode.value !== 'within_surah';
  };
  mode.addEventListener('change', refreshInitial);
  surahSelect.addEventListener('change', () => {
    const item = surah(quranMap, Number(surahSelect.value));
    pageSelect.innerHTML = item ? item.pages.map(p => `<option value="${p}">صفحة ${p}</option>`).join('') : '';
  });
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    setBusy(submit, true);
    try {
      const data = new FormData(form);
      const name = String(data.get('name') || '').trim();
      if (!name) throw new Error('اكتب اسم الطالب.');
      const student = {
        id: crypto.randomUUID(),
        name,
        direction: String(data.get('direction')),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      const entries = initialProgress(quranMap, student, String(data.get('initialMode')), Number(data.get('surahNumber')) || null, Number(data.get('pageNumber')) || null);
      const initialSnap = snapshot(quranMap, student, entries);
      const initialReport = progressReport(quranMap, initialSnap, entries);
      student.plan = createMemorizationPlan(Number(data.get('dailyPages')), initialReport.physicalPagesCompleted, todayISO(), initialReport.physicalPagesTotal, Number(data.get('weeklyDays')));
      await saveStudent(student);
      await putProgress(entries);
      toast('تمت إضافة الطالب بنجاح.');
      location.hash = `#/students/${student.id}`;
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(submit, false);
    }
  });
}

async function renderStudent(id) {
  showLoading();
  const student = await getStudent(id);
  if (!student) return renderNotFound();
  const progress = await getProgress(id);
  const reviews = await getReviewSessions(id);
  const snap = snapshot(quranMap, student, progress);
  const report = progressReport(quranMap, snap, progress);
  const plan = planSnapshot(student.plan, report.physicalPagesCompleted, report.physicalPagesTotal, todayISO());
  const history = historyRows(quranMap, progress);
  const weekly = weeklyActivitySummary(progress, reviews);
  const current = snap.currentSurah;
  const currentProgress = report.currentSurah;

  root.innerHTML = `
    <section class="student-heading">
      <div><a class="back-link" href="#/"><i class="fa-solid fa-arrow-right"></i> الطلاب</a><div class="student-name-line"><div class="avatar large"><i class="fa-solid fa-user"></i></div><div><h1>${escapeHtml(student.name)}</h1><p>${student.direction === 'end_to_start' ? 'الحفظ من نهاية المصحف إلى بدايته' : 'الحفظ من بداية المصحف إلى نهايته'}</p></div></div></div>
      <div class="student-menu"><button class="icon-button" id="edit-name" title="تعديل الاسم"><i class="fa-solid fa-pen"></i></button><button class="icon-button danger" id="delete-student" title="حذف الطالب"><i class="fa-solid fa-trash"></i></button></div>
    </section>

    ${studentTabs(student.id, 'memorization')}
    ${weeklyActivityPanel(weekly)}

    <section class="hero-progress panel">
      <div class="hero-progress-main"><span class="eyebrow">تقدم المصحف</span><strong class="big-percent">${report.physicalProgressPercent}%</strong><div class="progress-track large"><span style="width:${report.physicalProgressPercent}%"></span></div><p>${report.physicalPagesCompleted} صفحة مكتملة من أصل ${report.physicalPagesTotal}</p></div>
      <div class="hero-progress-numbers"><div><span>المحفوظ</span><strong>${report.physicalPagesCompleted}</strong><small>صفحة</small></div><div><span>المتبقي</span><strong>${report.physicalPagesRemaining}</strong><small>صفحة</small></div><div><span>السور المكتملة</span><strong>${report.completedSurahs}</strong><small>من 114</small></div></div>
    </section>

    ${planPanel(student, plan, report)}

    ${snap.completed ? completedPanel() : trackingPanel(student, snap, report)}

    <section class="stats-grid detail-stats">
      ${statCard('fa-layer-group', report.initialUnits, 'وحدات الحفظ السابقة')}
      ${statCard('fa-calendar-days', report.dailyUnits, 'وحدات سجلها النظام')}
      ${statCard('fa-fire', report.activeDays, 'أيام المتابعة')}
      ${statCard('fa-chart-simple', report.lastSevenAverage, 'متوسط آخر 7 أيام')}
    </section>

    ${current && currentProgress ? `<section class="panel current-surah-panel"><div class="section-title"><div><span class="eyebrow">السورة الحالية</span><h2>سورة ${escapeHtml(current.name)}</h2></div><strong>${currentProgress.completed}/${currentProgress.total}</strong></div><div class="progress-track"><span style="width:${currentProgress.percent}%"></span></div><div class="surah-pages">${current.pages.map(page => pageChip(student, snap, progress, current.number, page)).join('')}</div></section>` : ''}

    <section class="panel weekly-panel"><div class="section-title"><div><span class="eyebrow">الحركة الأخيرة</span><h2>آخر 7 أيام للحفظ</h2></div><span>${report.lastSevenTotal} وحدة</span></div><div class="week-chart">${report.lastSevenDays.map(day => weekBar(day, report.lastSevenDays)).join('')}</div></section>

    ${memorizationHistoryPanel(history)}
  `;

  root.querySelector('#mark-next')?.addEventListener('click', () => markNext(student));
  root.querySelector('#undo-last')?.addEventListener('click', () => undoLast(student, progress, snap));
  root.querySelector('#edit-name')?.addEventListener('click', () => editStudentName(student));
  root.querySelector('#edit-plan')?.addEventListener('click', () => editStudentPlan(student, report));
  root.querySelector('#toggle-plan-pause')?.addEventListener('click', () => toggleStudentPlanPause(student));
  root.querySelector('#delete-student')?.addEventListener('click', () => removeStudent(student));
}

function studentTabs(studentId, active) {
  const encoded = encodeURIComponent(studentId);
  return `<nav class="student-tabs" aria-label="أقسام الطالب">
    <a class="${active === 'memorization' ? 'active' : ''}" href="#/students/${encoded}"><i class="fa-solid fa-book-open-reader"></i><span>الحفظ</span></a>
    <a class="${active === 'review' ? 'active' : ''}" href="#/students/${encoded}/review"><i class="fa-solid fa-arrows-rotate"></i><span>المراجعة</span></a>
  </nav>`;
}

async function renderReview(id) {
  showLoading();
  const student = await getStudent(id);
  if (!student) return renderNotFound();

  const progress = await getProgress(id);
  const reviews = await getReviewSessions(id);
  const insights = reviewInsights(quranMap, student, progress, reviews);
  const history = reviewHistoryRows(quranMap, reviews);
  const weekly = weeklyActivitySummary(progress, reviews);

  root.innerHTML = `
    <section class="student-heading">
      <div>
        <a class="back-link" href="#/"><i class="fa-solid fa-arrow-right"></i> الطلاب</a>
        <div class="student-name-line">
          <div class="avatar large"><i class="fa-solid fa-user"></i></div>
          <div><h1>${escapeHtml(student.name)}</h1><p>${student.reviewPlan ? escapeHtml(reviewModeLabel(student.reviewPlan.mode)) : 'لم يتم إعداد المراجعة بعد'}</p></div>
        </div>
      </div>
      <div class="student-menu"><button class="icon-button" data-edit-review-plan title="${student.reviewPlan ? 'تعديل إعداد المراجعة' : 'إعداد المراجعة'}"><i class="fa-solid fa-sliders"></i></button></div>
    </section>

    ${studentTabs(student.id, 'review')}
    ${weeklyActivityPanel(weekly)}
    ${reviewSummaryPanel(student, insights)}
    ${student.reviewPlan ? manualReviewWorkspace(student, progress, insights) : reviewSetupPrompt()}
    ${staleReviewPanel(insights)}
    ${reviewHistoryPanel(history)}
  `;

  root.querySelectorAll('[data-edit-review-plan]').forEach(button => button.addEventListener('click', () => editReviewPlan(student)));
  root.querySelector('#setup-review-plan')?.addEventListener('click', () => editReviewPlan(student));
  bindManualReviewForm(student, progress);
}

function reviewSummaryPanel(student, insights) {
  const plan = student.reviewPlan;
  const target = plan?.mode !== REVIEW_MODES.free && plan?.dailyPages ? `${plan.dailyPages} صفحة` : 'بدون هدف';
  const todayValue = plan?.mode !== REVIEW_MODES.free && insights.remainingToday !== null
    ? `${insights.reviewedToday} / ${plan.dailyPages}`
    : insights.reviewedToday;

  return `<section class="stats-grid review-stats">
    ${statCard('fa-book', insights.memorizedUnits, 'وحدات محفوظة')}
    ${statCard('fa-calendar-check', todayValue, 'مراجعة اليوم')}
    ${statCard('fa-clock-rotate-left', insights.neverReviewed, 'لم تسجل مراجعتها')}
    ${statCard('fa-bullseye', target, 'هدف المراجعة')}
  </section>`;
}

function reviewSetupPrompt() {
  return `<section class="panel review-empty-plan">
    <div class="review-empty-icon"><i class="fa-solid fa-arrows-rotate"></i></div>
    <div><span class="eyebrow">المراجعة</span><h2>حدد أسلوب متابعة المراجعة</h2><p>النظام لا يختار للطالب ماذا يراجع. الطالب يسجل بنفسه السورة ونطاق الصفحات التي راجعها، والنظام يتولى الحفظ والتقارير فقط.</p></div>
    <button class="button button-primary" id="setup-review-plan"><i class="fa-solid fa-sliders"></i> إعداد المراجعة</button>
  </section>`;
}

function manualReviewWorkspace(student, progress, insights) {
  const plan = student.reviewPlan;
  const availableSurahs = memorizedSurahs(quranMap, progress);
  const planDescription = reviewPlanDescription(plan);
  const targetHtml = plan.mode !== REVIEW_MODES.free
    ? `<div class="review-target-progress"><div><span>هدف اليوم</span><strong>${insights.reviewedToday} / ${plan.dailyPages} صفحة</strong></div><div class="progress-track"><span style="width:${Math.min(100, Math.round(insights.reviewedToday / plan.dailyPages * 100))}%"></span></div><small>${insights.remainingToday > 0 ? `متبقي ${insights.remainingToday} صفحة للوصول للهدف اليومي.` : 'تم بلوغ هدف المراجعة لليوم.'}</small></div>`
    : '';

  return `<section class="panel review-workspace">
    <div class="review-workspace-head">
      <div><span class="eyebrow">تسجيل المراجعة</span><h2>${escapeHtml(reviewModeLabel(plan.mode))}</h2><p>${escapeHtml(planDescription)}</p></div>
      <button class="button button-ghost" data-edit-review-plan><i class="fa-solid fa-pen-to-square"></i> تعديل المسار</button>
    </div>
    ${targetHtml}
    ${availableSurahs.length ? manualReviewForm(plan, availableSurahs) : `<div class="review-info-state"><i class="fa-solid fa-circle-info"></i><div><strong>لا يوجد محفوظ مسجل بعد</strong><span>ابدأ تسجيل الحفظ أولًا ثم ستظهر السور المتاحة للمراجعة.</span></div></div>`}
  </section>`;
}

function manualReviewForm(plan, availableSurahs) {
  const completeSurahs = availableSurahs.filter(item => item.memorizedPages.length === item.pages.length);
  const hasCompleteSurahs = completeSurahs.length > 0;
  const streamField = plan.mode === REVIEW_MODES.balanced
    ? `<div class="field"><label for="review-stream">نوع المراجعة</label><select id="review-stream"><option value="recent">تثبيت حديث</option><option value="old">مراجعة قديمة</option></select></div>`
    : '';
  const surahOptions = completeSurahs.map(item => `<option value="${item.number}">${item.number}. ${escapeHtml(item.name)}</option>`).join('');

  return `<form class="manual-review-form" id="manual-review-form">
    <div class="review-entry-mode" role="radiogroup" aria-label="طريقة تحديد المراجعة">
      <label class="${hasCompleteSurahs ? '' : 'is-disabled'}"><input type="radio" name="reviewEntryMode" value="surah" ${hasCompleteSurahs ? 'checked' : 'disabled'}><span><i class="fa-solid fa-book-quran"></i> حسب السور</span></label>
      <label><input type="radio" name="reviewEntryMode" value="pages" ${hasCompleteSurahs ? '' : 'checked'}><span><i class="fa-solid fa-file-lines"></i> حسب الصفحات</span></label>
    </div>
    <div class="manual-review-grid">
      ${streamField}
      <div class="field"><label for="review-date">تاريخ المراجعة</label><input id="review-date" type="date" value="${todayISO()}" required></div>
    </div>
    <div id="review-surah-entry" ${hasCompleteSurahs ? '' : 'hidden'}>
      <div class="manual-review-range">
        <div class="field"><label for="review-surah-from">من سورة</label><select id="review-surah-from" ${hasCompleteSurahs ? 'required' : ''}>${surahOptions}</select></div>
        <div class="range-arrow" aria-hidden="true"><i class="fa-solid fa-arrow-left-long"></i></div>
        <div class="field"><label for="review-surah-to">إلى سورة</label><select id="review-surah-to" ${hasCompleteSurahs ? 'required' : ''}>${surahOptions}</select></div>
      </div>
      <small class="field-help"><i class="fa-solid fa-circle-info"></i> تظهر السور المكتملة الحفظ فقط. للمراجعة داخل سورة غير مكتملة استخدم «حسب الصفحات».</small>
    </div>
    <div id="review-pages-entry" ${hasCompleteSurahs ? 'hidden' : ''}>
      <div class="manual-review-range">
        <div class="field"><label for="review-page-from">من صفحة المصحف</label><input id="review-page-from" class="review-page-combobox" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" list="review-page-from-list" placeholder="اكتب أو اختر رقم الصفحة"><datalist id="review-page-from-list"></datalist></div>
        <div class="range-arrow" aria-hidden="true"><i class="fa-solid fa-arrow-left-long"></i></div>
        <div class="field"><label for="review-page-to">إلى صفحة المصحف</label><input id="review-page-to" class="review-page-combobox" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" list="review-page-to-list" placeholder="اكتب أو اختر رقم الصفحة"><datalist id="review-page-to-list"></datalist></div>
      </div>
      <small class="field-help"><i class="fa-solid fa-circle-info"></i> اكتب رقم الصفحة مباشرة أو اختره من القائمة. يقبل النظام الصفحات المحفوظة بالكامل فقط.</small>
    </div>
    <div class="review-selection-summary" id="review-selection-summary"></div>
    <div class="manual-review-actions">
      <button class="button button-secondary" type="submit" data-review-status="done"><i class="fa-solid fa-check"></i> تسجيل المراجعة</button>
      <button class="button button-ghost" type="submit" data-review-status="reinforce"><i class="fa-solid fa-thumbtack"></i> تسجيل ويحتاج تثبيت</button>
    </div>
  </form>`;
}

function reviewPlanDescription(plan) {
  if (plan.mode === REVIEW_MODES.sequential) {
    const direction = plan.direction === 'end_to_start' ? 'من آخر المحفوظ إلى أوله' : 'من أول المحفوظ إلى آخره';
    return `${direction} · هدف ${plan.dailyPages} صفحة في يوم المراجعة. أنت تحدد المقطع الذي راجعته يوميًا.`;
  }
  if (plan.mode === REVIEW_MODES.balanced) {
    return `هدف ${plan.dailyPages} صفحة يوميًا. عند التسجيل حدد هل المقطع تثبيت حديث أم مراجعة قديمة.`;
  }
  return 'لا يوجد هدف إلزامي. سجل ما راجعه الطالب فعليًا وقتما يريد.';
}

function bindManualReviewForm(student, progress) {
  const form = root.querySelector('#manual-review-form');
  if (!form) return;

  const surahFromSelect = form.querySelector('#review-surah-from');
  const surahToSelect = form.querySelector('#review-surah-to');
  const pageFromInput = form.querySelector('#review-page-from');
  const pageToInput = form.querySelector('#review-page-to');
  const pageFromList = form.querySelector('#review-page-from-list');
  const pageToList = form.querySelector('#review-page-to-list');
  const surahEntry = form.querySelector('#review-surah-entry');
  const pagesEntry = form.querySelector('#review-pages-entry');
  const summary = form.querySelector('#review-selection-summary');
  const physicalPages = memorizedPhysicalPages(quranMap, progress);
  const physicalPageSet = new Set(physicalPages);

  const entryMode = () => form.querySelector('input[name="reviewEntryMode"]:checked')?.value || 'pages';
  const streamValue = () => student.reviewPlan.mode === REVIEW_MODES.balanced
    ? String(form.querySelector('#review-stream')?.value || 'old')
    : student.reviewPlan.mode === REVIEW_MODES.sequential ? 'sequential' : 'free';

  const parsePage = input => {
    const raw = String(input?.value || '').trim();
    if (!/^\d+$/.test(raw)) return null;
    const page = Number(raw);
    return Number.isInteger(page) ? page : null;
  };

  const validateMemorizedPage = input => {
    if (!input) return false;
    const page = parsePage(input);
    const valid = page !== null && physicalPageSet.has(page);
    input.setCustomValidity(valid ? '' : 'اختر رقم صفحة محفوظة من القائمة.');
    return valid;
  };

  const contiguousFrom = from => {
    if (!physicalPageSet.has(from)) return [];
    const rows = [];
    for (let page = from; physicalPageSet.has(page); page += 1) rows.push(page);
    return rows;
  };

  const validatePageTo = () => {
    if (!pageToInput) return false;
    const from = parsePage(pageFromInput);
    const to = parsePage(pageToInput);
    const valid = from !== null && to !== null && validateMemorizedPage(pageFromInput) && contiguousFrom(from).includes(to);
    pageToInput.setCustomValidity(valid ? '' : 'اختر صفحة نهاية من القائمة المتاحة بعد صفحة البداية.');
    return valid;
  };

  const refreshSummary = () => {
    try {
      if (entryMode() === 'pages') {
        const from = parsePage(pageFromInput);
        const to = parsePage(pageToInput);
        if (!validateMemorizedPage(pageFromInput) || !validatePageTo() || from === null || to === null) {
          summary.innerHTML = `<i class="fa-solid fa-circle-info"></i><span>اكتب أو اختر صفحتين محفوظتين لعرض ملخص المراجعة.</span>`;
          return;
        }
        const segment = createManualReviewPageRange(quranMap, progress, from, to, streamValue());
        const names = segment.surahSegments.map(item => item.surahName).filter(Boolean);
        const namesText = names.length <= 3 ? names.join('، ') : `${names[0]}، ${names[1]} + ${names.length - 2} سور`;
        summary.innerHTML = `<i class="fa-solid fa-file-lines"></i><span>${segment.startPage === segment.endPage ? `صفحة ${segment.startPage}` : `صفحات ${segment.startPage}–${segment.endPage}`} · <strong>${segment.pages.length} صفحة</strong>${namesText ? ` · ${escapeHtml(namesText)}` : ''}</span>`;
        return;
      }

      const segment = createManualReviewSurahRange(quranMap, progress, Number(surahFromSelect?.value), Number(surahToSelect?.value), streamValue());
      const surahText = segment.startSurahNumber === segment.endSurahNumber
        ? `سورة ${segment.startSurahName}`
        : `من سورة ${segment.startSurahName} إلى سورة ${segment.endSurahName}`;
      summary.innerHTML = `<i class="fa-solid fa-book-open"></i><span>${escapeHtml(surahText)} · <strong>${segment.surahSegments.length} ${segment.surahSegments.length === 1 ? 'سورة' : 'سور'}</strong> · ${segment.pages.length} صفحة</span>`;
    } catch (error) {
      summary.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i><span>${escapeHtml(error.message)}</span>`;
    }
  };

  const refreshPageToOptions = ({ reset = false } = {}) => {
    if (!pageFromInput || !pageToInput || !pageToList) return;
    const from = parsePage(pageFromInput);
    const validFrom = validateMemorizedPage(pageFromInput) && from !== null;
    const contiguous = validFrom ? contiguousFrom(from) : [];
    pageToList.innerHTML = contiguous.map(page => `<option value="${page}"></option>`).join('');

    const currentTo = parsePage(pageToInput);
    if (reset || currentTo === null || !contiguous.includes(currentTo)) {
      pageToInput.value = validFrom ? String(from) : '';
    }
    validatePageTo();
  };

  const refreshPhysicalPages = () => {
    if (!pageFromInput || !pageToInput || !pageFromList) return;
    pageFromList.innerHTML = physicalPages.map(page => `<option value="${page}"></option>`).join('');
    if (physicalPages.length) {
      pageFromInput.value = String(physicalPages[0]);
      pageToInput.value = String(physicalPages[0]);
    }
    refreshPageToOptions({ reset: false });
  };

  const refreshEntryMode = () => {
    const pagesMode = entryMode() === 'pages';
    surahEntry.hidden = pagesMode;
    pagesEntry.hidden = !pagesMode;
    if (surahFromSelect) surahFromSelect.required = !pagesMode;
    if (surahToSelect) surahToSelect.required = !pagesMode;
    if (pageFromInput) pageFromInput.required = pagesMode;
    if (pageToInput) pageToInput.required = pagesMode;
    if (pagesMode) {
      validateMemorizedPage(pageFromInput);
      validatePageTo();
    } else {
      pageFromInput?.setCustomValidity('');
      pageToInput?.setCustomValidity('');
    }
    refreshSummary();
  };

  surahFromSelect?.addEventListener('change', () => {
    if (surahToSelect) surahToSelect.value = surahFromSelect.value;
    refreshSummary();
  });
  surahToSelect?.addEventListener('change', refreshSummary);

  const handleFromPageChange = () => {
    refreshPageToOptions({ reset: true });
    refreshSummary();
  };
  pageFromInput?.addEventListener('input', handleFromPageChange);
  pageFromInput?.addEventListener('change', handleFromPageChange);
  pageToInput?.addEventListener('input', () => {
    validatePageTo();
    refreshSummary();
  });
  pageToInput?.addEventListener('change', () => {
    validatePageTo();
    refreshSummary();
  });
  form.querySelectorAll('input[name="reviewEntryMode"]').forEach(input => input.addEventListener('change', refreshEntryMode));
  form.querySelector('#review-stream')?.addEventListener('change', refreshSummary);

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const submitter = event.submitter || form.querySelector('button[type="submit"]');
    const status = submitter?.dataset.reviewStatus === 'reinforce' ? 'reinforce' : 'done';
    setBusy(submitter, true, 'جارٍ التسجيل...');

    try {
      const stream = streamValue();
      let segment;
      if (entryMode() === 'pages') {
        if (!validateMemorizedPage(pageFromInput) || !validatePageTo()) {
          throw new Error('اكتب أو اختر أرقام صفحات محفوظة صحيحة.');
        }
        segment = createManualReviewPageRange(quranMap, progress, Number(pageFromInput.value), Number(pageToInput.value), stream);
      } else {
        segment = createManualReviewSurahRange(quranMap, progress, Number(surahFromSelect.value), Number(surahToSelect.value), stream);
      }

      const reviewedOn = form.querySelector('#review-date').value || todayISO();
      const record = createReviewSession(student.id, student.reviewPlan.mode, segment, reviewedOn, status);
      await saveReviewSession(record);
      toast(status === 'reinforce' ? 'تم تسجيل المراجعة وتعليم المقطع بأنه يحتاج تثبيت.' : 'تم تسجيل المراجعة.');
      await renderReview(student.id);
    } catch (error) {
      toast(error.message || 'تعذر تسجيل المراجعة.', 'error');
    } finally {
      setBusy(submitter, false);
    }
  });

  refreshPhysicalPages();
  if (surahFromSelect && surahToSelect && surahFromSelect.value) surahToSelect.value = surahFromSelect.value;
  refreshEntryMode();
}

function staleReviewPanel(insights) {
  const rows = insights.staleSurahs || [];
  return `<section class="panel stale-review-panel">
    <div class="section-title"><div><span class="eyebrow">للمعلومية فقط</span><h2>لم تراجع منذ مدة</h2></div><span>${insights.overdue14 + insights.neverReviewed} وحدة</span></div>
    <p class="section-note">هذه معلومات تساعد الطالب على رؤية ما أهمله، ولا يفرض النظام منها مراجعة أو ترتيبًا معينًا.</p>
    ${rows.length ? `<div class="stale-review-list">${rows.map(row => staleReviewRow(row)).join('')}</div>` : `<div class="empty-inline">لا توجد بيانات مراجعة كافية حتى الآن.</div>`}
  </section>`;
}

function staleReviewRow(row) {
  let detail = 'المراجعة منتظمة';
  let tone = 'ok';
  if (row.reinforcementPages > 0) {
    detail = `${row.reinforcementPages} صفحة تحتاج تثبيت`;
    tone = 'reinforce';
  } else if (row.neverReviewedPages > 0) {
    detail = `${row.neverReviewedPages} صفحة لم تسجل مراجعتها`;
    tone = 'never';
  } else if (row.oldestDays > 0) {
    detail = `أقدم مراجعة منذ ${row.oldestDays} يوم`;
    tone = row.oldestDays >= 14 ? 'late' : 'ok';
  }
  return `<div class="stale-review-row"><div><strong>سورة ${escapeHtml(row.surahName)}</strong><small>${row.memorizedPages} صفحة محفوظة</small></div><span class="${tone}">${escapeHtml(detail)}</span></div>`;
}

function reviewHistoryPanel(history) {
  return `<section class="panel history-panel review-history-panel">
    <div class="section-title"><div><span class="eyebrow">السجل</span><h2>سجل المراجعة</h2></div><span>${history.length} جلسة</span></div>
    ${history.length ? activityTimeline(reviewHistoryGroups(history), 'review') : `<div class="empty-inline">لم يتم تسجيل مراجعات بعد.</div>`}
  </section>`;
}

async function editReviewPlan(student) {
  const current = student.reviewPlan || {};
  const selectedMode = current.mode || REVIEW_MODES.balanced;
  const dailyPages = current.dailyPages || 10;
  const direction = current.direction || 'start_to_end';

  root.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="review-plan-modal">
    <form class="modal review-plan-modal" id="review-plan-form">
      <button class="modal-close" type="button" aria-label="إغلاق"><i class="fa-solid fa-xmark"></i></button>
      <div class="modal-icon"><i class="fa-solid fa-arrows-rotate"></i></div>
      <h2>${student.reviewPlan ? 'تعديل مسار المراجعة' : 'إعداد المراجعة'}</h2>
      <p>المسار ينظم طريقة المتابعة فقط. النظام لن يختار للطالب صفحات المراجعة.</p>
      <div class="review-mode-grid">
        <label class="review-mode-card"><input type="radio" name="reviewMode" value="${REVIEW_MODES.sequential}" ${selectedMode === REVIEW_MODES.sequential ? 'checked' : ''}><span><i class="fa-solid fa-list-ol"></i></span><strong>تسلسلية</strong><small>من أول المحفوظ أو آخره، والطالب يسجل ما راجعه بنفسه.</small></label>
        <label class="review-mode-card"><input type="radio" name="reviewMode" value="${REVIEW_MODES.balanced}" ${selectedMode === REVIEW_MODES.balanced ? 'checked' : ''}><span><i class="fa-solid fa-code-branch"></i></span><strong>حديث + قديم</strong><small>الطالب يحدد وقت التسجيل هل المراجعة حديثة أم قديمة.</small></label>
        <label class="review-mode-card"><input type="radio" name="reviewMode" value="${REVIEW_MODES.free}" ${selectedMode === REVIEW_MODES.free ? 'checked' : ''}><span><i class="fa-solid fa-hand-pointer"></i></span><strong>حرة</strong><small>تسجيل ما تمت مراجعته بدون هدف يومي.</small></label>
      </div>
      <div id="review-daily-field" class="field"><label for="review-daily-pages">هدف المراجعة اليومي</label><div class="number-input-wrap"><input id="review-daily-pages" type="number" inputmode="numeric" min="1" max="604" step="1" value="${dailyPages}" required><span>صفحة</span></div></div>
      <div id="review-direction-field" class="field"><label>اتجاه المسار التسلسلي</label><div class="review-direction-options"><label><input type="radio" name="reviewDirection" value="start_to_end" ${direction === 'start_to_end' ? 'checked' : ''}><span>من أول المحفوظ</span></label><label><input type="radio" name="reviewDirection" value="end_to_start" ${direction === 'end_to_start' ? 'checked' : ''}><span>من آخر المحفوظ</span></label></div></div>
      <div class="plan-reset-note"><i class="fa-solid fa-circle-info"></i><span>كل المراجعات السابقة ستبقى محفوظة مهما غيّرت المسار.</span></div>
      <div class="modal-actions"><button type="button" class="button button-ghost modal-cancel">إلغاء</button><button type="submit" class="button button-primary"><i class="fa-solid fa-floppy-disk"></i> حفظ الإعداد</button></div>
    </form>
  </div>`);

  const modal = root.querySelector('#review-plan-modal');
  const form = modal?.querySelector('#review-plan-form');
  const dailyField = modal?.querySelector('#review-daily-field');
  const directionField = modal?.querySelector('#review-direction-field');
  const dailyInput = modal?.querySelector('#review-daily-pages');
  const close = () => modal?.remove();

  const refreshModeFields = () => {
    const mode = form?.querySelector('input[name="reviewMode"]:checked')?.value || REVIEW_MODES.free;
    dailyField.hidden = mode === REVIEW_MODES.free;
    directionField.hidden = mode !== REVIEW_MODES.sequential;
    if (dailyInput) dailyInput.required = mode !== REVIEW_MODES.free;
  };

  modal?.querySelector('.modal-close')?.addEventListener('click', close);
  modal?.querySelector('.modal-cancel')?.addEventListener('click', close);
  modal?.addEventListener('click', event => { if (event.target === modal) close(); });
  form?.querySelectorAll('input[name="reviewMode"]').forEach(input => input.addEventListener('change', refreshModeFields));

  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    setBusy(submit, true);
    try {
      const mode = form.querySelector('input[name="reviewMode"]:checked')?.value || REVIEW_MODES.free;
      const options = {
        dailyPages: Number(form.querySelector('#review-daily-pages')?.value || 0),
        direction: form.querySelector('input[name="reviewDirection"]:checked')?.value || 'start_to_end',
      };
      const reviewPlan = createReviewPlan(mode, options, APP_CONFIG.quran.totalPages, todayISO());
      await saveStudent({ ...student, reviewPlan, updatedAt: new Date().toISOString() });
      await resetReviewState(student.id);
      close();
      toast('تم حفظ إعداد المراجعة. الطالب يحدد يوميًا ما راجعه بنفسه.');
      await renderReview(student.id);
    } catch (error) {
      toast(error.message || 'تعذر حفظ إعداد المراجعة.', 'error');
    } finally {
      setBusy(submit, false);
    }
  });

  refreshModeFields();
}

function planPanel(student, plan, report) {
  if (!plan) {
    return `<section class="panel plan-panel plan-panel-empty"><div class="plan-panel-icon"><i class="fa-solid fa-bullseye"></i></div><div class="plan-panel-copy"><span class="eyebrow">خطة الحفظ</span><h2>حدد وتيرة الحفظ للطالب</h2><p>حدد عدد الصفحات في يوم الحفظ وعدد أيام الحفظ في الأسبوع ليحسب النظام موعد الختم وحالة التقدم.</p></div><button class="button button-primary" id="edit-plan"><i class="fa-solid fa-plus"></i> إضافة خطة</button></section>`;
  }
  const state = planStatusLabel(plan);
  const paused = plan.status === 'paused';
  const targetToday = paused ? 'متوقف مؤقتًا' : plan.pagesToReachToday === 0 ? 'لا يوجد نقص عن مستهدف اليوم' : `${plan.pagesToReachToday} صفحة`;
  const projectionText = plan.remainingPages === 0
    ? 'تم الختم'
    : paused ? 'يتحدد بعد استئناف الخطة' : `${formatDate(plan.projectedFinishDate)} · بعد ${plan.daysFromCurrent} يوم تقويمي تقريبًا`;
  const plannedText = paused ? 'يتحدد بعد الاستئناف' : formatDate(plan.plannedFinishDate);
  const pauseText = paused ? `متوقفة منذ ${formatDate(plan.pausedOn)}` : 'يمكن إيقافها مؤقتًا عند المرض أو السفر بدون احتساب تأخر جديد.';

  return `<section class="panel plan-panel">
    <div class="plan-panel-head">
      <div><span class="eyebrow">خطة الحفظ</span><h2><i class="fa-solid fa-bullseye"></i> ${plan.dailyPages} صفحة × ${plan.weeklyDays} أيام أسبوعيًا</h2><p>بدأت الخطة في ${formatDate(plan.startedOn)} من رصيد ${plan.basePhysicalPagesCompleted} صفحة محفوظة. ${pauseText}</p></div>
      <div class="plan-panel-actions"><button class="button button-ghost" id="toggle-plan-pause"><i class="fa-solid ${paused ? 'fa-play' : 'fa-pause'}"></i> ${paused ? 'استئناف الخطة' : 'إيقاف مؤقت'}</button><button class="button button-ghost" id="edit-plan"><i class="fa-solid fa-pen-to-square"></i> تعديل الخطة</button></div>
    </div>
    <div class="plan-status-row">
      <div class="plan-status ${state.tone}"><span>حالة الطالب</span><strong><i class="fa-solid ${planStatusIcon(plan.status)}"></i> ${escapeHtml(state.label)}</strong><small>${escapeHtml(state.detail)}</small></div>
      <div class="plan-metric"><span>للوصول للمستهدف الحالي</span><strong>${targetToday}</strong><small>${paused ? 'لا يتم إنشاء مستهدف جديد أثناء التوقف.' : `الحساب موزع تقديريًا بحسب ${plan.weeklyDays} أيام حفظ أسبوعيًا.`}</small></div>
      <div class="plan-metric"><span>موعد الختم المخطط</span><strong>${plannedText}</strong><small>${paused ? 'سيعاد حسابه تلقائيًا عند استئناف الخطة.' : `${plan.totalPlanSessions} يوم حفظ متوقع ضمن الخطة.`}</small></div>
      <div class="plan-metric"><span>التوقع من الوضع الحالي</span><strong>${projectionText}</strong><small>${plan.remainingPages} صفحة متبقية من المصحف.</small></div>
    </div>
  </section>`;
}

function planStatusIcon(status) {
  if (status === 'behind') return 'fa-arrow-trend-down';
  if (status === 'ahead') return 'fa-arrow-trend-up';
  if (status === 'completed') return 'fa-award';
  if (status === 'paused') return 'fa-pause';
  return 'fa-route';
}

function trackingPanel(student, snap, report) {
  return `<section class="tracking-panel panel">
    <div class="tracking-copy"><span class="eyebrow">الصفحة التالية</span><h2>سورة ${escapeHtml(snap.next.surahName)}</h2><div class="page-number">${snap.next.pageNumber}</div><p>سجلها عند إتمام حفظ الجزء الخاص بهذه السورة في الصفحة.</p></div>
    <div class="tracking-actions"><label class="date-control"><span>تاريخ الحفظ</span><input id="memorized-date" type="date" value="${todayISO()}"></label><button class="button button-primary button-large" id="mark-next"><i class="fa-solid fa-check"></i> تم حفظ الصفحة</button>${snap.last ? `<button class="button button-ghost" id="undo-last"><i class="fa-solid fa-arrow-rotate-left"></i> تراجع عن آخر تسجيل</button>` : ''}<small>تم تسجيل ${snap.todayCount} وحدة اليوم</small></div>
  </section>`;
}

function completedPanel() {
  return `<section class="panel completed-panel"><div class="completed-icon"><i class="fa-solid fa-award"></i></div><div><span class="eyebrow">اكتمل المسار</span><h2>تم إكمال جميع صفحات المصحف</h2><p>لا توجد صفحات متبقية في مسار هذا الطالب.</p></div></section>`;
}

function pageChip(student, snap, progress, surahNumber, page) {
  const key = unitKey(surahNumber, page);
  const done = progress.some(item => (item.unitKey || unitKey(item.surahNumber, item.pageNumber)) === key);
  const next = snap.next && snap.next.surahNumber === surahNumber && snap.next.pageNumber === page;
  return `<span class="page-chip ${done ? 'done' : next ? 'next' : 'locked'}"><i class="fa-solid ${done ? 'fa-check' : next ? 'fa-play' : 'fa-lock'}"></i>${page}</span>`;
}

function memorizationHistoryPanel(history) {
  return `<section class="panel history-panel"><div class="section-title"><div><span class="eyebrow">السجل</span><h2>تفاصيل الحفظ</h2></div><span>${history.length} سجل</span></div>${history.length ? activityTimeline(memorizationHistoryGroups(history), 'memorization') : `<div class="empty-inline">لا توجد سجلات حتى الآن.</div>`}</section>`;
}

function memorizationHistoryGroups(history) {
  const byDate = new Map();
  for (const row of history) {
    if (!byDate.has(row.memorizedOn)) byDate.set(row.memorizedOn, []);
    byDate.get(row.memorizedOn).push(row);
  }

  return [...byDate.entries()].map(([date, rows]) => {
    const buckets = new Map();
    for (const row of rows) {
      const key = `${row.surahNumber}|${row.source}`;
      if (!buckets.has(key)) buckets.set(key, { ...row, pages: [] });
      buckets.get(key).pages.push(Number(row.pageNumber));
    }
    const items = [...buckets.values()].map(item => ({
      title: `سورة ${item.surahName}`,
      range: compactPageRanges(item.pages),
      badge: item.source === 'daily' ? 'متابعة يومية' : 'حفظ سابق',
      tone: item.source === 'daily' ? 'success' : 'neutral',
    }));
    return { date, items };
  });
}

function reviewHistoryGroups(history) {
  const byDate = new Map();
  for (const row of history) {
    if (!byDate.has(row.reviewedOn)) byDate.set(row.reviewedOn, []);
    byDate.get(row.reviewedOn).push(row);
  }

  return [...byDate.entries()].map(([date, rows]) => ({
    date,
    items: rows.map(row => {
      const names = [...new Set(row.surahNames || [])];
      const namesText = names.length === 0 ? '' : names.length <= 2 ? names.join('، ') : `${names[0]} … ${names[names.length - 1]}`;
      const pageRange = row.startPage === row.endPage ? `صفحة ${row.startPage}` : `صفحات ${row.startPage}–${row.endPage}`;
      return {
        title: row.scope === 'pages'
          ? 'مراجعة حسب الصفحات'
          : row.scope === 'surahs'
            ? (names.length <= 1 ? `سورة ${names[0] || row.surahName}` : `من سورة ${names[0]} إلى سورة ${names[names.length - 1]}`)
            : `سورة ${row.surahName}`,
        range: row.scope === 'pages' && namesText
          ? `${pageRange} · ${namesText}`
          : row.scope === 'surahs'
            ? `${names.length} ${names.length === 1 ? 'سورة' : 'سور'} · ${row.pages.length} صفحة`
            : pageRange,
        badge: row.status === 'reinforce' ? 'يحتاج تثبيت' : reviewStreamLabel(row.stream),
        tone: row.status === 'reinforce' ? 'warning' : 'success',
      };
    }),
  }));
}

function reviewStreamLabel(stream) {
  if (stream === 'recent') return 'تثبيت حديث';
  if (stream === 'old') return 'مراجعة قديمة';
  if (stream === 'sequential') return 'تسلسلية';
  return 'مراجعة';
}

function activityTimeline(groups, kind) {
  return `<div class="activity-timeline ${kind}">${groups.map(group => `<section class="activity-day"><div class="activity-day-head"><strong>${formatDate(group.date)}</strong><span>${group.items.length} ${group.items.length === 1 ? 'مقطع' : 'مقاطع'}</span></div><div class="activity-items">${group.items.map(item => `<div class="activity-item"><div class="activity-icon"><i class="fa-solid ${kind === 'review' ? 'fa-arrows-rotate' : 'fa-book-open-reader'}"></i></div><div class="activity-copy"><strong>${escapeHtml(item.title)}</strong><span>${escapeHtml(item.range)}</span></div><span class="activity-badge ${item.tone}">${escapeHtml(item.badge)}</span></div>`).join('')}</div></section>`).join('')}</div>`;
}

function compactPageRanges(pages) {
  const sorted = [...new Set(pages)].sort((a, b) => a - b);
  if (!sorted.length) return '';
  const ranges = [];
  let start = sorted[0];
  let previous = sorted[0];
  for (const page of sorted.slice(1)) {
    if (page === previous + 1) {
      previous = page;
      continue;
    }
    ranges.push(start === previous ? `صفحة ${start}` : `صفحات ${start}–${previous}`);
    start = page;
    previous = page;
  }
  ranges.push(start === previous ? `صفحة ${start}` : `صفحات ${start}–${previous}`);
  return ranges.join('، ');
}

function weekBar(day, days) {
  const max = Math.max(1, ...days.map(row => row.count));
  const height = day.count ? Math.max(12, Math.round(day.count / max * 100)) : 4;
  return `<div class="week-day"><div class="bar-space"><span style="height:${height}%" title="${day.count}"></span></div><b>${day.count}</b><small>${day.label}</small></div>`;
}

async function markNext(student) {
  const button = root.querySelector('#mark-next');
  setBusy(button, true, 'جارٍ التسجيل...');
  try {
    const progress = await getProgress(student.id);
    const snap = snapshot(quranMap, student, progress);
    if (!snap.next) throw new Error('تم إكمال المصحف بالفعل.');
    const date = root.querySelector('#memorized-date')?.value || todayISO();
    await putProgress([createDailyEntry(student.id, snap.next, date)]);
    toast(`تم تسجيل صفحة ${snap.next.pageNumber} من سورة ${snap.next.surahName}.`);
    await renderStudent(student.id);
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    setBusy(button, false);
  }
}

async function undoLast(student, progress, snap) {
  if (!snap.last) return;
  const lastKey = `${student.id}|${snap.last.key}`;
  const entry = progress.find(item => item.key === lastKey);
  if (!entry || entry.source !== 'daily') return toast('آخر حفظ جزء من الحفظ السابق ولا يمكن التراجع عنه من هنا.', 'error');
  if (!confirm(`التراجع عن صفحة ${snap.last.pageNumber} من سورة ${snap.last.surahName}؟`)) return;
  await deleteProgress(lastKey);
  toast('تم التراجع عن آخر تسجيل.');
  await renderStudent(student.id);
}

async function editStudentName(student) {
  const value = prompt('اسم الطالب:', student.name);
  if (value === null) return;
  const name = value.trim();
  if (!name) return toast('اسم الطالب لا يمكن أن يكون فارغًا.', 'error');
  await saveStudent({ ...student, name, updatedAt: new Date().toISOString() });
  toast('تم تعديل اسم الطالب.');
  await renderStudent(student.id);
}

async function editStudentPlan(student, report) {
  const currentPages = student.plan?.dailyPages || 2;
  const currentDays = student.plan?.weeklyDays || 7;
  root.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="plan-modal"><form class="modal plan-modal" id="plan-form"><button class="modal-close" type="button" aria-label="إغلاق"><i class="fa-solid fa-xmark"></i></button><div class="modal-icon"><i class="fa-solid fa-bullseye"></i></div><h2>${student.plan ? 'تعديل خطة الحفظ' : 'إضافة خطة حفظ'}</h2><p>حدد وتيرة واقعية للحفظ: كم صفحة في يوم الحفظ، وكم يومًا في الأسبوع.</p><div class="plan-modal-grid"><div class="field"><label for="plan-daily-pages">الصفحات في يوم الحفظ</label><div class="number-input-wrap"><input id="plan-daily-pages" type="number" inputmode="numeric" min="1" max="604" step="1" value="${currentPages}" required><span>صفحة</span></div></div><div class="field"><label for="plan-weekly-days">أيام الحفظ في الأسبوع</label><div class="number-input-wrap"><input id="plan-weekly-days" type="number" inputmode="numeric" min="1" max="7" step="1" value="${currentDays}" required><span>يوم</span></div></div></div><div class="plan-reset-note"><i class="fa-solid fa-circle-info"></i><span>عند الحفظ ستبدأ الخطة الجديدة من اليوم اعتمادًا على الرصيد الحالي: <strong>${report.physicalPagesCompleted} صفحة</strong>. إذا لم تحدد أيامًا بعينها، يوزع النظام عدد أيام الحفظ تقديريًا على الأسبوع.</span></div><div class="modal-actions"><button type="button" class="button button-ghost modal-cancel">إلغاء</button><button type="submit" class="button button-primary"><i class="fa-solid fa-floppy-disk"></i> حفظ الخطة</button></div></form></div>`);
  const modal = root.querySelector('#plan-modal');
  const form = modal?.querySelector('#plan-form');
  const close = () => modal?.remove();
  modal?.querySelector('.modal-close')?.addEventListener('click', close);
  modal?.querySelector('.modal-cancel')?.addEventListener('click', close);
  modal?.addEventListener('click', event => { if (event.target === modal) close(); });
  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const submit = form.querySelector('button[type="submit"]');
    setBusy(submit, true);
    try {
      const dailyPages = Number(form.querySelector('#plan-daily-pages').value);
      const weeklyDays = Number(form.querySelector('#plan-weekly-days').value);
      const updated = {
        ...student,
        plan: createMemorizationPlan(dailyPages, report.physicalPagesCompleted, todayISO(), report.physicalPagesTotal, weeklyDays),
        updatedAt: new Date().toISOString(),
      };
      await saveStudent(updated);
      close();
      toast('تم تحديث خطة الحفظ وبدأ الحساب من اليوم.');
      await renderStudent(student.id);
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setBusy(submit, false);
    }
  });
}

async function removeStudent(student) {
  if (!confirm(`سيتم حذف الطالب «${student.name}» وجميع سجلات حفظه. هل أنت متأكد؟`)) return;
  await deleteStudent(student.id);
  toast('تم حذف الطالب.');
  location.hash = '#/';
}

async function downloadBackup() {
  try {
    const payload = await exportDatabase();
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `quran-memorization-backup-${todayISO()}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 500);
    toast('تم إنشاء النسخة الاحتياطية. احفظ الملف في مكان آمن.');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function restoreBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (!confirm('الاستعادة ستستبدل البيانات الموجودة حاليًا على هذا الجهاز. هل تريد المتابعة؟')) return;
  try {
    const payload = JSON.parse(await file.text());
    await replaceDatabase(payload);
    toast('تمت استعادة النسخة الاحتياطية بنجاح.');
    location.hash = '#/';
    await renderDashboard();
  } catch (error) {
    toast(error.message || 'تعذر استعادة النسخة.', 'error');
  }
}

function showInstallHelp() {
  root.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="install-modal"><div class="modal"><button class="modal-close" aria-label="إغلاق"><i class="fa-solid fa-xmark"></i></button><div class="modal-icon"><i class="fa-solid fa-mobile-screen-button"></i></div><h2>تثبيت التطبيق على الهاتف</h2><p>من Chrome افتح قائمة <strong>⋮</strong> ثم اختر <strong>تثبيت التطبيق</strong> أو <strong>إضافة إلى الشاشة الرئيسية</strong>.</p><p class="muted">بعد فتح التطبيق مرة واحدة أثناء وجود الإنترنت، سيعمل بدون إنترنت.</p><button class="button button-primary button-block modal-ok">حسنًا</button></div></div>`);
  const modal = root.querySelector('#install-modal');
  const close = () => modal?.remove();
  modal?.querySelector('.modal-close')?.addEventListener('click', close);
  modal?.querySelector('.modal-ok')?.addEventListener('click', close);
  modal?.addEventListener('click', event => { if (event.target === modal) close(); });
}

function todayActivityStrip(activity) {
  if (activity.todayStatus === 'none') {
    return `<div class="today-activity-strip empty"><i class="fa-solid fa-clock"></i><span>لم تسجل متابعة اليوم</span></div>`;
  }
  return `<div class="today-activity-strip">
    ${activity.memorizedTodayPages > 0 ? `<span><i class="fa-solid fa-check"></i> حفظ اليوم ${activity.memorizedTodayPages} صفحة</span>` : ''}
    ${activity.reviewedTodayPages > 0 ? `<span><i class="fa-solid fa-check"></i> راجع اليوم ${activity.reviewedTodayPages} صفحة</span>` : ''}
  </div>`;
}

function weeklyActivityPanel(summary) {
  return `<section class="panel weekly-summary-panel">
    <div class="weekly-summary-head"><div><span class="eyebrow">ملخص سريع</span><h2>آخر 7 أيام</h2></div><small>الحفظ والمراجعة معًا</small></div>
    <div class="weekly-summary-grid">
      <div><span class="weekly-summary-icon"><i class="fa-solid fa-book-open-reader"></i></span><strong>${summary.memorizedPages}</strong><small>صفحة حفظ</small></div>
      <div><span class="weekly-summary-icon"><i class="fa-solid fa-arrows-rotate"></i></span><strong>${summary.reviewedPages}</strong><small>صفحة مراجعة</small></div>
      <div><span class="weekly-summary-icon"><i class="fa-solid fa-calendar-check"></i></span><strong>${summary.activeDays}</strong><small>أيام نشاط</small></div>
    </div>
  </section>`;
}

async function toggleStudentPlanPause(student) {
  if (!student.plan) return;
  const paused = Boolean(student.plan.pausedOn);
  const message = paused
    ? 'استئناف خطة الحفظ من اليوم؟ سيعود النظام لحساب التقدم ابتداءً من اليوم.'
    : 'إيقاف خطة الحفظ مؤقتًا من اليوم؟ لن يحسب النظام تأخرًا جديدًا أثناء التوقف.';
  if (!confirm(message)) return;

  try {
    const plan = paused
      ? resumeMemorizationPlan(student.plan, todayISO())
      : pauseMemorizationPlan(student.plan, todayISO());
    await saveStudent({ ...student, plan, updatedAt: new Date().toISOString() });
    toast(paused ? 'تم استئناف خطة الحفظ.' : 'تم إيقاف خطة الحفظ مؤقتًا.');
    await renderStudent(student.id);
  } catch (error) {
    toast(error.message || 'تعذر تحديث حالة الخطة.', 'error');
  }
}


function statCard(icon, value, label) {
  return `<article class="stat-card"><span class="stat-icon"><i class="fa-solid ${icon}"></i></span><div><strong>${value}</strong><span>${label}</span></div></article>`;
}

function emptyStudents() {
  return `<div class="empty-state"><div class="empty-icon"><i class="fa-solid fa-users"></i></div><h2>لا يوجد طلاب بعد</h2><p>أضف أول طالب وحدد مكان الحفظ الحالي، وبعدها تبدأ المتابعة اليومية مباشرة.</p><a class="button button-primary" href="#/students/new"><i class="fa-solid fa-user-plus"></i> إضافة أول طالب</a></div>`;
}

function renderNotFound() {
  root.innerHTML = `<div class="empty-state"><div class="empty-icon"><i class="fa-solid fa-circle-question"></i></div><h2>الطالب غير موجود</h2><a class="button button-primary" href="#/">العودة للطلاب</a></div>`;
}

function showLoading() {
  root.innerHTML = `<div class="loading-state"><i class="fa-solid fa-spinner fa-spin"></i><span>جارٍ تحميل البيانات...</span></div>`;
}

function renderFatal(error) {
  console.error(error);
  root.innerHTML = `<div class="empty-state error-state"><div class="empty-icon"><i class="fa-solid fa-triangle-exclamation"></i></div><h2>تعذر تشغيل النظام</h2><p>${escapeHtml(error?.message || 'حدث خطأ غير متوقع.')}</p><button class="button button-primary" onclick="location.reload()">إعادة المحاولة</button></div>`;
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  let reloadingForUpdate = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadingForUpdate) return;
    reloadingForUpdate = true;
    location.reload();
  });

  try {
    const registration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
    if (navigator.onLine) registration.update().catch(() => null);
    await navigator.serviceWorker.ready;
    document.documentElement.dataset.offlineReady = 'true';
  } catch (error) {
    console.warn('Service worker registration failed', error);
  }
}

async function requestPersistentStorage() {
  if (!navigator.storage?.persist) return;
  try {
    await navigator.storage.persist();
  } catch (error) {
    console.warn('Persistent storage request failed', error);
  }
}
