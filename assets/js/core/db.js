const DB_NAME = 'quran-memorization-tracker';
const DB_VERSION = 1;
const STUDENTS = 'students';
const PROGRESS = 'progress';

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
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
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
  const entries = await getProgress(id);
  await transaction([STUDENTS, PROGRESS], 'readwrite', tx => {
    tx.objectStore(STUDENTS).delete(id);
    const progress = tx.objectStore(PROGRESS);
    entries.forEach(entry => progress.delete(entry.key));
  });
}

export async function getProgress(studentId) {
  const db = await openDatabase();
  try {
    const index = db.transaction(PROGRESS, 'readonly').objectStore(PROGRESS).index('studentId');
    return await requestToPromise(index.getAll(studentId));
  } finally {
    db.close();
  }
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

export async function exportDatabase() {
  const students = await getStudents();
  const allProgress = [];
  for (const student of students) {
    allProgress.push(...await getProgress(student.id));
  }
  return {
    schema: 1,
    exportedAt: new Date().toISOString(),
    students,
    progress: allProgress,
  };
}

export async function replaceDatabase(payload) {
  if (!payload || payload.schema !== 1 || !Array.isArray(payload.students) || !Array.isArray(payload.progress)) {
    throw new Error('ملف النسخة الاحتياطية غير صحيح أو غير مدعوم.');
  }
  await transaction([STUDENTS, PROGRESS], 'readwrite', tx => {
    const students = tx.objectStore(STUDENTS);
    const progress = tx.objectStore(PROGRESS);
    students.clear();
    progress.clear();
    payload.students.forEach(student => students.put(student));
    payload.progress.forEach(entry => progress.put(entry));
  });
}
