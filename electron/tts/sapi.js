// Windows built-in speech (System.Speech / SAPI) through one persistent
// PowerShell process. Zero download, works offline; used as the instant
// fallback while the neural voice model downloads.
import { spawn } from "node:child_process";

const SCRIPT = `
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$defaultVoice = $s.Voice.Name
$fmt = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
[Console]::Out.WriteLine("READY " + (($s.GetInstalledVoices() | ForEach-Object { $_.VoiceInfo.Name }) -join "|"))
[Console]::Out.Flush()
while ($true) {
  $line = [Console]::In.ReadLine()
  if ($line -eq $null) { break }
  try {
    $j = $line | ConvertFrom-Json
    if ($j.voice) { try { $s.SelectVoice($j.voice) } catch {} }
    else { $s.SelectVoice($defaultVoice) }
    $s.Rate = [int]$j.rate
    $s.SetOutputToWaveFile($j.out, $fmt)
    $s.Speak([string]$j.text)
    $s.SetOutputToNull()
    [Console]::Out.WriteLine("OK " + $j.id)
  } catch {
    [Console]::Out.WriteLine("ERR " + $j.id + " " + $_.Exception.Message)
  }
  [Console]::Out.Flush()
}
`;

export class SapiVoice {
  constructor() {
    this.proc = null;
    this.ready = null;
    this.pending = new Map();
    this.voices = [];
    this.seq = 0;
  }

  start() {
    if (this.ready) return this.ready;
    if (process.platform !== "win32") {
      this.ready = Promise.reject(new Error("System voice is only available on Windows"));
      return this.ready;
    }
    this.ready = new Promise((resolve, reject) => {
      const encoded = Buffer.from(SCRIPT, "utf16le").toString("base64");
      const p = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", encoded], { windowsHide: true });
      this.proc = p;
      let buf = "";
      p.stdout.setEncoding("utf8");
      p.stdout.on("data", (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf("\n")) !== -1) {
          const line = buf.slice(0, i).trim();
          buf = buf.slice(i + 1);
          if (line.startsWith("READY")) {
            this.voices = line.slice(6).split("|").filter(Boolean);
            resolve();
          } else if (line.startsWith("OK ")) {
            const id = line.slice(3).trim();
            this.pending.get(id)?.resolve();
            this.pending.delete(id);
          } else if (line.startsWith("ERR ")) {
            const [, id, ...rest] = line.split(" ");
            this.pending.get(id)?.reject(new Error(rest.join(" ")));
            this.pending.delete(id);
          }
        }
      });
      p.on("error", reject);
      p.on("close", () => {
        for (const v of this.pending.values()) v.reject(new Error("System voice process exited"));
        this.pending.clear();
        this.ready = null;
        this.proc = null;
      });
    });
    return this.ready;
  }

  async synthToFile(text, outFile, { speed = 1, voice = "" } = {}) {
    await this.start();
    const id = String(++this.seq);
    // SAPI rate: -10..10. Map speed 0.5..2 roughly onto it.
    const rate = Math.max(-10, Math.min(10, Math.round((speed - 1) * 8)));
    const p = new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
    this.proc.stdin.write(JSON.stringify({ id, text, out: outFile, rate, voice }) + "\n");
    return p;
  }

  stop() {
    try {
      this.proc?.kill();
    } catch {}
  }
}
