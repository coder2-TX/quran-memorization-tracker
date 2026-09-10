import { APP_CONFIG } from './config.js';
import { getStudents, getStudent, saveStudent, deleteStudent, getProgress, putProgress, deleteProgress, exportDatabase, replaceDatabase } from './core/db.js';
import { loadQuranMap, orderedSurahs, surah, unitKey } from './domain/quran.js';
import { snapshot, initialProgress, createDailyEntry, progressReport, historyRows, dashboardReport, todayISO } from './domain/memorization.js';
import { createMemorizationPlan, planSnapshot, planStatusLabel } from './domain/plan.js';
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
  const match = hash.match(/^#\/students\/([^/]+)$/);
  if (hash === '#/students/new') return renderCreateStudent();
  if (match) return renderStudent(match[1]);
  return renderDashboard();
}

async function renderDashboard() {
  showLoading();
  const students = (await getStudents()).sort((a, b) => a.name.localeCompare(b.name, 'ar'));
  const items = [];
  for (const student of students) {
    const progress = await getProgress(student.id);
    const snap = snapshot(quranMap, student, progress);
    const report = progressReport(quranMap, snap, progress);
    const plan = planSnapshot(student.plan, report.physicalPagesCompleted, report.physicalPagesTotal, todayISO());
    items.push({ student, progress, snapshot: snap, report, plan });
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
  const { student, snapshot: snap, report, plan } = item;
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
      <div class="plan-card-strip ${planState.tone}"><span><i class="fa-solid fa-bullseye"></i> ${escapeHtml(planState.label)}</span><strong>${plan ? `${plan.dailyPages} صفحة/يوم` : 'حدد هدفًا يوميًا'}</strong></div>
      <a class="button button-secondary button-block" href="#/students/${encodeURIComponent(student.id)}"><i class="fa-solid fa-book-open-reader"></i> متابعة الحفظ</a>
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
        <label class="choice-card"><input type="radio" name="direction" value="start_to_end" checked><span class="choice-icon"><i class="fa-solid fa-arrow-left-long"></i></span><span><strong>من بداية المصحف</strong><small>الفاتحة ثم البقرة ثم ما بعدها</small></span></label>
        <label class="choice-card"><input type="radio" name="direction" value="end_to_start"><span class="choice-icon"><i class="fa-solid fa-arrow-right-long"></i></span><span><strong>من نهاية المصحف</strong><small>الناس ثم الفلق ثم ما قبلها</small></span></label>
      </div></fieldset>
      <div class="field"><label for="initial-mode">الحفظ الموجود قبل استخدام النظام</label><select id="initial-mode" name="initialMode"><option value="none">يبدأ المتابعة من البداية</option><option value="completed_surah">آخر سورة أكملها</option><option value="within_surah">وصل إلى صفحة داخل سورة</option></select></div>
      <div id="initial-fields" class="initial-fields" hidden>
        <div class="field"><label for="surah-number">السورة</label><select id="surah-number" name="surahNumber"><option value="">اختر السورة</option>${surahs.map(s => `<option value="${s.number}">${s.number}. ${escapeHtml(s.name)}</option>`).join('')}</select></div>
        <div class="field" id="page-field" hidden><label for="page-number">آخر صفحة محفوظة داخل السورة</label><select id="page-number" name="pageNumber"></select></div>
      </div>
      <div class="field plan-target-field"><label for="daily-pages">الهدف اليومي للحفظ</label><div class="number-input-wrap"><input id="daily-pages" name="dailyPages" type="number" inputmode="numeric" min="1" max="604" step="1" value="2" required><span>صفحة يوميًا</span></div><small class="field-help"><i class="fa-solid fa-circle-info"></i> مثال: إذا اخترت 2، سيحسب النظام موعد الختم ويقارن التقدم بالخطة يوميًا. يمكنك تعديل الهدف لاحقًا.</small></div>
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
      student.plan = createMemorizationPlan(Number(data.get('dailyPages')), initialReport.physicalPagesCompleted, todayISO(), initialReport.physicalPagesTotal);
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
  const snap = snapshot(quranMap, student, progress);
  const report = progressReport(quranMap, snap, progress);
  const plan = planSnapshot(student.plan, report.physicalPagesCompleted, report.physicalPagesTotal, todayISO());
  const history = historyRows(quranMap, progress);
  const current = snap.currentSurah;
  const currentProgress = report.currentSurah;

  root.innerHTML = `
    <section class="student-heading">
      <div><a class="back-link" href="#/"><i class="fa-solid fa-arrow-right"></i> الطلاب</a><div class="student-name-line"><div class="avatar large"><i class="fa-solid fa-user"></i></div><div><h1>${escapeHtml(student.name)}</h1><p>${student.direction === 'end_to_start' ? 'الحفظ من نهاية المصحف إلى بدايته' : 'الحفظ من بداية المصحف إلى نهايته'}</p></div></div></div>
      <div class="student-menu"><button class="icon-button" id="edit-name" title="تعديل الاسم"><i class="fa-solid fa-pen"></i></button><button class="icon-button danger" id="delete-student" title="حذف الطالب"><i class="fa-solid fa-trash"></i></button></div>
    </section>

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

    <section class="panel weekly-panel"><div class="section-title"><div><span class="eyebrow">الحركة الأخيرة</span><h2>آخر 7 أيام</h2></div><span>${report.lastSevenTotal} وحدة</span></div><div class="week-chart">${report.lastSevenDays.map(day => weekBar(day, report.lastSevenDays)).join('')}</div></section>

    <section class="panel history-panel"><div class="section-title"><div><span class="eyebrow">السجل</span><h2>تفاصيل الحفظ</h2></div><span>${history.length} سجل</span></div>${history.length ? `<div class="table-wrap"><table><thead><tr><th>التاريخ</th><th>السورة</th><th>الصفحة</th><th>النوع</th></tr></thead><tbody>${history.map(row => `<tr><td>${formatDate(row.memorizedOn)}</td><td>سورة ${escapeHtml(row.surahName)}</td><td>${row.pageNumber}</td><td><span class="type-badge ${row.source}">${row.source === 'daily' ? 'متابعة يومية' : 'حفظ سابق'}</span></td></tr>`).join('')}</tbody></table></div>` : `<div class="empty-inline">لا توجد سجلات حتى الآن.</div>`}</section>
  `;

  root.querySelector('#mark-next')?.addEventListener('click', () => markNext(student));
  root.querySelector('#undo-last')?.addEventListener('click', () => undoLast(student, progress, snap));
  root.querySelector('#edit-name')?.addEventListener('click', () => editStudentName(student));
  root.querySelector('#edit-plan')?.addEventListener('click', () => editStudentPlan(student, report));
  root.querySelector('#delete-student')?.addEventListener('click', () => removeStudent(student));
}

function planPanel(student, plan, report) {
  if (!plan) {
    return `<section class="panel plan-panel plan-panel-empty"><div class="plan-panel-icon"><i class="fa-solid fa-bullseye"></i></div><div class="plan-panel-copy"><span class="eyebrow">خطة الحفظ</span><h2>حدد هدفًا يوميًا للطالب</h2><p>أدخل عدد الصفحات المتوقع حفظها يوميًا ليحسب النظام موعد الختم وحالة التقدم.</p></div><button class="button button-primary" id="edit-plan"><i class="fa-solid fa-plus"></i> إضافة خطة</button></section>`;
  }
  const state = planStatusLabel(plan);
  const targetToday = plan.pagesToReachToday === 0 ? 'تم بلوغ مستهدف اليوم' : `${plan.pagesToReachToday} صفحة`;
  const projectionText = plan.remainingPages === 0 ? 'تم الختم' : `${formatDate(plan.projectedFinishDate)} · بعد ${plan.daysFromCurrent} يوم تقريبًا`;
  return `<section class="panel plan-panel">
    <div class="plan-panel-head">
      <div><span class="eyebrow">خطة الحفظ</span><h2><i class="fa-solid fa-bullseye"></i> ${plan.dailyPages} صفحة يوميًا</h2><p>الخطة الحالية بدأت في ${formatDate(plan.startedOn)} من رصيد ${plan.basePhysicalPagesCompleted} صفحة محفوظة.</p></div>
      <button class="button button-ghost" id="edit-plan"><i class="fa-solid fa-pen-to-square"></i> تعديل الخطة</button>
    </div>
    <div class="plan-status-row">
      <div class="plan-status ${state.tone}"><span>حالة الطالب</span><strong><i class="fa-solid ${planStatusIcon(plan.status)}"></i> ${escapeHtml(state.label)}</strong><small>${escapeHtml(state.detail)}</small></div>
      <div class="plan-metric"><span>المطلوب للوصول للخطة اليوم</span><strong>${targetToday}</strong><small>يُراعى أن اليوم ما زال متاحًا لإكمال هدفه.</small></div>
      <div class="plan-metric"><span>موعد الختم المخطط</span><strong>${formatDate(plan.plannedFinishDate)}</strong><small>محسوب من بداية الخطة على ${plan.dailyPages} صفحة يوميًا.</small></div>
      <div class="plan-metric"><span>التوقع من الوضع الحالي</span><strong>${projectionText}</strong><small>${plan.remainingPages} صفحة متبقية من المصحف.</small></div>
    </div>
  </section>`;
}

function planStatusIcon(status) {
  if (status === 'behind') return 'fa-arrow-trend-down';
  if (status === 'ahead') return 'fa-arrow-trend-up';
  if (status === 'completed') return 'fa-award';
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
  const current = student.plan?.dailyPages || 2;
  root.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" id="plan-modal"><form class="modal plan-modal" id="plan-form"><button class="modal-close" type="button" aria-label="إغلاق"><i class="fa-solid fa-xmark"></i></button><div class="modal-icon"><i class="fa-solid fa-bullseye"></i></div><h2>${student.plan ? 'تعديل خطة الحفظ' : 'إضافة خطة حفظ'}</h2><p>حدد عدد الصفحات التي تتوقع من الطالب حفظها كل يوم.</p><div class="field"><label for="plan-daily-pages">الهدف اليومي</label><div class="number-input-wrap"><input id="plan-daily-pages" type="number" inputmode="numeric" min="1" max="604" step="1" value="${current}" required><span>صفحة يوميًا</span></div></div><div class="plan-reset-note"><i class="fa-solid fa-circle-info"></i><span>عند الحفظ ستبدأ الخطة الجديدة من اليوم، اعتمادًا على الرصيد الحالي: <strong>${report.physicalPagesCompleted} صفحة</strong>. هذا يجعل حساب التأخر والتقدم صحيحًا حتى لو غيّرت الهدف لاحقًا.</span></div><div class="modal-actions"><button type="button" class="button button-ghost modal-cancel">إلغاء</button><button type="submit" class="button button-primary"><i class="fa-solid fa-floppy-disk"></i> حفظ الخطة</button></div></form></div>`);
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
      const updated = {
        ...student,
        plan: createMemorizationPlan(dailyPages, report.physicalPagesCompleted, todayISO(), report.physicalPagesTotal),
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
  try {
    await navigator.serviceWorker.register('./sw.js', { scope: './' });
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
