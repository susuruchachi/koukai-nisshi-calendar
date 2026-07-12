// --- 日付まわりの汎用ヘルパー関数 ---

function pad(n) {
  return String(n).padStart(2, '0');
}

function dateKey(year, month, day) {
  return `${year}-${pad(month + 1)}-${pad(day)}`;
}

function todayKey() {
  const now = new Date();
  return dateKey(now.getFullYear(), now.getMonth(), now.getDate());
}

function parseDateKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return { year: y, month: m - 1, day: d };
}

function generateId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

function sanitizeFilename(str) {
  const cleaned = (str || '').replace(/[\\/:*?"<>|]/g, '').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 60) : '予定';
}

function addDaysToKey(key, days) {
  const { year, month, day } = parseDateKey(key);
  const dt = new Date(year, month, day);
  dt.setDate(dt.getDate() + days);
  return dateKey(dt.getFullYear(), dt.getMonth(), dt.getDate());
}

function emptyRecurrence() {
  return { freq: 'none', interval: 1, daysOfWeek: [], endType: 'never', endDate: '', endCount: 10 };
}
