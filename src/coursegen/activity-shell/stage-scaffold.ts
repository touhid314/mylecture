import type { ActivityShellActivityConfig, ActivityShellConfig } from './assemble.ts';

function jsString(value: string): string {
  return JSON.stringify(value);
}

function buildActivityStub(activity: ActivityShellActivityConfig): string {
  const id = activity.id;
  const stubPrompt = jsString(`Replace with a real question for ${activity.title}.`);
  const checkAnswer = activity.mode === 'learn'
    ? ''
    : `
      checkAnswer(ctx, item) {
        const ok = ctx.getResponse() === item.answer;
        return { correct: ok, explanation: ok ? '' : 'Try again.' };
      },`;

  return `    ${jsString(id)}: {
      createItems() {
        return [
          { prompt: ${stubPrompt}, choices: ['A', 'B'], answer: 'A' },
          { prompt: 'Second item stub.', choices: ['A', 'B'], answer: 'B' }
        ];
      },
      renderItem(ctx, item, el) {
        const p = document.createElement('p');
        p.textContent = item.prompt;
        el.appendChild(p);
        item.choices.forEach(choice => {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = choice;
          btn.onclick = () => ctx.setResponse(choice);
          el.appendChild(btn);
        });
      },${checkAnswer}
    }`;
}

/**
 * Valid stage.js starter for adaptive practice generation.
 * The shell owns score/streak/progress chrome — stages render only question content.
 */
export function shouldWriteStageScaffold(stageExists: boolean, forceOverwrite: boolean): boolean {
  return !stageExists || forceOverwrite;
}

export function buildStageJsScaffold(
  _kind: 'interactive' | 'game',
  shellConfig: ActivityShellConfig
): string {
  const activityBlocks = shellConfig.activities.map(buildActivityStub).join(',\n');

  return `// Stage module — shell owns score, streak, progress, timers, and feedback chrome.
// Do NOT add .game-hud, score panels, streak counters, goal text, or duplicate feedback banners.
// Do NOT monkey-patch Object.prototype or reach into #shell-* internals.

window.registerStage({
  activities: {
${activityBlocks}
  }
});
`;
}
