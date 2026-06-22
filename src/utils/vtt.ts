export function formatVttTime(seconds: number): string {
  const clamped = Math.max(0, seconds);
  const roundedMs = Math.round(clamped * 1000);
  const ms = roundedMs % 1000;
  const totalSeconds = Math.floor(roundedMs / 1000);
  const s = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const m = totalMinutes % 60;
  const h = Math.floor(totalMinutes / 60);

  const pad2 = (n: number) => String(n).padStart(2, "0");
  const pad3 = (n: number) => String(n).padStart(3, "0");

  return `${pad2(h)}:${pad2(m)}:${pad2(s)}.${pad3(ms)}`;
}

export function buildVtt(
  audioTimeline: Array<{ start: number; duration: number; text?: string }>,
): string {
  const lines: string[] = ["WEBVTT", ""];
  let cueIndex = 0;

  for (const entry of audioTimeline) {
    const text = (entry.text ?? "").trim();
    if (!text) continue;

    cueIndex += 1;
    const sanitized = text
      .replace(/-->/g, "-")
      .replace(/\r?\n/g, " ");

    lines.push(String(cueIndex));
    lines.push(
      `${formatVttTime(entry.start)} --> ${formatVttTime(entry.start + entry.duration)}`,
    );
    lines.push(sanitized);
    lines.push("");
  }

  if (cueIndex === 0) {
    return "WEBVTT\n";
  }

  return lines.join("\n");
}
