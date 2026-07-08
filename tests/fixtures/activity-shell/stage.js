window.registerStage({
  activities: {
    main: {
      createItems: function () {
        return [
          { prompt: 'What is 2 + 2?', choices: ['3', '4', '5'], answer: '4' },
          { prompt: 'What is 3 + 3?', choices: ['5', '6', '7'], answer: '6' },
          { prompt: 'What is 1 + 1?', choices: ['1', '2', '3'], answer: '2' }
        ];
      },
      renderItem: function (ctx, item, mountEl) {
        var prompt = document.createElement('p');
        prompt.textContent = item.prompt;
        prompt.style.fontSize = '18px';
        mountEl.appendChild(prompt);
        var row = document.createElement('div');
        row.style.display = 'flex';
        row.style.flexWrap = 'wrap';
        row.style.gap = '10px';
        row.style.marginTop = '12px';
        item.choices.forEach(function (choice) {
          var btn = document.createElement('button');
          btn.type = 'button';
          btn.textContent = choice;
          btn.className = 'stage-choice';
          btn.style.minHeight = '44px';
          btn.style.minWidth = '44px';
          btn.style.fontSize = '16px';
          btn.addEventListener('click', function () {
            ctx.setResponse(choice);
            Array.from(row.querySelectorAll('button')).forEach(function (b) {
              b.style.outline = b === btn ? '2px solid #5b8def' : '';
            });
          });
          row.appendChild(btn);
        });
        mountEl.appendChild(row);
      },
      checkAnswer: function (ctx, item) {
        var response = ctx.getResponse();
        var correct = response === item.answer;
        return {
          correct: correct,
          explanation: correct ? 'Nice work.' : 'The answer is ' + item.answer + '.'
        };
      }
    }
  }
});
