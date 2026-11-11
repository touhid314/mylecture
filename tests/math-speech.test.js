import test from "node:test";
import assert from "node:assert/strict";
import { normalizeForSpeech, mathToSpeech, normalizeLatex } from "../app/shared/speech-text.js";

test("LaTeX narration is spoken as math, with no dollar signs or source commands", () => {
  assert.equal(normalizeForSpeech("Look at $u$ times $v$."), "Look at u times v.");
  assert.equal(normalizeForSpeech("Now choose $u(x)$."), "Now choose u of x.");
  assert.equal(normalizeForSpeech(String.raw`Choose \(u\) and \(v\).`), "Choose u and v.");
  assert.equal(normalizeForSpeech(String.raw`Use $\frac{du}{dx}$ and $x^{2}$.`), "Use the derivative of u with respect to x and x squared.");
  assert.equal(normalizeForSpeech(String.raw`The area is $$\pi r^2$$.`), "The area is pi r squared.");
  assert.equal(mathToSpeech(String.raw`\int_0^1 x^2\,dx`), "the integral from 0 to 1 of x squared with respect to x");
  assert.equal(mathToSpeech(String.raw`\sum_{i=1}^{n} i`), "the sum from i equals 1 to n of i");
  assert.equal(mathToSpeech(String.raw`\sqrt{\frac{a}{b}}`), "square root of a over b");
  assert.equal(mathToSpeech(String.raw`\htmlId{do-not-speak-this}{u \cdot v}`), "u times v");
});

test("speech adaptation preserves ordinary prose, currency, and source notation", () => {
  const original = "The derivative of $u$ times $v$.";
  const spoken = normalizeForSpeech(original);
  assert.equal(original, "The derivative of $u$ times $v$.");
  assert.equal(normalizeForSpeech(spoken), spoken);
  assert.equal(normalizeForSpeech("Costs $5 and $10."), "Costs $5 and $10.");
  assert.equal(normalizeForSpeech("Let's check the answer."), "Let's check the answer.");
});

test("JSON-escaped math commands are repaired without changing genuine TeX line breaks", () => {
  assert.equal(normalizeLatex(String.raw`\\frac{a}{b}`), String.raw`\frac{a}{b}`);
  const matrix = String.raw`\begin{matrix}a&b\\c&d\end{matrix}`;
  assert.equal(normalizeLatex(matrix), matrix);
});
