const { normalizeWord, normalizePhonetic } = require('./phonetics');
const { clampRate } = require('./review');
const { americanTtsUrl } = require('../config/services');

const STATE_KEY = 'vocab-listening-state-v1';
const CACHE_KEY = 'vocab-listening-lookup-cache-v1';
const CACHE_VERSION = 1;
const LEGACY_KEYS = ['vocab-listening-words', 'vocab-listening-words-v5'];
const DEFAULT_SETTINGS = { mode: 'random', rate: 1 };
const GENERIC_IPA_WARNING = '音标未标注地区，尚未确认是美式音标，请核对';

function createId() {
  return `word-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function cleanText(value) {
  return String(value || '').trim();
}

function stableHash(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function ensureUniqueIds(words) {
  const used = new Set();
  return words.map((word) => {
    let id = cleanText(word.id);
    if (!id || used.has(id)) {
      const base = `word-${stableHash(`${id}\u0000${word.word}`)}`;
      id = base;
      let suffix = 2;
      while (used.has(id)) id = `${base}-${suffix++}`;
    }
    used.add(id);
    return id === word.id ? word : { ...word, id };
  });
}

function sanitizeSettings(value) {
  const settings = value && typeof value === 'object' ? value : {};
  const rate = Number(settings.rate);
  return {
    mode: settings.mode === 'sequential' ? 'sequential' : 'random',
    rate: Number.isFinite(rate) ? clampRate(rate) : DEFAULT_SETTINGS.rate
  };
}

function sanitizeWarnings(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(cleanText).filter(Boolean))];
}

function isKnownAmericanFallback(url, word) {
  return Boolean(word) && url === americanTtsUrl(word);
}

function sanitizeWord(value, now = Date.now()) {
  if (!value || typeof value !== 'object') return null;
  const word = normalizeWord(value.word);
  if (!word) return null;

  const source = cleanText(value.source) || 'manual';
  const accent = ['us', 'generic', 'uk-only', 'missing', 'manual'].includes(value.accent)
    ? value.accent
    : 'manual';
  const warnings = sanitizeWarnings(value.warnings);
  if (accent === 'generic' && !warnings.includes(GENERIC_IPA_WARNING)) {
    warnings.push(GENERIC_IPA_WARNING);
  }
  const rawAudioUrl = cleanText(value.audioUrl);
  const knownAmericanFallback = isKnownAmericanFallback(rawAudioUrl, word);
  const audioIsAmerican = rawAudioUrl && (accent === 'generic'
    ? knownAmericanFallback
    : value.audioAccent === 'us'
      || knownAmericanFallback
      || source === 'manual'
      || source === 'freedictionaryapi');
  const audioAccent = audioIsAmerican ? 'us' : '';

  return {
    id: cleanText(value.id) || createId(),
    word,
    phonetic: normalizePhonetic(value.phonetic),
    meaning: cleanText(value.meaning),
    audioUrl: audioAccent === 'us' ? rawAudioUrl : '',
    accent,
    audioAccent,
    source,
    confidence: ['verified', 'review', 'manual'].includes(value.confidence)
      ? value.confidence
      : 'manual',
    warnings,
    createdAt: value.createdAt === null || value.createdAt === undefined
      ? now
      : value.createdAt,
    updatedAt: value.updatedAt === null || value.updatedAt === undefined
      ? now
      : value.updatedAt
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

  return ensureUniqueIds(merged);
}

function saveWordByIdentity(existingWords, incoming) {
  const words = existingWords.map((word) => ({ ...word }));
  const idIndex = words.findIndex((word) => word.id === incoming.id);
  const wordIndex = words.findIndex((word) => word.word === incoming.word);
  if (idIndex !== -1 && wordIndex !== -1 && idIndex !== wordIndex) {
    throw new Error('词库中已存在这个单词');
  }
  const index = idIndex !== -1 ? idIndex : wordIndex;

  if (index === -1) {
    words.push({ ...incoming });
    return { words, saved: words[words.length - 1] };
  }

  const existing = words[index];
  words[index] = {
    ...existing,
    ...incoming,
    id: existing.id,
    createdAt: existing.createdAt
  };
  return { words, saved: words[index] };
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
    words: ensureUniqueIds(words),
    settings: sanitizeSettings(state.settings)
  };
}

function sanitizeLookupResult(value, key) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const word = normalizeWord(value.word);
  const source = cleanText(value.source);
  const confidence = value.confidence;
  const accent = value.accent;
  const audioAccent = value.audioAccent;
  if (word !== key) return null;
  if (!['freedictionaryapi', 'mymemory'].includes(source)) return null;
  if (!['verified', 'review'].includes(confidence)) return null;
  if (!['us', 'generic', 'uk-only', 'missing'].includes(accent)) return null;
  if (!Array.isArray(value.warnings) || value.warnings.some((item) => typeof item !== 'string')) return null;

  const meaning = cleanText(value.meaning);
  const audioUrl = cleanText(value.audioUrl);
  const warnings = sanitizeWarnings(value.warnings);
  if (confidence === 'verified' && !meaning) return null;
  if (accent === 'generic' && !warnings.includes(GENERIC_IPA_WARNING)) return null;
  if (audioUrl && accent === 'generic' && !isKnownAmericanFallback(audioUrl, word)) return null;
  if (audioUrl && accent !== 'generic' && audioAccent !== 'us') return null;

  return {
    word,
    phonetic: normalizePhonetic(value.phonetic),
    meaning,
    audioUrl,
    accent,
    audioAccent: audioUrl ? 'us' : '',
    source,
    confidence,
    warnings
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
      const sanitizedCurrent = sanitizeState(current);
      if (!current.words.length || sanitizedCurrent.words.length) return sanitizedCurrent;
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
    const { words, saved } = saveWordByIdentity(state.words, word);
    writeState({ ...state, words });
    return saved;
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
    if (cache.version !== CACHE_VERSION || !cache.entries || typeof cache.entries !== 'object') return null;
    return sanitizeLookupResult(cache.entries[key], key);
  }

  function writeLookupCache(word, result) {
    const key = normalizeWord(word);
    if (!key) throw new Error('请输入有效单词');
    const entry = sanitizeLookupResult(result, key);
    if (!entry) throw new Error('查询缓存数据无效');
    const stored = wxStorage.getStorageSync(CACHE_KEY);
    const entries = stored && stored.version === CACHE_VERSION
      && stored.entries && typeof stored.entries === 'object' && !Array.isArray(stored.entries)
      ? stored.entries
      : {};
    wxStorage.setStorageSync(CACHE_KEY, {
      version: CACHE_VERSION,
      entries: { ...entries, [key]: entry }
    });
    return entry;
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
