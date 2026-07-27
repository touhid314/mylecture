import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeTtsText } from './tts-normalize.ts';

describe('normalizeTtsText', () => {
  it('leaves plain text unchanged', () => {
    assert.equal(
      normalizeTtsText('The planet follows an ellipse.'),
      'The planet follows an ellipse.'
    );
  });

  it('strips comma separators from digit groups', () => {
    assert.equal(
      normalizeTtsText('They tracked over 1,700 vacuum cleaners.'),
      'They tracked over 1700 vacuum cleaners.'
    );
    assert.equal(normalizeTtsText('12,345,678 items'), '12345678 items');
  });

  it('does not touch commas followed by spaces or non-groups', () => {
    assert.equal(
      normalizeTtsText('In 2020, 300 people responded.'),
      'In 2020, 300 people responded.'
    );
    assert.equal(normalizeTtsText('rows 1,23 and 4'), 'rows 1,23 and 4');
  });

  it('expands currency amounts', () => {
    assert.equal(
      normalizeTtsText("You didn't save $60. You paid a $75 premium!"),
      "You didn't save 60 dollars. You paid a 75 dollar premium!"
    );
    assert.equal(normalizeTtsText('It costs $1.'), 'It costs 1 dollar.');
    assert.equal(normalizeTtsText('about $1.5 million in sales'), 'about 1.5 million dollars in sales');
    assert.equal(normalizeTtsText('a $2 million investment'), 'a 2 million dollar investment');
  });

  it('expands currency with comma-grouped digits', () => {
    assert.equal(normalizeTtsText('a $1,700 laptop'), 'a 1700 dollar laptop');
  });

  it('expands percentages', () => {
    assert.equal(normalizeTtsText('Sales rose 24% overall.'), 'Sales rose 24 percent overall.');
    assert.equal(normalizeTtsText('a 3.5% fee'), 'a 3.5 percent fee');
  });

  it('handles empty and non-string-safe input', () => {
    assert.equal(normalizeTtsText(''), '');
  });
});
