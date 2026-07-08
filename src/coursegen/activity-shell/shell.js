(function () {
  'use strict';
  var SHELL_VERSION = '1';
  var PHONE_BREAKPOINT = 480;
  var stageRegistry = null;
  var stageError = null;
  var bootStarted = false;
  function getViewport() {
    return window.innerWidth <= PHONE_BREAKPOINT ? 'phone' : 'desktop';
  }
  function parseConfig() {
    var cfg = window.__ACTIVITY_CONFIG__;
    if (!cfg || !Array.isArray(cfg.activities) || cfg.activities.length === 0) {
      throw new Error('Activity shell: missing or invalid __ACTIVITY_CONFIG__');
    }
    return cfg;
  }
  function updateQa(state) {
    var activity = getActiveActivity(state);
    window.__SHELL_QA__ = {
      version: SHELL_VERSION,
      activityIds: state.config.activities.map(function (a) { return a.id; }),
      currentActivityId: state.activeActivityId,
      currentActivityMode: activity ? activity.mode : undefined,
      itemCount: state.items.length,
      currentIndex: state.currentIndex,
      correctCount: state.correctCount,
      completed: state.allComplete,
      hintsUsed: state.hintsUsedTotal,
      retries: state.retries,
      atEndSummary: state.atEndSummary
    };
  }
  function showStageError(message) {
    var stage = document.getElementById('activity-stage');
    if (!stage) return;
    stage.innerHTML = '<div class="shell-error" role="alert">' + escapeHtml(message) + '</div>';
  }
  function failShell(message) {
    if (stageError) return;
    stageError = message;
    showStageError(message);
    var err = new Error(message);
    console.error(err);
    setTimeout(function () {
      throw err;
    }, 0);
  }
  function wrapStageCall(fn, label) {
    return function () {
      try {
        return fn.apply(null, arguments);
      } catch (e) {
        var msg = label + ': ' + (e && e.message ? e.message : String(e));
        failShell(msg);
        return undefined;
      }
    };
  }
  function buildShellDom(config) {
    var app = document.getElementById('app');
    if (!app) {
      throw new Error('Activity shell: #app not found');
    }
    var header = document.createElement('header');
    header.id = 'activity-header';
    var title = document.createElement('h1');
    title.textContent = config.title || 'Practice';
    header.appendChild(title);
    var progress = document.createElement('span');
    progress.className = 'shell-progress';
    progress.id = 'shell-progress';
    header.appendChild(progress);
    if (config.activities.length > 1) {
      var tabs = document.createElement('div');
      tabs.className = 'shell-tabs';
      tabs.id = 'shell-tabs';
      config.activities.forEach(function (activity, i) {
        var tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'shell-tab';
        tab.setAttribute('data-activity-tab', activity.id);
        tab.setAttribute('data-mode', activity.mode);
        var label = activity.mode === 'learn' ? 'Explore' : activity.title;
        tab.textContent = 'Activity ' + (i + 1) + ' of ' + config.activities.length + ': ' + label;
        tabs.appendChild(tab);
      });
      header.appendChild(tabs);
    }
    var score = document.createElement('span');
    score.className = 'shell-score';
    score.id = 'shell-score';
    score.hidden = true;
    header.appendChild(score);
    var instructions = document.createElement('section');
    instructions.id = 'activity-instructions';
    var stage = document.createElement('section');
    stage.id = 'activity-stage';
    var stageInner = document.createElement('div');
    stageInner.className = 'shell-stage-inner';
    stageInner.id = 'shell-stage-inner';
    stage.appendChild(stageInner);
    var controls = document.createElement('section');
    controls.id = 'activity-controls';
    var checkBtn = document.createElement('button');
    checkBtn.type = 'button';
    checkBtn.className = 'shell-btn';
    checkBtn.id = 'shell-check-btn';
    checkBtn.textContent = 'Check answer';
    checkBtn.disabled = true;
    var nextBtn = document.createElement('button');
    nextBtn.type = 'button';
    nextBtn.className = 'shell-btn';
    nextBtn.id = 'shell-next-btn';
    nextBtn.textContent = 'Next';
    nextBtn.hidden = true;
    var tryAgainBtn = document.createElement('button');
    tryAgainBtn.type = 'button';
    tryAgainBtn.className = 'shell-btn';
    tryAgainBtn.id = 'shell-try-again-btn';
    tryAgainBtn.textContent = 'Try again';
    tryAgainBtn.hidden = true;
    var markDoneBtn = document.createElement('button');
    markDoneBtn.type = 'button';
    markDoneBtn.className = 'shell-btn';
    markDoneBtn.id = 'shell-mark-done-btn';
    markDoneBtn.textContent = 'Mark as done';
    markDoneBtn.hidden = true;
    var summary = document.createElement('div');
    summary.id = 'shell-summary';
    summary.className = 'shell-summary';
    summary.hidden = true;
    var feedback = document.createElement('div');
    feedback.id = 'shell-feedback-banner';
    feedback.setAttribute('role', 'status');
    controls.appendChild(checkBtn);
    controls.appendChild(nextBtn);
    controls.appendChild(tryAgainBtn);
    controls.appendChild(markDoneBtn);
    controls.appendChild(summary);
    controls.appendChild(feedback);
    app.appendChild(header);
    app.appendChild(instructions);
    app.appendChild(stage);
    app.appendChild(controls);
  }
  function createInitialState(config) {
    return {
      config: config,
      activeActivityId: config.activities[0].id,
      activityIndex: 0,
      items: [],
      currentIndex: 0,
      response: null,
      hasResponse: false,
      checked: false,
      lastResult: null,
      correctCount: 0,
      score: 0,
      hintsUsed: 0,
      retries: 0,
      activityProgress: {},
      itemResults: {},
      allComplete: false,
      hintsUsedTotal: 0,
      effectiveSuccessTarget: 1,
      atEndSummary: false,
      lastViewport: getViewport()
    };
  }
  function getActiveActivity(state) {
    return state.config.activities[state.activityIndex];
  }
  function getStageDef(state) {
    if (!stageRegistry || !stageRegistry.activities) return null;
    return stageRegistry.activities[state.activeActivityId] || null;
  }
  function usesActivityProgressStore(state) {
    return state.config.activities.length > 1;
  }
  function getActivityProgress(state, activityId) {
    if (!state.activityProgress[activityId]) {
      state.activityProgress[activityId] = {
        correctCount: 0,
        score: 0,
        itemIndex: 0,
        completed: false,
        hintsUsed: 0,
        itemResults: {},
        atEndSummary: false
      };
    }
    return state.activityProgress[activityId];
  }
  function saveItemResult(state, index) {
    if (!state.itemResults) state.itemResults = {};
    if (state.checked) {
      state.itemResults[index] = {
        response: state.response,
        checked: true,
        lastResult: state.lastResult
      };
    }
  }
  function applyItemResult(state, index) {
    var saved = state.itemResults && state.itemResults[index];
    if (saved && saved.checked) {
      state.response = saved.response;
      state.hasResponse = saved.response != null && saved.response !== undefined;
      state.checked = true;
      state.lastResult = saved.lastResult;
      return;
    }
    state.response = null;
    state.hasResponse = false;
    state.checked = false;
    state.lastResult = null;
  }
  function saveCurrentActivityProgress(state) {
    if (!usesActivityProgressStore(state)) return;
    var progress = getActivityProgress(state, state.activeActivityId);
    progress.correctCount = state.correctCount;
    progress.score = state.score;
    progress.itemIndex = state.currentIndex;
    progress.hintsUsed = state.hintsUsed;
    progress.itemResults = state.itemResults || {};
    progress.atEndSummary = state.atEndSummary;
  }
  function restoreActivityProgress(state, activityId) {
    if (!usesActivityProgressStore(state)) {
      return 0;
    }
    var progress = getActivityProgress(state, activityId);
    state.correctCount = progress.correctCount;
    state.score = progress.score;
    state.hintsUsed = progress.hintsUsed;
    state.itemResults = progress.itemResults || {};
    state.atEndSummary = Boolean(progress.atEndSummary);
    return progress.itemIndex;
  }
  function loadItems(state, restoreIndex) {
    var def = getStageDef(state);
    if (!def || typeof def.createItems !== 'function') {
      failShell('Stage module missing createItems for activity "' + state.activeActivityId + '"');
      return;
    }
    var ctx = makeCtx(state);
    var rawItems = wrapStageCall(def.createItems, 'createItems')(ctx);
    if (!Array.isArray(rawItems)) {
      failShell('createItems must return an array for activity "' + state.activeActivityId + '"');
      return;
    }
    state.items = rawItems;
    var activity = getActiveActivity(state);
    state.effectiveSuccessTarget = Math.min(
      activity.successTarget,
      Math.max(1, state.items.length)
    );
    state.currentIndex = typeof restoreIndex === 'number'
      ? Math.min(Math.max(0, restoreIndex), Math.max(0, state.items.length - 1))
      : 0;
    if (!state.atEndSummary) {
      applyItemResult(state, state.currentIndex);
    }
  }
  function makeCtx(state) {
    var activity = getActiveActivity(state);
    return {
      viewport: getViewport(),
      activity: activity,
      index: state.currentIndex,
      total: state.items.length,
      setResponse: function (value) {
        if (state.checked) return;
        state.response = value;
        state.hasResponse = true;
        var checkBtn = document.getElementById('shell-check-btn');
        if (checkBtn && activity.mode !== 'learn') {
          checkBtn.disabled = false;
        }
      },
      getResponse: function () {
        return state.response;
      },
      requestCheck: function () {
        if (activity.mode !== 'learn') {
          runCheck(state);
        }
      },
      reportHint: function () {
        state.hintsUsed += 1;
        state.hintsUsedTotal += 1;
        updateQa(state);
      }
    };
  }
  function cleanupCurrentItem(state) {
    var def = getStageDef(state);
    if (!def || typeof def.cleanupItem !== 'function') return;
    var mount = document.getElementById('shell-stage-inner');
    var item = state.items[state.currentIndex];
    if (mount && item) {
      wrapStageCall(def.cleanupItem, 'cleanupItem')(makeCtx(state), item, mount);
    }
  }
  function renderCurrentItem(state) {
    var def = getStageDef(state);
    var mount = document.getElementById('shell-stage-inner');
    if (!mount) return;
    mount.innerHTML = '';
    if (!def || typeof def.renderItem !== 'function') {
      showStageError('Stage module missing renderItem for activity "' + state.activeActivityId + '"');
      return;
    }
    var item = state.items[state.currentIndex];
    if (!item) {
      mount.innerHTML = '<p class="shell-error">No items for this activity.</p>';
      return;
    }
    wrapStageCall(def.renderItem, 'renderItem')(makeCtx(state), item, mount);
  }
  function renderInstructions(state) {
    var el = document.getElementById('activity-instructions');
    var activity = getActiveActivity(state);
    if (!el || !activity) return;
    el.innerHTML =
      '<p class="shell-how-to">How to play: ' + escapeHtml(activity.instructions) + '</p>' +
      '<p class="shell-success">Goal: ' + escapeHtml(activity.successCriterion) + '</p>';
  }
  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function updateProgress(state) {
    var el = document.getElementById('shell-progress');
    if (!el) return;
    var total = state.items.length;
    var current = total > 0 ? state.currentIndex + 1 : 0;
    el.textContent = current + ' of ' + total;
  }
  function updateScore(state) {
    var el = document.getElementById('shell-score');
    var activity = getActiveActivity(state);
    if (!el) return;
    if (activity.mode === 'challenge') {
      el.hidden = false;
      var scale = activity.scoreScale || state.effectiveSuccessTarget;
      el.textContent = 'Score: ' + state.score + ' / ' + scale;
    } else {
      el.hidden = true;
    }
  }
  function updateTabs(state) {
    var tabs = document.querySelectorAll('[data-activity-tab]');
    tabs.forEach(function (tab) {
      var id = tab.getAttribute('data-activity-tab');
      tab.setAttribute('data-active', id === state.activeActivityId ? 'true' : 'false');
    });
  }
  function summaryMessage(state) {
    var activity = getActiveActivity(state);
    if (activity.mode === 'challenge') {
      var scale = activity.scoreScale || state.effectiveSuccessTarget;
      return 'Score: ' + state.score + ' / ' + scale;
    }
    if (activity.mode === 'practice') {
      return 'Correct: ' + state.correctCount + ' / ' + state.effectiveSuccessTarget;
    }
    return 'Activity complete.';
  }
  function updateSummary(state) {
    var summary = document.getElementById('shell-summary');
    if (!summary) return;
    if (!state.atEndSummary) {
      summary.hidden = true;
      summary.textContent = '';
      return;
    }
    summary.hidden = false;
    var met = isActivitySuccess(state);
    summary.textContent = summaryMessage(state) + (met ? ' — goal reached.' : ' — goal not reached yet.');
  }
  function updateControls(state) {
    var activity = getActiveActivity(state);
    var checkBtn = document.getElementById('shell-check-btn');
    var nextBtn = document.getElementById('shell-next-btn');
    var tryAgainBtn = document.getElementById('shell-try-again-btn');
    var markDoneBtn = document.getElementById('shell-mark-done-btn');
    var feedback = document.getElementById('shell-feedback-banner');
    updateSummary(state);
    if (state.atEndSummary) {
      if (checkBtn) checkBtn.hidden = true;
      if (markDoneBtn) markDoneBtn.hidden = true;
      if (feedback) feedback.setAttribute('data-visible', 'false');
      if (isActivitySuccess(state)) {
        if (tryAgainBtn) tryAgainBtn.hidden = true;
        if (nextBtn) {
          nextBtn.hidden = false;
          nextBtn.textContent = 'Continue';
        }
      } else {
        if (nextBtn) nextBtn.hidden = true;
        if (tryAgainBtn) {
          tryAgainBtn.hidden = false;
          tryAgainBtn.textContent = 'Try again';
        }
      }
      return;
    }
    if (activity.mode === 'learn') {
      if (checkBtn) checkBtn.hidden = true;
      if (markDoneBtn) markDoneBtn.hidden = false;
      if (nextBtn) nextBtn.hidden = true;
      if (tryAgainBtn) tryAgainBtn.hidden = true;
      if (feedback) feedback.setAttribute('data-visible', 'false');
      return;
    }
    if (markDoneBtn) markDoneBtn.hidden = true;
    if (checkBtn) {
      checkBtn.hidden = false;
      checkBtn.disabled = !state.hasResponse || state.checked;
      checkBtn.textContent = activity.mode === 'challenge' ? 'Check challenge' : 'Check answer';
    }
    if (state.checked && state.lastResult) {
      if (state.lastResult.correct) {
        if (tryAgainBtn) tryAgainBtn.hidden = true;
        if (nextBtn) {
          var onLastItem = state.currentIndex >= state.items.length - 1;
          nextBtn.hidden = onLastItem;
          nextBtn.textContent = 'Next';
        }
      } else {
        if (tryAgainBtn) tryAgainBtn.hidden = false;
        if (nextBtn) nextBtn.hidden = true;
      }
    } else {
      if (nextBtn) nextBtn.hidden = true;
      if (tryAgainBtn) tryAgainBtn.hidden = true;
    }
    if (feedback) {
      if (state.checked && state.lastResult) {
        feedback.setAttribute('data-visible', 'true');
        feedback.setAttribute('data-correct', state.lastResult.correct ? 'true' : 'false');
        var text = state.lastResult.correct ? 'Correct!' : 'Not quite.';
        if (state.lastResult.explanation) {
          text += ' ' + state.lastResult.explanation;
        }
        feedback.textContent = text;
      } else {
        feedback.setAttribute('data-visible', 'false');
        feedback.textContent = '';
      }
    }
  }
  function isActivitySuccess(state) {
    var activity = getActiveActivity(state);
    if (activity.mode === 'learn') {
      return getActivityProgress(state, activity.id).completed;
    }
    if (activity.mode === 'practice') {
      return state.correctCount >= state.effectiveSuccessTarget;
    }
    if (activity.mode === 'challenge') {
      return state.score >= state.effectiveSuccessTarget;
    }
    return false;
  }
  function checkAllActivitiesComplete(state) {
    return state.config.activities.every(function (a) {
      return getActivityProgress(state, a.id).completed;
    });
  }
  function markActivityComplete(state, activityId) {
    getActivityProgress(state, activityId).completed = true;
  }
  function fireCompletion(state) {
    if (state.allComplete) return;
    if (!checkAllActivitiesComplete(state)) return;
    state.allComplete = true;
    document.documentElement.dataset.activityComplete = 'true';
    updateQa(state);
    var targetOrigin = window.location.protocol === 'file:' ? '*' : window.location.origin;
    try {
      window.parent.postMessage({
        type: 'mylecture:activity-complete',
        correct: true,
        hintsUsed: state.hintsUsedTotal,
        retries: state.retries
      }, targetOrigin);
    } catch (e) {
      console.warn('postMessage failed', e);
    }
  }
  function runCheck(state) {
    var activity = getActiveActivity(state);
    if (activity.mode === 'learn') return;
    if (state.checked) return;
    var def = getStageDef(state);
    if (!def || typeof def.checkAnswer !== 'function') {
      failShell('Stage module missing checkAnswer for activity "' + state.activeActivityId + '"');
      return;
    }
    var item = state.items[state.currentIndex];
    var result = wrapStageCall(def.checkAnswer, 'checkAnswer')(makeCtx(state), item) || { correct: false };
    state.checked = true;
    state.lastResult = result;
    if (result.correct) {
      state.correctCount += 1;
      if (typeof result.scoreDelta === 'number' && activity.mode === 'challenge') {
        state.score += result.scoreDelta;
      } else if (activity.mode === 'challenge') {
        state.score += 10;
      }
    } else {
      state.retries += 1;
    }
    if (activity.mode === 'practice' && state.correctCount >= state.effectiveSuccessTarget) {
      markActivityComplete(state, activity.id);
    }
    if (activity.mode === 'challenge' && state.score >= state.effectiveSuccessTarget) {
      markActivityComplete(state, activity.id);
    }
    if (state.currentIndex >= state.items.length - 1) {
      state.atEndSummary = true;
    }
    saveItemResult(state, state.currentIndex);
    saveCurrentActivityProgress(state);
    updateScore(state);
    updateControls(state);
    updateQa(state);
  }
  function finishActivityOrAdvance(state) {
    var activity = getActiveActivity(state);
    if (isActivitySuccess(state)) {
      markActivityComplete(state, activity.id);
    }
    saveCurrentActivityProgress(state);
    state.atEndSummary = false;
    var nextIdx = state.activityIndex + 1;
    if (nextIdx < state.config.activities.length) {
      switchActivity(state, nextIdx);
    } else {
      fireCompletion(state);
    }
  }
  function goNext(state) {
    if (state.atEndSummary) {
      finishActivityOrAdvance(state);
      return;
    }
    cleanupCurrentItem(state);
    if (state.currentIndex < state.items.length - 1) {
      saveItemResult(state, state.currentIndex);
      state.currentIndex += 1;
      state.atEndSummary = false;
      applyItemResult(state, state.currentIndex);
      renderCurrentItem(state);
      updateProgress(state);
      updateControls(state);
      saveCurrentActivityProgress(state);
      updateQa(state);
      return;
    }
  }
  function tryAgain(state) {
    if (state.atEndSummary) {
      resetCurrentActivity(state);
      return;
    }
    state.retries += 1;
    if (state.itemResults) delete state.itemResults[state.currentIndex];
    state.response = null;
    state.hasResponse = false;
    state.checked = false;
    state.lastResult = null;
    renderCurrentItem(state);
    updateControls(state);
    updateQa(state);
  }
  function resetCurrentActivity(state) {
    state.retries += 1;
    cleanupCurrentItem(state);
    var activityId = state.activeActivityId;
    state.activityProgress[activityId] = {
      correctCount: 0,
      score: 0,
      itemIndex: 0,
      completed: false,
      hintsUsed: 0,
      itemResults: {},
      atEndSummary: false
    };
    state.correctCount = 0;
    state.score = 0;
    state.hintsUsed = 0;
    state.itemResults = {};
    state.atEndSummary = false;
    loadItems(state);
    renderCurrentItem(state);
    updateProgress(state);
    updateScore(state);
    updateControls(state);
    updateQa(state);
  }
  function switchActivity(state, index) {
    if (state.checked) saveItemResult(state, state.currentIndex);
    saveCurrentActivityProgress(state);
    cleanupCurrentItem(state);
    state.activityIndex = index;
    state.activeActivityId = state.config.activities[index].id;
    state.response = null;
    state.hasResponse = false;
    state.checked = false;
    state.lastResult = null;
    var savedIndex = restoreActivityProgress(state, state.activeActivityId);
    loadItems(state, savedIndex);
    renderInstructions(state);
    renderCurrentItem(state);
    updateTabs(state);
    updateProgress(state);
    updateScore(state);
    updateControls(state);
    updateQa(state);
  }
  function markLearnDone(state) {
    var activity = getActiveActivity(state);
    markActivityComplete(state, activity.id);
    saveCurrentActivityProgress(state);
    updateQa(state);
    var nextIdx = state.activityIndex + 1;
    if (nextIdx < state.config.activities.length) {
      switchActivity(state, nextIdx);
    } else {
      fireCompletion(state);
    }
  }
  function bindControls(state) {
    var checkBtn = document.getElementById('shell-check-btn');
    var nextBtn = document.getElementById('shell-next-btn');
    var tryAgainBtn = document.getElementById('shell-try-again-btn');
    var markDoneBtn = document.getElementById('shell-mark-done-btn');
    if (checkBtn) {
      checkBtn.addEventListener('click', function () { runCheck(state); });
    }
    if (nextBtn) {
      nextBtn.addEventListener('click', function () { goNext(state); });
    }
    if (tryAgainBtn) {
      tryAgainBtn.addEventListener('click', function () { tryAgain(state); });
    }
    if (markDoneBtn) {
      markDoneBtn.addEventListener('click', function () { markLearnDone(state); });
    }
    document.querySelectorAll('[data-activity-tab]').forEach(function (tab) {
      tab.addEventListener('click', function () {
        var id = tab.getAttribute('data-activity-tab');
        var idx = state.config.activities.findIndex(function (a) { return a.id === id; });
        if (idx >= 0 && idx !== state.activityIndex) {
          switchActivity(state, idx);
        }
      });
    });
    window.addEventListener('resize', function () {
      var vp = getViewport();
      if (vp !== state.lastViewport) {
        state.lastViewport = vp;
        cleanupCurrentItem(state);
        renderCurrentItem(state);
      }
    });
  }
  function validateRegistry(config) {
    if (!stageRegistry || !stageRegistry.activities) {
      failShell('Stage module never called registerStage()');
      return;
    }
    var missing = config.activities.filter(function (a) {
      return !stageRegistry.activities[a.id];
    });
    if (missing.length > 0) {
      failShell('Stage module missing activities: ' + missing.map(function (a) { return a.id; }).join(', '));
    }
  }
  function boot() {
    if (bootStarted) return;
    bootStarted = true;
    var config = parseConfig();
    buildShellDom(config);
    var state = createInitialState(config);
    updateQa(state);
    try {
      validateRegistry(config);
      loadItems(state);
      renderInstructions(state);
      renderCurrentItem(state);
      updateTabs(state);
      updateProgress(state);
      updateScore(state);
      updateControls(state);
      bindControls(state);
      updateQa(state);
    } catch (e) {
      if (!stageError) {
        failShell(e && e.message ? e.message : String(e));
      }
    }
  }
  window.registerStage = function (def) {
    if (stageRegistry) {
      console.warn('registerStage called more than once; ignoring duplicate call');
      return;
    }
    stageRegistry = def;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', boot);
    } else {
      boot();
    }
  };
  document.addEventListener('DOMContentLoaded', function () {
    setTimeout(function () {
      if (!stageRegistry && !stageError) {
        try {
          var cfg = parseConfig();
          buildShellDom(cfg);
        } catch (e) {
          // config parse failure will surface separately
        }
        failShell('Stage module never called registerStage() within timeout');
      }
    }, 1500);
  });
})();

