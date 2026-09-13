const { createController } = require('./controller');
const {
  blankDraft,
  filterWords,
  pageStateFromController,
  updateDraftField,
  validateEnglishWord
} = require('./page-helpers');
const { createAudioPlayer } = require('../../services/audio');
const { createCachedLookup, lookupWord } = require('../../services/dictionary');
const { createRequestJson } = require('../../services/request');
const { createStorage } = require('../../utils/storage');

const RATE_OPTIONS = [0.6, 0.8, 1, 1.2];

function messageOf(error, fallback) {
  return error && error.message ? error.message : fallback;
}

Page({
  data: {
    activeTab: 'review',
    words: [],
    filteredWords: [],
    wordCount: 0,
    currentWord: null,
    answerVisible: false,
    audioBusy: false,
    audioStatus: '准备好后点击播放',
    playingWordId: null,
    lookupBusy: false,
    lookupStatus: '',
    mode: 'random',
    rate: 1,
    rateOptions: RATE_OPTIONS,
    draft: blankDraft(),
    searchQuery: '',
    backupText: ''
  },

  onLoad() {
    this.storage = createStorage(wx);
    const request = createRequestJson(wx);
    const audio = createAudioPlayer(wx);
    const lookup = createCachedLookup(
      this.storage,
      (word) => lookupWord(word, request)
    );
    this.controller = createController({
      storage: this.storage,
      lookup,
      audio,
      onChange: (state) => this.applyControllerState(state)
    });
    this.controller.initialize();
  },

  onUnload() {
    if (this.controller) this.controller.destroy();
  },

  applyControllerState(state) {
    const patch = pageStateFromController(state);
    patch.filteredWords = filterWords(patch.words, this.data.searchQuery);
    this.setData(patch);
  },

  switchTab(event) {
    const tab = event.currentTarget.dataset.tab;
    if (tab === 'review' || tab === 'library') this.setData({ activeTab: tab });
  },

  onDraftInput(event) {
    const field = event.currentTarget.dataset.field;
    const draft = updateDraftField(this.data.draft, field, event.detail.value);
    if (draft !== this.data.draft) this.setData({ draft });
  },

  onSearchInput(event) {
    const searchQuery = event.detail.value;
    this.setData({
      searchQuery,
      filteredWords: filterWords(this.data.words, searchQuery)
    });
  },

  onBackupInput(event) {
    this.setData({ backupText: event.detail.value });
  },

  async onLookup() {
    const word = String(this.data.draft.word || '').trim();
    const validationMessage = validateEnglishWord(word);
    if (validationMessage) {
      wx.showToast({ title: validationMessage, icon: 'none' });
      return;
    }
    await this.controller.lookupDraft(word, this.data.draft);
  },

  onSave() {
    try {
      const validationMessage = validateEnglishWord(this.data.draft.word);
      if (validationMessage) throw new Error(validationMessage);
      const saved = this.controller.saveDraft(this.data.draft);
      this.setData({ draft: { ...saved, warnings: saved.warnings || [] } });
      wx.showToast({ title: '已保存到词库', icon: 'success' });
    } catch (error) {
      wx.showToast({ title: messageOf(error, '保存失败，请重试'), icon: 'none' });
    }
  },

  onEdit(event) {
    const id = event.currentTarget.dataset.id;
    const word = this.data.words.find((item) => item.id === id);
    if (!word) return;
    this.setData({
      activeTab: 'library',
      draft: { ...word, warnings: word.warnings || [] },
      lookupStatus: '正在编辑词库中的单词。'
    });
  },

  onDelete(event) {
    const id = event.currentTarget.dataset.id;
    const word = this.data.words.find((item) => item.id === id);
    if (!word) return;
    wx.showModal({
      title: '删除单词',
      content: `确定删除 ${word.word} 吗？`,
      confirmColor: '#b42318',
      success: (result) => {
        if (!result.confirm) return;
        const deleted = this.controller.deleteWord(id);
        if (deleted && this.data.draft.id === id) this.setData({ draft: blankDraft() });
        if (deleted) wx.showToast({ title: '已删除', icon: 'success' });
      }
    });
  },

  async onPlay() {
    try {
      await this.controller.playCurrent();
    } catch (error) {
      if (error && error.code === 'PLAYBACK_CANCELLED') return;
      wx.showToast({ title: messageOf(error, '播放失败，请重试'), icon: 'none' });
    }
  },

  async onPlayWord(event) {
    try {
      await this.controller.playWord(event.currentTarget.dataset.id);
    } catch (error) {
      if (error && error.code === 'PLAYBACK_CANCELLED') return;
      wx.showToast({ title: messageOf(error, '播放失败，请重试'), icon: 'none' });
    }
  },

  onReveal() {
    this.controller.revealAnswer();
  },

  onNext() {
    this.controller.moveNext();
  },

  onModeChange(event) {
    const mode = event.currentTarget.dataset.mode;
    if (mode === 'random' || mode === 'sequential') this.controller.updateSettings({ mode });
  },

  onRateChange(event) {
    const rate = Number(event.currentTarget.dataset.rate);
    if (RATE_OPTIONS.includes(rate)) this.controller.updateSettings({ rate });
  },

  onCopyBackup() {
    const data = this.storage.exportBackup();
    wx.setClipboardData({
      data,
      success: () => wx.showToast({ title: '备份已复制', icon: 'success' }),
      fail: () => wx.showToast({ title: '复制失败，请重试', icon: 'none' })
    });
  },

  onImportBackup() {
    try {
      const words = this.storage.importBackup(this.data.backupText);
      this.controller.initialize();
      this.setData({ backupText: '' });
      wx.showToast({ title: `词库现有 ${words.length} 个单词`, icon: 'success' });
    } catch (error) {
      wx.showToast({ title: messageOf(error, '导入失败，请检查备份'), icon: 'none' });
    }
  },

  onClearAll() {
    if (!this.data.words.length) {
      wx.showToast({ title: '词库已经是空的', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '清空全部单词',
      content: '此操作无法撤销，建议先复制备份。确定继续吗？',
      confirmText: '清空',
      confirmColor: '#b42318',
      success: (result) => {
        if (!result.confirm) return;
        const ids = this.data.words.map((word) => word.id);
        ids.forEach((id) => this.controller.deleteWord(id));
        this.setData({ draft: blankDraft(), searchQuery: '', filteredWords: [] });
        wx.showToast({ title: '词库已清空', icon: 'success' });
      }
    });
  }
});
