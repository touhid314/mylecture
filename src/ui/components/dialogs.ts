// @ts-nocheck
export function renderDialogs(context = {}) {
  const { agentConfig, burnSubtitleChecked, configuredElevenLabsVoiceOption, defaultAspectRatio, defaultFps, defaultLengthLabel, defaultLengthSeconds, defaultLengthSliderValue, defaultRenderResolution, defaultRenderViewport, defaultSubtitleBottomPercent, defaultSubtitleFontSize, defaultTtsProvider, defaultTtsSpeed, defaultTtsVoice, elevenLabsDefaultVoice, escapeHtml, escapeJsString, getimgChecked, normalizedOpenPath, safeInitialHeight, safeInitialWidth, selectedAttr, subtitleFontOptions, subtitleOptionsVisible, viewerVersion } = context;
  return `<!-- Focused narration editor: one timeline cue, one spoken-text override, one regenerated WAV. -->
<div id="narration-dialog" role="dialog" aria-modal="true" aria-labelledby="narration-title">
  <div id="narration-panel">
    <div id="narration-header">
      <div>
        <h2 id="narration-title">Edit narration</h2>
        <div id="narration-subtitle">Edit the caption and spoken text, then regenerate only that clip.</div>
      </div>
      <button id="narration-close" type="button" aria-label="Close narration editor">Close</button>
    </div>
    <form id="narration-form">
      <div class="narration-field">
        <label for="narration-section-select">Narration cue</label>
        <select id="narration-section-select"></select>
      </div>
      <div class="narration-field">
        <label for="narration-caption">Caption text</label>
        <textarea id="narration-caption" spellcheck="true"></textarea>
      </div>
      <div class="narration-field">
        <label for="narration-spoken-text">Spoken text</label>
        <textarea id="narration-spoken-text" spellcheck="true"></textarea>
      </div>
      <div id="narration-status" role="status" aria-live="polite"></div>
      <div id="narration-actions">
        <button id="narration-reset" type="button">Use caption text</button>
        <button id="narration-regenerate" type="submit">Regenerate this clip</button>
      </div>
    </form>
  </div>
</div>
<!-- Focused visual editor: deterministic copy fixes or isolated one-scene model edits. -->
<div id="visual-text-dialog" role="dialog" aria-modal="true" aria-labelledby="visual-text-title">
  <div id="visual-text-panel">
    <div id="visual-text-header">
      <div>
        <h2 id="visual-text-title">Edit visual</h2>
        <div id="visual-text-subtitle">Describe one focused visual change for this scene.</div>
      </div>
      <button id="visual-text-close" type="button" aria-label="Close visual editor">Close</button>
    </div>
    <form id="visual-text-form">
      <div class="visual-editor-tabs" role="tablist" aria-label="Visual edit method">
        <button id="visual-prompt-tab" class="visual-editor-tab active" type="button" role="tab" aria-selected="true">Prompt model</button>
        <button id="visual-exact-tab" class="visual-editor-tab" type="button" role="tab" aria-selected="false">Exact text</button>
      </div>
      <div id="visual-prompt-section" class="visual-editor-section">
        <div class="visual-text-field">
          <label for="visual-prompt">Change request</label>
          <textarea id="visual-prompt" spellcheck="true" placeholder="For example: Center the three-node timeline horizontally in the frame. Keep its size, content, and animation unchanged."></textarea>
        </div>
        <div id="visual-prompt-help">A fresh editor sees only this scene and this request. Narration, audio, timing, and other scenes are protected.</div>
      </div>
      <div id="visual-exact-section" class="visual-editor-section" hidden>
        <div class="visual-text-field">
          <label for="visual-text-select">Visible text</label>
          <select id="visual-text-select">
            <option value="">Choose text from this scene</option>
          </select>
        </div>
        <div class="visual-text-field">
          <label for="visual-text-find">Text to replace</label>
          <input id="visual-text-find" type="text" spellcheck="true" placeholder="Exact current wording">
        </div>
        <div class="visual-text-field">
          <label for="visual-text-replacement">Replacement</label>
          <textarea id="visual-text-replacement" spellcheck="true" placeholder="Correct wording"></textarea>
        </div>
        <div id="visual-text-help">The exact match is changed in this scene and in script.md when present. No model is used.</div>
      </div>
      <div id="visual-text-status" role="status" aria-live="polite"></div>
      <div id="visual-text-actions">
        <button id="visual-prompt-apply" type="submit">Regenerate this scene</button>
        <button id="visual-text-apply" type="submit" hidden>Apply text change</button>
      </div>
    </form>
  </div>
</div>
<!-- Metadata modal for the currently loaded lecture or rendered video. -->
<div id="info-dialog" role="dialog" aria-modal="true" aria-labelledby="info-title">
  <div id="info-panel">
    <div id="info-header">
      <div id="info-title">Video Info</div>
      <button id="info-close" type="button">Close</button>
    </div>
    <dl id="info-content"></dl>
    <div id="info-branding">
      Copyright 2026, <strong>mylecture.ai</strong>, Touhidul Islam.
    </div>
  </div>
</div>
<!-- Publish modal for copying the current lecture into the website course structure. -->
<div id="publish-dialog" role="dialog" aria-modal="true" aria-labelledby="publish-title">
  <div id="publish-panel">
    <div id="publish-header">
      <div id="publish-title">Publish to course website</div>
      <button id="publish-close" type="button">Close</button>
    </div>
    <form id="publish-form">
      <div id="publish-form-content">
        <div class="form-group">
          <label for="publish-course-select">Course</label>
          <select id="publish-course-select" required>
            <option value="">-- Select Course --</option>
            <option value="__new__">[Create New Course]</option>
          </select>
        </div>
        
        <div id="new-course-fields" style="display: none; border-left: 2px solid var(--line-strong); padding-left: 12px; margin-bottom: 8px;">
          <div class="form-group">
            <label for="publish-new-course-slug">New Course Slug</label>
            <input type="text" id="publish-new-course-slug" placeholder="e.g. system-design">
          </div>
          <div class="form-group">
            <label for="publish-new-course-title">New Course Title</label>
            <input type="text" id="publish-new-course-title" placeholder="e.g. System Design Foundation">
          </div>
          <div class="form-group">
            <label for="publish-new-course-desc">New Course Description</label>
            <textarea id="publish-new-course-desc" placeholder="Course description..."></textarea>
          </div>
          <div class="form-group checkbox-group">
            <input type="checkbox" id="publish-new-course-published" checked>
            <label for="publish-new-course-published">Publish Course catalog</label>
          </div>
        </div>

        <div class="form-group">
          <label for="publish-module">Module Name</label>
          <input type="text" id="publish-module" placeholder="e.g. Module 1: Introduction">
        </div>
        
        <div class="form-row">
          <div class="form-group">
            <label for="publish-lecture-slug">Lecture Slug</label>
            <input type="text" id="publish-lecture-slug" required placeholder="e.g. intro-to-databases">
          </div>
          <div class="form-group">
            <label for="publish-lecture-order">Lecture Number / Order</label>
            <input type="number" id="publish-lecture-order" min="1" placeholder="e.g. 1">
          </div>
        </div>

        <div class="form-group">
          <label for="publish-lecture-title">Lecture Title</label>
          <input type="text" id="publish-lecture-title" required placeholder="e.g. Introduction to Databases">
        </div>

        <div class="form-group">
          <label for="publish-lecture-desc">Lecture Description</label>
          <textarea id="publish-lecture-desc" placeholder="Lecture description..."></textarea>
        </div>

        <div class="form-group checkbox-group">
          <input type="checkbox" id="publish-lecture-published" checked>
          <label for="publish-lecture-published">Make visible to students (Publish)</label>
        </div>
      </div>
      
      <div id="publish-status-box" style="display: none; border-top: 1px solid var(--line); padding: 12px 16px; background: #080808; font-family: monospace; font-size: 11px; max-height: 120px; overflow-y: auto; white-space: pre-wrap; margin: 0 16px 12px; border-radius: 4px; border: 1px solid #331c1c;"></div>

      <div id="publish-footer">
        <button id="publish-cancel" type="button">Cancel</button>
        <button id="publish-submit" type="submit">Publish!</button>
      </div>
    </form>
  </div>
</div>
`;
}
