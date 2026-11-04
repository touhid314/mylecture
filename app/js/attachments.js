import { h, icon, toast } from "./ui.js";

const EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "pdf", "doc", "docx", "ppt", "pptx", "xls", "xlsx", "txt", "md", "csv"];
const MAX_SIZE = 20 * 1024 * 1024;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes("Files");

// A file dropped anywhere else must not make the window navigate to it.
if (typeof document !== "undefined") {
  document.addEventListener("dragover", (e) => { if (hasFiles(e)) e.preventDefault(); });
  document.addEventListener("drop", (e) => { if (hasFiles(e)) e.preventDefault(); });
}

// Shared by Create and Study; files stay in memory until the message is sent.
export class AttachmentPicker {
  constructor(input) {
    this.files = [];
    this.locked = false;
    this.input = input;
    this.list = h("div", { class: "attachment-list", hidden: true, "aria-label": "Attached files" });
    this.fileInput = h("input", { type: "file", hidden: true, multiple: true, accept: EXTENSIONS.map(ext => `.${ext}`).join(","), onchange: () => {
      this.add(this.fileInput.files);
      this.fileInput.value = "";
    } });
    this.button = h("button", { class: "btn ghost sm icon attachment-add", type: "button", title: "Attach files", "aria-label": "Attach files", onclick: () => this.fileInput.click() }, icon("plus"));
    this.controls = h("span", { class: "attachment-controls" }, this.button, this.fileInput);
    input.addEventListener("paste", event => {
      const images = [...(event.clipboardData?.items || [])].filter(item => item.kind === "file" && item.type.startsWith("image/")).map(item => item.getAsFile()).filter(Boolean);
      if (!images.length) return;
      event.preventDefault();
      this.add(images);
    });
  }

  // Files dragged onto `el` are attached; it highlights while they hover.
  dropTarget(el) {
    let depth = 0;
    const off = () => { depth = 0; el.classList.remove("drop-active"); };
    el.addEventListener("dragenter", (e) => {
      if (!hasFiles(e) || this.locked) return;
      e.preventDefault();
      depth++;
      el.classList.add("drop-active");
    });
    el.addEventListener("dragover", (e) => {
      if (!hasFiles(e) || this.locked) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    el.addEventListener("dragleave", () => { if (--depth <= 0) off(); });
    el.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      off();
      if (this.locked) return;
      this.add(e.dataTransfer.files);
      this.input?.focus();
    });
    return el;
  }

  add(files) {
    if (this.locked) return;
    for (const file of files) {
      const ext = file.name.split(".").pop().toLowerCase();
      if (!EXTENSIONS.includes(ext)) {
        toast(`${file.name}: this file type is not supported.`, { kind: "bad" });
        continue;
      }
      if (file.size > MAX_SIZE) {
        toast(`${file.name} exceeds the 20 MB limit.`, { kind: "bad" });
        continue;
      }
      if (this.files.length >= 10) {
        toast("Attach up to 10 files per message.", { kind: "bad" });
        break;
      }
      this.files.push({ file, preview: file.type.startsWith("image/") ? URL.createObjectURL(file) : null });
    }
    this.render();
  }

  get count() { return this.files.length; }
  names() { return this.files.map(({ file }) => ({ name: file.name })); }
  async serialize() {
    return Promise.all(this.files.map(async ({ file }) => ({ name: file.name, type: file.type, data: new Uint8Array(await file.arrayBuffer()) })));
  }
  setLocked(value) {
    this.locked = value;
    this.button.disabled = value;
    this.render();
  }
  clear() {
    for (const item of this.files) if (item.preview) URL.revokeObjectURL(item.preview);
    this.files = [];
    this.render();
  }
  remove(item) {
    if (this.locked) return;
    if (item.preview) URL.revokeObjectURL(item.preview);
    this.files.splice(this.files.indexOf(item), 1);
    this.render();
  }
  render() {
    this.list.hidden = !this.files.length;
    this.list.replaceChildren(...this.files.map(item => h("div", { class: "attachment-chip", title: `${item.file.name} (${Math.ceil(item.file.size / 1024)} KB)` },
      item.preview ? h("img", { src: item.preview, alt: "", class: "attachment-preview" }) : icon("text"),
      h("span", {}, item.file.name),
      h("button", { class: "btn ghost sm icon", type: "button", disabled: this.locked, "aria-label": `Remove ${item.file.name}`, onclick: () => this.remove(item) }, icon("x")),
    )));
  }
}

export function attachmentNames(items = []) {
  if (!items.length) return null;
  return h("div", { class: "message-attachments" }, items.map(item => h("span", { class: "message-attachment", title: item.name }, icon("text"), item.name)));
}
