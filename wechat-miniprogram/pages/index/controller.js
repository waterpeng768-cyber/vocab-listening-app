const { nextReviewIndex } = require('../../utils/review');

const LOOKUP_MESSAGES = {
  DOMAIN_NOT_ALLOWED: '微信尚未允许访问词典域名，请先配置合法域名；你也可以手动填写。',
  NETWORK_TIMEOUT: '查询超时，请检查网络后重试；你也可以手动填写。',
  NOT_FOUND: '没有查到这个单词，请检查拼写或手动填写。'
};

function initialState() {
  return {
    words: [],
    settings: { mode: 'random', rate: 1 },
    currentIndex: -1,
    currentWord: null,
    answerVisible: false,
    draft: null,
    lookupBusy: false,
    lookupStatus: '',
    audioBusy: false
  };
}

function copyRecord(value) {
  if (!value) return null;
  const copy = { ...value };
  if (Array.isArray(value.warnings)) copy.warnings = [...value.warnings];
  return copy;
}

function createController({
  storage,
  lookup,
  audio,
  randomFn = Math.random,
  onChange = () => {}
}) {
  let state = initialState();

  function snapshot() {
    return {
      ...state,
      words: state.words.map(copyRecord),
      settings: { ...state.settings },
      currentWord: copyRecord(state.currentWord),
      draft: copyRecord(state.draft)
    };
  }

  function publish(patch) {
    state = { ...state, ...patch };
    onChange(snapshot());
  }

  function persistedStatePatch(preferredWordId, fallbackIndex = state.currentIndex) {
    const loaded = storage.loadState();
    const words = loaded.words.map(copyRecord);
    let currentIndex = preferredWordId
      ? words.findIndex((word) => word.id === preferredWordId)
      : -1;
    if (currentIndex === -1 && words.length) {
      currentIndex = Math.min(Math.max(fallbackIndex, 0), words.length - 1);
    }
    return {
      words,
      settings: { ...loaded.settings },
      currentIndex,
      currentWord: currentIndex === -1 ? null : words[currentIndex]
    };
  }

  function initialize() {
    const loaded = storage.loadState();
    const words = loaded.words.map(copyRecord);
    publish({
      words,
      settings: { ...loaded.settings },
      currentIndex: words.length ? 0 : -1,
      currentWord: words.length ? words[0] : null,
      answerVisible: false
    });
    return snapshot();
  }

  async function lookupDraft(word) {
    publish({ lookupBusy: true, lookupStatus: '正在查询...' });
    try {
      const result = await lookup(word);
      publish({
        draft: copyRecord(result),
        lookupBusy: false,
        lookupStatus: result.confidence === 'verified'
          ? '已找到，请核对后保存。'
          : '结果需要核对后再保存。'
      });
      return result;
    } catch (error) {
      const code = error && error.code;
      publish({
        lookupBusy: false,
        lookupStatus: LOOKUP_MESSAGES[code] || '查询失败，请重试或手动填写。'
      });
      return null;
    }
  }

  function saveDraft(draft) {
    if (!draft || !String(draft.word || '').trim()) throw new Error('请输入有效单词');

    const saved = storage.saveWord(draft);
    publish({
      ...persistedStatePatch(state.currentWord && state.currentWord.id),
      draft: copyRecord(saved),
      lookupStatus: '已保存。'
    });
    return saved;
  }

  function deleteWord(id) {
    const currentWordId = state.currentWord && state.currentWord.id;
    const deleted = storage.deleteWord(id);
    publish({
      ...persistedStatePatch(currentWordId === id ? null : currentWordId),
      answerVisible: false
    });
    return deleted;
  }

  function updateSettings(patch) {
    storage.saveSettings(patch);
    publish(persistedStatePatch(state.currentWord && state.currentWord.id));
    return { ...state.settings };
  }

  function revealAnswer() {
    publish({ answerVisible: true });
  }

  function moveNext() {
    const mode = state.settings.mode === 'sequential' ? 'ordered' : state.settings.mode;
    const currentIndex = nextReviewIndex(state.words, state.currentIndex, mode, randomFn);
    publish({
      currentIndex,
      currentWord: currentIndex === -1 ? null : state.words[currentIndex],
      answerVisible: false
    });
    return state.currentWord;
  }

  async function playCurrent() {
    if (!state.currentWord) throw new Error('当前没有可播放的单词');

    publish({ audioBusy: true });
    try {
      await audio.play(state.currentWord.audioUrl, state.settings.rate);
    } finally {
      publish({ audioBusy: false });
    }
  }

  function destroy() {
    audio.destroy();
    publish({ audioBusy: false });
  }

  return {
    initialize,
    lookupDraft,
    saveDraft,
    deleteWord,
    updateSettings,
    revealAnswer,
    moveNext,
    playCurrent,
    destroy,
    getState: snapshot
  };
}

module.exports = { createController };
