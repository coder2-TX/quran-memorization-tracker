const DB_NAME = 'quran-memorization-tracker';
const DB_VERSION = 2;
const STUDENTS = 'students';
const PROGRESS = 'progress';
const REVIEWS = 'reviews';
const REVIEW_STATES = 'reviewStates';

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STUDENTS)) {
        const students = db.createObjectStore(STUDENTS, { keyPath: 'id' });
        students.createIndex('createdAt', 'createdAt');
        students.createIndex('name', 'name');
      }

      if (!db.objectStoreNames.contains(PROGRESS)) {
        const progress = db.createObjectStore(PROGRESS, { keyPath: 'key' });
        progress.createIndex('studentId', 'studentId');
        progress.createIndex('memorizedOn', 'memorizedOn');
      }

      if (!db.objectStoreNames.contains(REVIEWS)) {
        const reviews = db.createObjectStore(REVIEWS, { keyPath: 'id' });
        reviews.createIndex('studentId', 'studentId');
        reviews.createIndex('reviewedOn', 'reviewedOn');
      }

      if (!db.objectStoreNames.contains(REVIEW_STATES)) {
        db.createObjectStore(REVIEW_STATES, { keyPath: 'studentId' });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('تعذر تحديث قاعدة البيانات لأن نسخة أخرى من التطبيق ما زالت مفتوحة.'));
  });
}

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function transaction(storeNames, mode, callback) {
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;

    try {
      result = callback(tx);
    } catch (error) {
      tx.abort();
      db.close();
      reject(error);
      return;
    }

    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };

    tx.onerror = () => {
      db.close();
      reject(tx.error);
    };

    tx.onabort = () => {
      db.close();
      reject(tx.error || new Error('تم إلغاء عملية التخزين.'));
    };
  });
}

async function getAllFromIndex(storeName, indexName, value) {
  const db = await openDatabase();
  try {
    const index = db.transaction(storeName, 'readonly').objectStore(storeName).index(indexName);
    return await requestToPromise(index.getAll(value));
  } finally {
    db.close();
  }
}

export async function getStudents() {
  const db = await openDatabase();
  try {
    return await requestToPromise(db.transaction(STUDENTS, 'readonly').objectStore(STUDENTS).getAll());
  } finally {
    db.close();
  }
}

export async function getStudent(id) {
  const db = await openDatabase();
  try {
    return await requestToPromise(db.transaction(STUDENTS, 'readonly').objectStore(STUDENTS).get(id));
  } finally {
    db.close();
  }
}

export async function saveStudent(student) {
  await transaction([STUDENTS], 'readwrite', tx => tx.objectStore(STUDENTS).put(student));
  return student;
}

export async function deleteStudent(id) {
  const progressEntries = await getProgress(id);
  const reviewEntries = await getReviewSessions(id);

  await transaction([STUDENTS, PROGRESS, REVIEWS, REVIEW_STATES], 'readwrite', tx => {
    tx.objectStore(STUDENTS).delete(id);

    const progress = tx.objectStore(PROGRESS);
    progressEntries.forEach(entry => progress.delete(entry.key));

    const reviews = tx.objectStore(REVIEWS);
    reviewEntries.forEach(entry => reviews.delete(entry.id));

    tx.objectStore(REVIEW_STATES).delete(id);
  });
}

export async function getProgress(studentId) {
  return getAllFromIndex(PROGRESS, 'studentId', studentId);
}

export async function putProgress(entries) {
  if (!entries.length) return;

  await transaction([PROGRESS], 'readwrite', tx => {
    const store = tx.objectStore(PROGRESS);
    entries.forEach(entry => store.put(entry));
  });
}

export async function deleteProgress(key) {
  await transaction([PROGRESS], 'readwrite', tx => tx.objectStore(PROGRESS).delete(key));
}

export async function getReviewSessions(studentId) {
  return getAllFromIndex(REVIEWS, 'studentId', studentId);
}

export async function saveReviewSession(session) {
  await transaction([REVIEWS], 'readwrite', tx => tx.objectStore(REVIEWS).put(session));
  return session;
}

export async function getReviewState(studentId) {
  const db = await openDatabase();
  try {
    return await requestToPromise(
      db.transaction(REVIEW_STATES, 'readonly').objectStore(REVIEW_STATES).get(studentId),
    );
  } finally {
    db.close();
  }
}

export async function saveReviewState(state) {
  if (!state?.studentId) throw new Error('تعذر حفظ حالة المراجعة للطالب.');
  await transaction([REVIEW_STATES], 'readwrite', tx => tx.objectStore(REVIEW_STATES).put(state));
  return state;
}

export async function resetReviewState(studentId) {
  await transaction([REVIEW_STATES], 'readwrite', tx => tx.objectStore(REVIEW_STATES).delete(studentId));
}

export async function exportDatabase() {
  const students = await getStudents();
  const allProgress = [];
  const allReviews = [];
  const reviewStates = [];

  for (const student of students) {
    allProgress.push(...await getProgress(student.id));
    allReviews.push(...await getReviewSessions(student.id));

    const state = await getReviewState(student.id);
    if (state) reviewStates.push(state);
  }

  return {
    schema: 2,
    exportedAt: new Date().toISOString(),
    students,
    progress: allProgress,
    reviews: allReviews,
    reviewStates,
  };
}

export async function replaceDatabase(payload) {
  const validBase =
    payload &&
    [1, 2].includes(Number(payload.schema)) &&
    Array.isArray(payload.students) &&
    Array.isArray(payload.progress);

  if (!validBase) {
    throw new Error('ملف النسخة الاحتياطية غير صحيح أو غير مدعوم.');
  }

  const reviews = Number(payload.schema) >= 2 && Array.isArray(payload.reviews) ? payload.reviews : [];
  const reviewStates = Number(payload.schema) >= 2 && Array.isArray(payload.reviewStates) ? payload.reviewStates : [];

  await transaction([STUDENTS, PROGRESS, REVIEWS, REVIEW_STATES], 'readwrite', tx => {
    const studentsStore = tx.objectStore(STUDENTS);
    const progressStore = tx.objectStore(PROGRESS);
    const reviewsStore = tx.objectStore(REVIEWS);
    const reviewStatesStore = tx.objectStore(REVIEW_STATES);

    studentsStore.clear();
    progressStore.clear();
    reviewsStore.clear();
    reviewStatesStore.clear();

    payload.students.forEach(student => studentsStore.put(student));
    payload.progress.forEach(entry => progressStore.put(entry));
    reviews.forEach(entry => reviewsStore.put(entry));
    reviewStates.forEach(state => reviewStatesStore.put(state));
  });
}
