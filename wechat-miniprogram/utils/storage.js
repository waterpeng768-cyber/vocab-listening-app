const { normalizeWord, normalizePhonetic } = require('./phonetics');

const STATE_KEY = 'vocab-listening-state-v1';
const CACHE_KEY = 'vocab-listening-lookup-cache-v1';
const LEGACY_KEYS = ['vocab-listening-words', 'vocab-listening-words-v5'];
const DEFAULT_SETTINGS = { mode: 'random', rate: 1 };

function createId() {
  return `word-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanText(value) {
  return String(value || '').trim();
}

function sanitizeSettings(value) {
  const settings = value && typeof value === 'object' ? value : {};
  const rate = Number(settings.rate);
  return {
    mode: settings.mode === 'sequential' ? 'sequential' : 'random',
    rate: Number.isFinite(rate) && rate > 0 ? rate : DEFAULT_SETTINGS.rate
  };
}

function sanitizeWord(value, now = Date.now()) {
  if (!value || typeof value !== 'object') return null;
  const word = normalizeWord(value.word);
  if (!word) return null;

  return {
    id: cleanText(value.id) || createId(),
    word,
    phonetic: normalizePhonetic(value.phonetic),
    meaning: cleanText(value.meaning),
    audioUrl: cleanText(value.audioUrl),
    source: cleanText(value.source),
    confidence: ['verified', 'review', 'manual'].includes(value.confidence)
      ? value.confidence
      : 'manual',
    createdAt: value.createdAt ?? now,
    updatedAt: value.updatedAt ?? now
  };
}

function mergeWords(existingWords, incomingWords) {
  const merged = existingWords.map((word) => ({ ...word }));
  const indexes = new Map(merged.map((word, index) => [word.word, index]));

  for (const incoming of incomingWords) {
    const index = indexes.get(incoming.word);
    if (index === undefined) {
      indexes.set(incoming.word, merged.length);
      merged.push({ ...incoming });
      continue;
    }

    const existing = merged[index];
    merged[index] = {
      ...existing,
      ...incoming,
      id: existing.id,
      createdAt: existing.createdAt
    };
  }

  return merged;
}

function sanitizeState(value) {
  const state = value && typeof value === 'object' ? value : {};
  const rows = Array.isArray(state.words) ? state.words : [];
  const words = [];

  for (const row of rows) {
    const word = sanitizeWord(row);
    if (!word) continue;
    const duplicateIndex = words.findIndex((item) => item.word === word.word);
    if (duplicateIndex === -1) words.push(word);
    else words[duplicateIndex] = mergeWords([words[duplicateIndex]], [word])[0];
  }

  return {
    version: 1,
    words,
    settings: sanitizeSettings(state.settings)
  };
}

function createStorage(wxStorage) {
  function writeState(state) {
    wxStorage.setStorageSync(STATE_KEY, state);
    return state;
  }

  function readState() {
    const current = wxStorage.getStorageSync(STATE_KEY);
    if (current && current.version === 1 && Array.isArray(current.words)) {
      return sanitizeState(current);
    }

    let legacyWords = [];
    for (const key of LEGACY_KEYS) {
      const value = wxStorage.getStorageSync(key);
      if (Array.isArray(value)) {
        legacyWords = mergeWords(
          sanitizeState({ words: legacyWords }).words,
          sanitizeState({ words: value }).words
        );
      }
    }

    const migrated = sanitizeState({ words: legacyWords, settings: DEFAULT_SETTINGS });
    if (legacyWords.length) {
      try { writeState(migrated); } catch (_) { /* Keep legacy data readable. */ }
    }
    return migrated;
  }

  function saveWord(input) {
    const word = sanitizeWord(input);
    if (!word) throw new Error('请输入有效单词');
    const state = readState();
    const words = mergeWords(state.words, [word]);
    writeState({ ...state, words });
    return words.find((item) => item.word === word.word);
  }

  function deleteWord(id) {
    const state = readState();
    const words = state.words.filter((word) => word.id !== id);
    if (words.length === state.words.length) return false;
    writeState({ ...state, words });
    return true;
  }

  function saveSettings(settings) {
    const state = readState();
    const nextSettings = sanitizeSettings({ ...state.settings, ...settings });
    writeState({ ...state, settings: nextSettings });
    return nextSettings;
  }

  function exportBackup() {
    const state = readState();
    return JSON.stringify({
      app: 'vocab-listening-app',
      version: 1,
      exportedAt: new Date().toISOString(),
      words: state.words,
      settings: state.settings
    }, null, 2);
  }

  function importBackup(text) {
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (_) {
      throw new Error('备份格式不正确');
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.words)) {
      throw new Error('备份中没有有效词库');
    }

    const incoming = sanitizeState({ words: parsed.words }).words;
    if (!incoming.length) throw new Error('备份中没有有效词库');
    const state = readState();
    const words = mergeWords(state.words, incoming);
    writeState({ ...state, words });
    return words;
  }

  function readLookupCache(word) {
    const key = normalizeWord(word);
    const cache = wxStorage.getStorageSync(CACHE_KEY);
    if (!key || !cache || typeof cache !== 'object' || Array.isArray(cache)) return null;
    return cache[key] || null;
  }

  function writeLookupCache(word, result) {
    const key = normalizeWord(word);
    if (!key) throw new Error('请输入有效单词');
    const stored = wxStorage.getStorageSync(CACHE_KEY);
    const cache = stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
    wxStorage.setStorageSync(CACHE_KEY, { ...cache, [key]: result });
    return result;
  }

  return {
    loadState: readState,
    saveWord,
    deleteWord,
    saveSettings,
    exportBackup,
    importBackup,
    readLookupCache,
    writeLookupCache
  };
}

module.exports = { createStorage };
