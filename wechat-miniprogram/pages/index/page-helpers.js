const DRAFT_FIELDS = new Set(['word', 'phonetic', 'meaning', 'audioUrl']);

function validateEnglishWord(value) {
  const word = String(value || '').trim();
  if (!word) return '请输入有效单词（仅限英语）';
  if (/[^A-Za-z'-]/.test(word)) return '只支持英文字母，以及单词内部的连字符或撇号';
  if (!/^[A-Za-z]+(?:[-'][A-Za-z]+)*$/.test(word)) {
    return '连字符或撇号只能出现在字母之间';
  }
  return '';
}

function blankDraft() {
  return {
    word: '',
    phonetic: '',
    meaning: '',
    audioUrl: '',
    source: 'manual',
    confidence: 'manual',
    warnings: []
  };
}

function copyDraft(draft) {
  return {
    ...draft,
    warnings: Array.isArray(draft.warnings) ? [...draft.warnings] : []
  };
}

function pageStateFromController(state) {
  const settings = state.settings || {};
  const patch = {
    words: Array.isArray(state.words) ? state.words.map((word) => ({ ...word })) : [],
    wordCount: Array.isArray(state.words) ? state.words.length : 0,
    currentWord: state.currentWord ? { ...state.currentWord } : null,
    answerVisible: Boolean(state.answerVisible),
    lookupBusy: Boolean(state.lookupBusy),
    lookupStatus: state.lookupStatus || '',
    audioBusy: Boolean(state.audioBusy),
    audioStatus: state.audioStatus || (state.audioBusy ? '正在播放美音...' : '准备好后点击播放'),
    playingWordId: state.playingWordId || null,
    mode: settings.mode === 'sequential' ? 'sequential' : 'random',
    rate: Number(settings.rate) || 1
  };

  if (state.draft) patch.draft = copyDraft(state.draft);
  return patch;
}

function updateDraftField(draft, field, value) {
  if (!DRAFT_FIELDS.has(field)) return draft;
  return { ...draft, [field]: value };
}

function filterWords(words, query) {
  const needle = String(query || '').trim().toLocaleLowerCase();
  const copy = Array.isArray(words) ? words.slice() : [];
  if (!needle) return copy;

  return copy.filter((word) => [word.word, word.phonetic, word.meaning]
    .some((value) => String(value || '').toLocaleLowerCase().includes(needle)));
}

module.exports = {
  blankDraft,
  filterWords,
  pageStateFromController,
  updateDraftField,
  validateEnglishWord
};
