const { normalizeWord, normalizePhonetic, pickAmericanPhonetic } = require('../utils/phonetics');
const { dictionaryUrl, translationUrl, americanTtsUrl } = require('../config/services');

function walk(value, visitor, key = '', parent = null) {
  visitor(value, key, parent);
  if (Array.isArray(value)) {
    value.forEach((item) => walk(item, visitor, key, value));
  } else if (value && typeof value === 'object') {
    Object.keys(value).forEach((childKey) => walk(value[childKey], visitor, childKey, value));
  }
}

function textValue(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function audioUrl(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return textValue(value.url) || textValue(value.src);
}

function languageLabel(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  return [value.code, value.name].filter(Boolean).join(' ');
}

function isChinese(value) {
  return /(^|[^a-z])(zh(?:-cn|-hans)?|chinese)([^a-z]|$)/i.test(languageLabel(value));
}

function collectCandidates(payload) {
  const candidates = [];

  walk(payload, (value, key) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;

    const pronunciationKey = /pronunciation|phonetic/i.test(key);
    const phonetic = textValue(value.transcription)
      || textValue(value.ipa)
      || (pronunciationKey ? textValue(value.text) : '');
    if (phonetic) {
      const region = [value.region, value.accent, value.dialect, value.locale]
        .concat(Array.isArray(value.tags) ? value.tags : [])
        .filter(Boolean)
        .join(' ');
      candidates.push({
        type: 'phonetic',
        value: phonetic,
        region,
        audioUrl: audioUrl(value.audio)
      });
    }

    if (isChinese(value.language)) {
      const meaning = textValue(value.text) || textValue(value.word) || textValue(value.translation);
      if (meaning) candidates.push({ type: 'meaning', value: meaning, language: languageLabel(value.language) });
    }
  });

  return candidates;
}

function uniqueValues(candidates, type) {
  return [...new Set(candidates
    .filter((candidate) => candidate.type === type && candidate.value)
    .map((candidate) => candidate.value))];
}

function parseDictionaryPayload(payload, word) {
  const normalizedWord = normalizeWord(word);
  const candidates = collectCandidates(payload);
  const phoneticCandidates = candidates
    .filter((candidate) => candidate.type === 'phonetic')
    .map((candidate) => ({ value: candidate.value, region: candidate.region }));
  const selection = pickAmericanPhonetic(phoneticCandidates);
  const selectedCandidate = selection.accent === 'us'
    ? candidates.find((candidate) => (
      candidate.type === 'phonetic'
      && normalizePhonetic(candidate.value) === selection.phonetic
      && pickAmericanPhonetic([{ value: candidate.value, region: candidate.region }]).accent === 'us'
    ))
    : null;
  const meaning = uniqueValues(candidates, 'meaning').join('；');
  const warnings = [];

  if (selection.accent === 'uk-only') warnings.push('仅找到英式音标，请手动核对美式音标');
  if (selection.accent === 'generic') warnings.push('音标未标注地区，尚未确认是美式音标，请核对');
  if (selection.accent === 'missing') warnings.push('未找到美式音标，请手动填写');
  if (!meaning) warnings.push('未找到中文释义');

  return {
    word: normalizedWord,
    phonetic: selection.phonetic,
    meaning,
    audioUrl: selectedCandidate && selectedCandidate.audioUrl
      ? selectedCandidate.audioUrl
      : americanTtsUrl(normalizedWord),
    accent: selection.accent,
    audioAccent: 'us',
    source: 'freedictionaryapi',
    confidence: meaning ? 'verified' : 'review',
    warnings
  };
}

async function lookupWord(word, request) {
  const normalizedWord = normalizeWord(word);
  let dictionaryResult = parseDictionaryPayload(null, normalizedWord);

  try {
    const payload = await request({ url: dictionaryUrl(normalizedWord) });
    dictionaryResult = parseDictionaryPayload(payload, normalizedWord);
    if (dictionaryResult.meaning) return dictionaryResult;
  } catch (error) {
    dictionaryResult.warnings.push(error && error.message ? error.message : '词典查询失败');
  }

  const translationPayload = await request({ url: translationUrl(normalizedWord) });
  const translatedText = textValue(translationPayload
    && translationPayload.responseData
    && translationPayload.responseData.translatedText);
  const warnings = dictionaryResult.warnings.filter((warning) => warning !== '未找到中文释义');
  warnings.push('中文释义来自机器翻译，请核对后保存');

  return {
    word: normalizedWord,
    phonetic: dictionaryResult.phonetic,
    meaning: translatedText,
    audioUrl: dictionaryResult.audioUrl,
    accent: dictionaryResult.accent,
    audioAccent: dictionaryResult.audioAccent,
    source: 'mymemory',
    confidence: 'review',
    warnings
  };
}

function createCachedLookup(storage, lookup) {
  return async function cachedLookup(word) {
    const normalizedWord = normalizeWord(word);
    try {
      const cached = storage.readLookupCache(normalizedWord);
      if (cached) return cached;
    } catch (_) {
      // Cache failures must not block a live dictionary lookup.
    }

    const result = await lookup(normalizedWord);
    try {
      storage.writeLookupCache(normalizedWord, result);
    } catch (_) {
      // The fresh result remains usable when local storage is unavailable.
    }
    return result;
  };
}

module.exports = { collectCandidates, createCachedLookup, parseDictionaryPayload, lookupWord };
