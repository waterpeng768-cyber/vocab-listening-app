const { nextReviewIndex } = require('../../utils/review');
const { validateEnglishWord } = require('./page-helpers');

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
    audioBusy: false,
    audioStatus: '准备好后点击播放',
    playingWordId: null
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
  let playbackVersion = 0;

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

  async function lookupDraft(word, editingDraft = state.draft) {
    const validationMessage = validateEnglishWord(word);
    if (validationMessage) throw new Error(validationMessage);
    publish({ lookupBusy: true, lookupStatus: '正在查询...' });
    try {
      const result = await lookup(word);
      const identity = editingDraft && editingDraft.id
        ? { id: editingDraft.id, createdAt: editingDraft.createdAt }
        : {};
      const draft = { ...result, ...identity };
      publish({
        draft: copyRecord(draft),
        lookupBusy: false,
        lookupStatus: result.confidence === 'verified'
          ? '已找到，请核对后保存。'
          : '结果需要核对后再保存。'
      });
      return draft;
    } catch (error) {
      const code = error && error.code;
      publish({
        draft: copyRecord(editingDraft),
        lookupBusy: false,
        lookupStatus: LOOKUP_MESSAGES[code] || '查询失败，请重试或手动填写。'
      });
      return null;
    }
  }

  function saveDraft(draft) {
    const validationMessage = validateEnglishWord(draft && draft.word);
    if (validationMessage) throw new Error(validationMessage);

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
    playbackVersion += 1;
    audio.stop();
    const mode = state.settings.mode === 'sequential' ? 'ordered' : state.settings.mode;
    const currentIndex = nextReviewIndex(state.words, state.currentIndex, mode, randomFn);
    publish({
      currentIndex,
      currentWord: currentIndex === -1 ? null : state.words[currentIndex],
      answerVisible: false,
      audioBusy: false,
      audioStatus: '准备好后点击播放',
      playingWordId: null
    });
    return state.currentWord;
  }

  async function playWord(id) {
    const word = state.words.find((item) => item.id === id);
    if (!word) throw new Error('没有找到要播放的单词');
    const version = ++playbackVersion;

    publish({
      audioBusy: true,
      audioStatus: '正在播放美音...',
      playingWordId: word.id
    });
    try {
      await audio.play(word.audioUrl, state.settings.rate);
      if (version === playbackVersion) {
        publish({ audioBusy: false, audioStatus: '播放完成', playingWordId: null });
      }
    } catch (error) {
      if (version === playbackVersion) {
        const message = error && error.message ? error.message : '美音播放失败';
        publish({
          audioBusy: false,
          audioStatus: /重试/.test(message) ? message : `${message}，请重试`,
          playingWordId: null
        });
      }
      throw error;
    }
  }

  function playCurrent() {
    if (!state.currentWord) return Promise.reject(new Error('当前没有可播放的单词'));
    return playWord(state.currentWord.id);
  }

  function destroy() {
    playbackVersion += 1;
    audio.destroy();
    publish({ audioBusy: false, playingWordId: null });
  }

  return {
    initialize,
    lookupDraft,
    saveDraft,
    deleteWord,
    updateSettings,
    revealAnswer,
    moveNext,
    playWord,
    playCurrent,
    destroy,
    getState: snapshot
  };
}

module.exports = { createController };
