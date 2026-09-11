const test = require('node:test');
const assert = require('node:assert/strict');
const { collectCandidates, parseDictionaryPayload, lookupWord } = require('../services/dictionary');

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
    'word', 'phonetic', 'meaning', 'audioUrl', 'source', 'confidence', 'warnings'
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
