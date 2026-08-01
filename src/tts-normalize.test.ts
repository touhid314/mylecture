import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { normalizeTtsText } from '../packages/lecture-viewer/src/player/tts-normalize.ts';

describe('normalizeTtsText', () => {
  it('leaves plain text unchanged', () => {
    assert.equal(
      normalizeTtsText('The planet follows an ellipse.'),
      'The planet follows an ellipse.'
    );
  });

  it('strips comma separators from digit groups and speaks numbers', () => {
    assert.equal(
      normalizeTtsText('They tracked over 1,700 vacuum cleaners.'),
      'They tracked over one thousand seven hundred vacuum cleaners.'
    );
    assert.equal(
      normalizeTtsText('12,345,678 items'),
      'twelve million three hundred forty five thousand six hundred seventy eight items'
    );
  });

  it('does not touch commas followed by spaces or non-groups', () => {
    assert.equal(
      normalizeTtsText('In 2020, 300 people responded.'),
      'In two thousand twenty, three hundred people responded.'
    );
    assert.equal(normalizeTtsText('rows 1,23 and 4'), 'rows one,twenty three and four');
  });

  it('expands currency amounts to spoken dollars', () => {
    assert.equal(
      normalizeTtsText("You didn't save $60. You paid a $75 premium!"),
      "You didn't save sixty dollars. You paid a seventy five dollar premium!"
    );
    assert.equal(normalizeTtsText('It costs $1.'), 'It costs one dollar.');
    assert.equal(
      normalizeTtsText('about $1.5 million in sales'),
      'about one point five million dollars in sales'
    );
    assert.equal(
      normalizeTtsText('a $2 million investment'),
      'a two million dollar investment'
    );
  });

  it('expands attributive currency before uppercase acronyms', () => {
    assert.equal(
      normalizeTtsText('NASA grew 24% after a $60 API upgrade in 2020.'),
      'N A S A grew twenty four percent after a sixty dollar A P I upgrade in two thousand twenty.'
    );
  });

  it('expands currency with comma-grouped digits', () => {
    assert.equal(
      normalizeTtsText('a $1,700 laptop'),
      'a one thousand seven hundred dollar laptop'
    );
  });

  it('expands percentages with spoken numbers', () => {
    assert.equal(
      normalizeTtsText('Sales rose 24% overall.'),
      'Sales rose twenty four percent overall.'
    );
    assert.equal(normalizeTtsText('a 3.5% fee'), 'a three point five percent fee');
  });

  it('converts numeric ranges to spoken form', () => {
    assert.equal(normalizeTtsText('ages 10-20'), 'ages ten to twenty');
    assert.equal(normalizeTtsText('scores 10–20'), 'scores ten to twenty');
    assert.equal(normalizeTtsText('scores 10—20'), 'scores ten to twenty');
  });

  it('does not expand hyphen chains in phone numbers or ISBNs', () => {
    assert.equal(
      normalizeTtsText('call 1-800-555-1212'),
      'call one-eight hundred-five hundred fifty five-one thousand two hundred twelve'
    );
    assert.doesNotMatch(normalizeTtsText('call 1-800-555-1212'), /\bto\b/);
    assert.equal(
      normalizeTtsText('ISBN 978-0-321-57345-4'),
      'I S B N nine hundred seventy eight-zero-three hundred twenty one-fifty seven thousand three hundred forty five-four'
    );
    assert.doesNotMatch(normalizeTtsText('ISBN 978-0-321-57345-4'), /\bto\b/);
  });

  it('converts negative numbers but not hyphenated tokens', () => {
    assert.equal(normalizeTtsText('temperature dropped to -5'), 'temperature dropped to minus five');
    assert.equal(normalizeTtsText('value is -3.14'), 'value is minus three point one four');
    assert.equal(normalizeTtsText('during COVID-19'), 'during C O V I D-nineteen');
    assert.doesNotMatch(normalizeTtsText('during COVID-19'), /minus/);
    assert.equal(normalizeTtsText('see x-5'), 'see x-five');
    assert.doesNotMatch(normalizeTtsText('see x-5'), /minus/);
  });

  it('converts simple fractions but not dates', () => {
    assert.equal(normalizeTtsText('about 1/2 done'), 'about one over two done');
    assert.equal(normalizeTtsText('a 3/4 share'), 'a three over four share');
    assert.equal(
      normalizeTtsText('on 3/15/2020 we launched'),
      'on three/fifteen/two thousand twenty we launched'
    );
    assert.doesNotMatch(normalizeTtsText('on 3/15/2020 we launched'), /over/);
  });

  it('converts ordinals including zeroth', () => {
    assert.equal(normalizeTtsText('the 0th item'), 'the zeroth item');
    assert.equal(normalizeTtsText('the 1st place'), 'the first place');
    assert.equal(normalizeTtsText('on the 2nd floor'), 'on the second floor');
    assert.equal(normalizeTtsText('the 3rd option'), 'the third option');
    assert.equal(normalizeTtsText('the 4th item'), 'the fourth item');
    assert.equal(normalizeTtsText('the 21st century'), 'the twenty first century');
  });

  it('leaves version numbers with multiple dots unchanged', () => {
    assert.equal(normalizeTtsText('upgrade to 2.5.1 now'), 'upgrade to 2.5.1 now');
    assert.equal(normalizeTtsText('running v3.10.2'), 'running v3.10.2');
  });

  it('speaks trillion-scale numbers correctly', () => {
    assert.equal(
      normalizeTtsText('budget is 2000000000000'),
      'budget is two trillion'
    );
  });

  it('speaks long and leading-zero numbers digit by digit', () => {
    assert.equal(normalizeTtsText('agent 007'), 'agent zero zero seven');
    assert.equal(
      normalizeTtsText('id 9007199254740992'),
      'id nine zero zero seven one nine nine two five four seven four zero nine nine two'
    );
  });

  it('spaces out acronyms without touching mixed case', () => {
    assert.equal(normalizeTtsText('NASA launched an API'), 'N A S A launched an A P I');
    assert.equal(normalizeTtsText('HTML and CSS'), 'H T M L and C S S');
    assert.equal(
      normalizeTtsText('McKinsey reviewed the plan'),
      'McKinsey reviewed the plan'
    );
  });

  it('handles empty and non-string-safe input', () => {
    assert.equal(normalizeTtsText(''), '');
  });
});
