// "Add your own voice" popup for OmniVoice: record a short clip (or upload
// one), confirm what is said, and save it as a reference voice.
import { h, icon, toast, modal, bus, confirmBox } from "./ui.js";

const SCRIPT = "Hi, I'm recording this so MyLecture can narrate my videos in my own voice. Every lesson starts with a question, and together we find the answer step by step.";
const AUDIO_ACCEPT = ".wav,.mp3,.m4a,.aac,.ogg,.oga,.opus,.flac,.webm,.mp4,.mov,.mkv,audio/*,video/*";

const friendly = (e) => String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, "");

// Resolves to the new voice [id, name] or null when cancelled.
export function openAddVoice() {
  return new Promise((resolve) => {
    let mode = "record", clip = null, ext = ".webm", recorder = null, stream = null, timer = 0, started = 0, saved = null, previewUrl = "";
    const name = h("input", { class: "input", placeholder: "For example: My voice", maxlength: "60", "aria-label": "Voice name" });
    const transcript = h("textarea", { class: "input", rows: "3", "aria-label": "What is said in the recording", placeholder: "Type exactly what is said in the recording" }, SCRIPT);
    const preview = h("audio", { controls: true, hidden: true, style: { width: "100%", marginTop: "8px" } });
    const status = h("span", { class: "small muted" }, "");
    const setClip = (blob, extension, label) => {
      clip = blob; ext = extension;
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      preview.src = previewUrl;
      preview.hidden = false;
      status.textContent = label;
    };

    const recBtn = h("button", { class: "btn primary", onclick: async () => {
      if (recorder) return void recorder.stop();
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      } catch {
        return void toast("MyLecture could not use the microphone. Check that one is connected and allowed in Windows privacy settings.", { kind: "bad", timeout: 8000 });
      }
      const chunks = [];
      recorder = new MediaRecorder(stream, MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? { mimeType: "audio/webm;codecs=opus" } : {});
      recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
      recorder.onstop = () => {
        clearInterval(timer);
        stream.getTracks().forEach((t) => t.stop());
        const secs = (Date.now() - started) / 1000;
        recorder = null;
        recBtn.replaceChildren(icon("mic"), "Record again");
        setClip(new Blob(chunks, { type: "audio/webm" }), ".webm", `Recorded ${secs.toFixed(1)} s`);
      };
      recorder.start();
      started = Date.now();
      recBtn.replaceChildren(icon("stop"), "Stop");
      timer = setInterval(() => {
        const secs = (Date.now() - started) / 1000;
        status.textContent = `Recording… ${secs.toFixed(0)} s`;
        if (secs >= 20) recorder?.stop();
      }, 250);
    } }, icon("mic"), "Record");
    const recordPane = h("div", {},
      h("p", { class: "small muted", style: { margin: "0 0 6px" } }, "Read this aloud in your normal speaking voice (about 10 seconds):"),
      h("blockquote", { class: "voice-script", style: { margin: "0 0 10px", padding: "10px 12px", borderLeft: "3px solid var(--accent, #58c4dd)", background: "var(--panel, rgba(127,127,127,.08))", borderRadius: "6px" } }, SCRIPT),
      h("div", { style: { display: "flex", alignItems: "center", gap: "10px" } }, recBtn));

    const file = h("input", { type: "file", accept: AUDIO_ACCEPT, hidden: true, onchange: () => {
      const f = file.files[0];
      if (!f) return;
      if (f.size > 100 * 1024 * 1024) return void toast("The audio file must be 100 MB or smaller.", { kind: "bad" });
      const e = "." + (f.name.split(".").pop() || "").toLowerCase();
      if (!name.value.trim()) name.value = f.name.replace(/\.[^.]+$/, "").slice(0, 60);
      if (transcript.value === SCRIPT) transcript.value = "";
      setClip(f, e, f.name);
    } });
    const uploadPane = h("div", { hidden: true },
      h("p", { class: "small muted", style: { margin: "0 0 6px" } }, "Choose a clean clip of one person speaking, 5 to 20 seconds long, with no music. Longer files are trimmed to the first 20 seconds."),
      h("div", { style: { display: "flex", alignItems: "center", gap: "10px" } }, h("button", { class: "btn", onclick: () => file.click() }, icon("folder"), "Choose audio file"), file));

    const seg = h("div", { class: "seg" });
    const setMode = (m) => {
      mode = m;
      recordPane.hidden = m !== "record";
      uploadPane.hidden = m !== "upload";
      for (const b of seg.children) b.classList.toggle("on", b.dataset.mode === m);
      if (recorder) recorder.stop();
    };
    seg.append(
      h("button", { "data-mode": "record", class: "on", onclick: () => setMode("record") }, icon("mic"), " Record"),
      h("button", { "data-mode": "upload", onclick: () => setMode("upload") }, icon("folder"), " Upload a file"));

    const consent = h("input", { type: "checkbox", "aria-label": "Consent" });
    const field = (label, ctl, hint) => h("label", { style: { display: "block", margin: "12px 0" } }, h("b", { style: { display: "block", marginBottom: "6px" } }, label), ctl, hint ? h("span", { class: "small faint", style: { display: "block", marginTop: "4px" } }, hint) : null);

    modal({
      title: "Add your own voice",
      width: "560px",
      body: h("div", {},
        h("p", { class: "muted small", style: { marginTop: 0 } }, "OmniVoice learns a voice from one short recording and narrates your videos with it, on this computer. A quiet room and a steady, natural voice give the best result."),
        field("Name", name),
        h("div", { style: { margin: "12px 0" } }, seg),
        recordPane, uploadPane, h("div", { style: { marginTop: "8px" } }, status), preview,
        field("What is said in the recording", transcript, "Must match the recording word for word; OmniVoice uses it to learn the voice."),
        h("label", { style: { display: "flex", gap: "8px", alignItems: "flex-start", marginTop: "8px" } }, consent,
          h("span", { class: "small" }, "This is my voice, or I have permission from the person whose voice this is."))),
      onClose: () => {
        if (recorder) recorder.stop();
        stream?.getTracks().forEach((t) => t.stop());
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        resolve(saved);
      },
      actions: [
        { label: "Cancel" },
        { label: "Add voice", primary: true, run: async () => {
          if (recorder) { toast("Stop the recording first."); return false; }
          if (!name.value.trim()) { toast("Give the voice a name.", { kind: "bad" }); return false; }
          if (!clip) { toast(mode === "record" ? "Record yourself reading the text first." : "Choose an audio file first.", { kind: "bad" }); return false; }
          if (transcript.value.trim().length < 8) { toast("Type exactly what is said in the recording.", { kind: "bad" }); return false; }
          if (!consent.checked) { toast("Confirm that you have permission to use this voice.", { kind: "bad" }); return false; }
          try {
            const busy = toast("Adding your voice and recording its demo. The first time, OmniVoice takes about a minute to load.", { timeout: 0 });
            try {
              saved = await window.ml.tts.addVoice({ name: name.value.trim(), transcript: transcript.value.trim(), data: new Uint8Array(await clip.arrayBuffer()), ext });
            } finally { busy.remove(); }
            toast(saved[2]?.demoError ? `Added “${saved[1]}”. Its demo will be recorded the first time you play it.` : `Added “${saved[1]}”.`, { kind: "good" });
            bus.emit("voices-changed");
          } catch (e) {
            toast(friendly(e), { kind: "bad", timeout: 9000 });
            return false;
          }
        } },
      ],
    });
  });
}

// Remove one of the user's own voices after confirming. Resolves true if removed.
export async function removeOwnVoice(id, label) {
  if (!(await confirmBox("Remove voice", `Remove “${label}”? Videos already narrated with it keep their audio.`, "Remove"))) return false;
  try {
    await window.ml.tts.removeVoice(id);
    bus.emit("voices-changed");
    toast(`Removed “${label}”.`);
    return true;
  } catch (e) {
    toast(friendly(e), { kind: "bad" });
    return false;
  }
}

export const isOwnVoice = (id) => String(id).startsWith("custom-");
