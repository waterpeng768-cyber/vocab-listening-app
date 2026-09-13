function normalizeWord(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizePhonetic(value) {
  const inner = String(value || '').trim()
    .replace(/^[\/\[]+/, '')
    .replace(/[\/\]]+$/, '')
    .trim();
  return inner ? `/${inner}/` : '';
}

function classifyAccent(value) {
  const label = String(value || '').toLowerCase();
  if (/(^|[^a-z])(us|american|en-us)([^a-z]|$)/.test(label)) return 'us';
  if (/(^|[^a-z])(uk|british|england|en-gb)([^a-z]|$)/.test(label)) return 'uk';
  return 'generic';
}

function pickAmericanPhonetic(candidates) {
  const valid = (Array.isArray(candidates) ? candidates : [])
    .map((item) => ({ phonetic: normalizePhonetic(item.value), accent: classifyAccent(item.region) }))
    .filter((item) => item.phonetic);
  const us = valid.find((item) => item.accent === 'us');
  if (us) return us;
  const generic = valid.find((item) => item.accent === 'generic');
  if (generic) return generic;
  return valid.length ? { phonetic: '', accent: 'uk-only' } : { phonetic: '', accent: 'missing' };
}

module.exports = { normalizeWord, normalizePhonetic, classifyAccent, pickAmericanPhonetic };
