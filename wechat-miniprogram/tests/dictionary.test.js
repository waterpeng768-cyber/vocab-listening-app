const test = require('node:test');
const assert = require('node:assert/strict');
const {
  collectCandidates,
  createCachedLookup,
  parseDictionaryPayload,
  lookupWord
} = require('../services/dictionary');
const { createStorage } = require('../utils/storage');

test('parses tool with US IPA and Chinese dictionary meaning', () => {
  const payload = {
    entries: [{
      pronunciations: [
        { transcription: '/tuːl/', tags: ['UK'] },
        { transcription: '/tul/', tags: ['US'], audio: { url: 'https://audio.example/tool-us.mp3' } }
      ],
      senses: [{ translations: [{ language: 'zh-CN', text: '工具；用具' }] }]
    }]
  };
  const result = parseDictionaryPayload(payload, 'tool');
  assert.equal(result.phonetic, '/tul/');
  assert.match(result.meaning, /工具/);
  assert.equal(result.audioUrl, 'https://audio.example/tool-us.mp3');
  assert.equal(result.accent, 'us');
  assert.equal(result.audioAccent, 'us');
  assert.equal(result.confidence, 'verified');
});

test('walks nested arrays without losing the visitor callback', () => {
  const payload = { a: [{ b: [{ pronunciation: { text: '/rɪˈfrɛʃ/', region: 'US' } }] }] };
  assert.doesNotThrow(() => collectCandidates(payload));
  assert.equal(parseDictionaryPayload(payload, 'refresh').phonetic, '/rɪˈfrɛʃ/');
});

test('marks machine-translated meaning for review', async () => {
  const fakeRequest = async ({ url }) => url.includes('freedictionaryapi')
    ? { entries: [{ pronunciations: [{ transcription: '/tul/', tags: ['US'] }] }] }
    : { responseData: { translatedText: '工具' } };
  const result = await lookupWord('tool', fakeRequest);
  assert.equal(result.meaning, '工具');
  assert.equal(result.confidence, 'review');
  assert.match(result.warnings.join(' '), /机器翻译/);
});

test('does not bind UK audio to an American lookup result', () => {
  const payload = {
    pronunciations: [
      { transcription: '/tuːl/', tags: ['UK'], audio: { url: 'https://audio.example/tool-uk.mp3' } },
      { transcription: '/tul/', tags: ['US'] }
    ],
    translations: [{ language: 'zh', text: '工具' }]
  };

  const result = parseDictionaryPayload(payload, 'Tool');

  assert.equal(result.word, 'tool');
  assert.equal(result.phonetic, '/tul/');
  assert.notEqual(result.audioUrl, 'https://audio.example/tool-uk.mp3');
  assert.match(result.audioUrl, /type=2/);
  assert.deepEqual(Object.keys(result), [
    'word', 'phonetic', 'meaning', 'audioUrl', 'accent', 'audioAccent',
    'source', 'confidence', 'warnings'
  ]);
});

test('leaves UK-only phonetics blank instead of presenting them as American', () => {
  const result = parseDictionaryPayload({
    pronunciation: { text: '/tuːl/', region: 'UK', audio: { url: 'https://audio.example/tool-uk.mp3' } }
  }, 'tool');

  assert.equal(result.phonetic, '');
  assert.notEqual(result.audioUrl, 'https://audio.example/tool-uk.mp3');
  assert.match(result.warnings.join(' '), /英式音标/);
});

test('keeps generic IPA but does not use its audio as American', () => {
  const result = parseDictionaryPayload({
    pronunciation: { text: '/tul/', audio: { url: 'https://audio.example/tool-generic.mp3' } },
    translations: [{ language: 'zh-CN', text: '工具' }]
  }, 'tool');

  assert.equal(result.phonetic, '/tul/');
  assert.equal(result.accent, 'generic');
  assert.equal(result.audioAccent, 'us');
  assert.notEqual(result.audioUrl, 'https://audio.example/tool-generic.mp3');
  assert.match(result.audioUrl, /type=2/);
  assert.match(result.warnings.join(' '), /未标注地区.*核对/);
});

test('returns verified dictionary meaning without calling machine translation', async () => {
  const urls = [];
  const fakeRequest = async ({ url }) => {
    urls.push(url);
    return {
      entries: [{
        pronunciations: [{ transcription: '/tul/', tags: ['US'] }],
        translations: [{ language: 'zh-CN', text: '工具' }]
      }]
    };
  };

  const result = await lookupWord(' Tool ', fakeRequest);

  assert.equal(result.confidence, 'verified');
  assert.equal(urls.length, 1);
  assert.match(urls[0], /freedictionaryapi/);
});

test('cached lookup returns a cache hit without calling the provider', async () => {
  const cached = {
    word: 'tool', phonetic: '/tul/', meaning: '工具', source: 'freedictionaryapi',
    confidence: 'verified', accent: 'us', audioAccent: 'us', warnings: []
  };
  const storage = {
    readLookupCache: () => cached,
    writeLookupCache: () => assert.fail('cache hits must not be rewritten')
  };
  const lookup = createCachedLookup(storage, async () => assert.fail('provider must not run'));

  assert.deepEqual(await lookup(' Tool '), cached);
});

test('cached lookup writes a provider result after a cache miss', async () => {
  const writes = [];
  const fresh = {
    word: 'tool', phonetic: '/tul/', meaning: '工具', source: 'freedictionaryapi',
    confidence: 'verified', accent: 'us', audioAccent: 'us', warnings: []
  };
  const storage = {
    readLookupCache: () => null,
    writeLookupCache: (word, result) => writes.push({ word, result })
  };
  const lookup = createCachedLookup(storage, async () => fresh);

  assert.deepEqual(await lookup('tool'), fresh);
  assert.deepEqual(writes, [{ word: 'tool', result: fresh }]);
});

test('cached lookup rejects fake generic US audio and falls back to the provider', async () => {
  const warning = '音标未标注地区，尚未确认是美式音标，请核对';
  const values = {
    'vocab-listening-lookup-cache-v1': {
      version: 1,
      entries: {
        tool: {
          word: 'tool',
          phonetic: '/tul/',
          meaning: '工具',
          audioUrl: 'https://audio.example/unlabelled-candidate.mp3',
          accent: 'generic',
          audioAccent: 'us',
          source: 'freedictionaryapi',
          confidence: 'verified',
          warnings: [warning]
        }
      }
    }
  };
  const storage = createStorage({
    getStorageSync: (key) => values[key],
    setStorageSync: (key, value) => { values[key] = value; }
  });
  let providerCalls = 0;
  const fallback = {
    word: 'tool',
    phonetic: '/tul/',
    meaning: '工具',
    audioUrl: 'https://dict.youdao.com/dictvoice?type=2&audio=tool',
    accent: 'generic',
    audioAccent: 'us',
    source: 'freedictionaryapi',
    confidence: 'verified',
    warnings: [warning]
  };
  const lookup = createCachedLookup(storage, async () => {
    providerCalls += 1;
    return fallback;
  });

  assert.deepEqual(await lookup('tool'), fallback);
  assert.equal(providerCalls, 1);
  assert.equal(
    values['vocab-listening-lookup-cache-v1'].entries.tool.audioUrl,
    fallback.audioUrl
  );
  assert.deepEqual(await lookup('tool'), fallback);
  assert.equal(providerCalls, 1);
});
