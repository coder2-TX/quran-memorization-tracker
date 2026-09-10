let cachedMap = null;

export async function loadQuranMap(url) {
  if (cachedMap) return cachedMap;
  const response = await fetch(url);
  if (!response.ok) throw new Error('تعذر تحميل بيانات المصحف.');
  cachedMap = await response.json();
  return cachedMap;
}

export function surah(map, number) {
  return map.surahs[String(number)] || null;
}

export function orderedSurahs(map, direction = 'start_to_end') {
  const list = Object.values(map.surahs).sort((a, b) => a.number - b.number);
  return direction === 'end_to_start' ? list.reverse() : list;
}

export function units(map, direction) {
  return orderedSurahs(map, direction).flatMap(item =>
    item.pages.map(page => ({
      key: unitKey(item.number, page),
      surahNumber: item.number,
      surahName: item.name,
      pageNumber: page,
    }))
  );
}

export function unitKey(surahNumber, pageNumber) {
  return `${surahNumber}:${pageNumber}`;
}

export function unitIndex(map, direction, surahNumber, pageNumber) {
  return units(map, direction).findIndex(unit => unit.surahNumber === surahNumber && unit.pageNumber === pageNumber);
}

export function pageUnits(map) {
  const result = new Map();
  for (const item of Object.values(map.surahs)) {
    for (const page of item.pages) {
      const keys = result.get(page) || [];
      keys.push(unitKey(item.number, page));
      result.set(page, keys);
    }
  }
  return result;
}
