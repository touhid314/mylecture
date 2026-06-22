import { buildVtt, formatVttTime } from "../src/utils/vtt.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

assert(formatVttTime(0) === "00:00:00.000", "formatVttTime(0)");
assert(formatVttTime(10.125) === "00:00:10.125", "formatVttTime(10.125)");
assert(formatVttTime(3661.5) === "01:01:01.500", "formatVttTime(3661.5)");
assert(formatVttTime(-5) === "00:00:00.000", "formatVttTime negative clamp");

const emptyVtt = buildVtt([]);
assert(emptyVtt.startsWith("WEBVTT"), "buildVtt([]) starts with WEBVTT");

const vtt = buildVtt([
  { start: 0, duration: 10.125, text: "Hello world" },
  { start: 10.125, duration: 2.475, text: "Next line" },
  { start: 0, duration: 1, text: "  " },
]);

assert(
  vtt.includes("00:00:00.000 --> 00:00:10.125"),
  "first cue timestamp",
);
assert(vtt.includes("Hello world"), "first cue text");
assert(
  vtt.includes("00:00:10.125 --> 00:00:12.600"),
  "second cue timestamp",
);
assert(!vtt.includes("  \n"), "empty text cue skipped");

console.log("vtt.test passed");
