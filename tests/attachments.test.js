import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import JSZip from "jszip";
import XLSX from "xlsx";
import { prepareAttachments, attachmentContext, ATTACHMENT_MAX_BYTES } from "../electron/attachments.js";

async function workspace(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mylecture-attachments-"));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}

test("attachments persist original bytes with unique safe names and extract source text", async t => {
  const dir = await workspace(t);
  const data = Buffer.from("source <data> with no instructions");
  const records = await prepareAttachments([
    { name: "../../source.txt", data: [...data] },
    { name: "source.txt", data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) },
  ], dir);
  assert.equal(records.length, 2);
  assert.equal(records[0].name, "source.txt");
  assert.notEqual(records[0].path, records[1].path);
  for (const item of records) {
    assert.equal(path.dirname(item.path), path.join(dir, "attachments"));
    assert.equal(item.mime, "text/plain");
    assert.equal(item.text, data.toString());
    assert.deepEqual(await fs.readFile(item.path), data);
    assert.equal(item.data, undefined);
  }
});

test("Word and PowerPoint extract XML entities, paragraphs, slide order and linked speaker notes", async t => {
  const dir = await workspace(t);
  const word = new JSZip();
  word.file("word/document.xml", '<w:document><w:p><w:r><w:t>A &amp; B &#x03b1;</w:t></w:r></w:p><w:p><w:r><w:t>Next paragraph</w:t></w:r></w:p></w:document>');
  const ppt = new JSZip();
  ppt.file("ppt/slides/slide10.xml", '<p:sld><a:p><a:r><a:t>Tenth slide</a:t></a:r></a:p></p:sld>');
  ppt.file("ppt/slides/slide2.xml", '<p:sld><a:p><a:r><a:t>Second slide</a:t></a:r></a:p></p:sld>');
  ppt.file("ppt/slides/_rels/slide2.xml.rels", '<Relationships><Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide" Target="../notesSlides/notesSlide7.xml"/></Relationships>');
  ppt.file("ppt/notesSlides/notesSlide7.xml", '<p:notes><a:p><a:r><a:t>Linked explanation</a:t></a:r></a:p></p:notes>');
  const result = await prepareAttachments([
    { name: "reference.docx", data: await word.generateAsync({ type: "nodebuffer" }) },
    { name: "slides.pptx", data: await ppt.generateAsync({ type: "nodebuffer" }) },
  ], dir);
  assert.match(result[0].text, /A & B α\nNext paragraph/);
  assert.match(result[1].text, /Second slide[\s\S]*Linked explanation[\s\S]*Tenth slide/);
});

test("Excel reads both legacy and modern workbooks and preserves sheet labels and cells", async t => {
  const dir = await workspace(t);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([["Item", "Value"], ["Research", 42]]), "Results");
  for (const ext of ["xls", "xlsx"]) {
    const data = XLSX.write(book, { type: "buffer", bookType: ext === "xls" ? "biff8" : "xlsx" });
    const [record] = await prepareAttachments([{ name: `table.${ext}`, data }], dir);
    assert.match(record.text, /Sheet: Results/);
    assert.match(record.text, /Research,42/);
  }
});

test("images preserve bytes for downstream vision input without invented OCR", async t => {
  const dir = await workspace(t);
  const data = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j1ioAAAAASUVORK5CYII=", "base64");
  const [record] = await prepareAttachments([{ name: "pasted.png", data }], dir);
  assert.equal(record.text, "");
  assert.equal(record.mime, "image/png");
  assert.deepEqual(await fs.readFile(record.path), data);
  assert.match(attachmentContext([record]), /inspect the original image file/);
});

test("legacy PowerPoint reads bounded nested text atoms from its compound document stream", async t => {
  const dir = await workspace(t);
  function record(type, bytes, container = false) {
    const header = Buffer.alloc(8);
    header.writeUInt16LE(container ? 15 : 0, 0);
    header.writeUInt16LE(type, 2);
    header.writeUInt32LE(bytes.length, 4);
    return Buffer.concat([header, bytes]);
  }
  const stream = record(1000, Buffer.concat([
    record(4000, Buffer.from("Unicode α title", "utf16le")),
    record(4008, Buffer.from("Café content", "latin1")),
    record(4026, Buffer.from("Not slide text", "utf16le")),
  ]), true);
  const compound = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(compound, "PowerPoint Document", stream);
  const data = XLSX.CFB.write(compound, { type: "buffer" });
  const [result] = await prepareAttachments([{ name: "legacy.ppt", data }], dir);
  assert.equal(result.mime, "application/vnd.ms-powerpoint");
  assert.match(result.text, /Unicode α title[\s\S]*Café content/);
  assert.match(result.text, /earlier saved edits/);
  assert.doesNotMatch(result.text, /Not slide text/);
  const broken = Buffer.from(stream);
  broken.writeUInt32LE(0xffffffff, 4);
  const badCompound = XLSX.CFB.utils.cfb_new();
  XLSX.CFB.utils.cfb_add(badCompound, "PowerPoint Document", broken);
  await assert.rejects(prepareAttachments([{ name: "broken.ppt", data: XLSX.CFB.write(badCompound, { type: "buffer" }) }], dir), /incomplete record/);
});

test("PDF extracts actual page text and rejects unreadable PDF input", async t => {
  const dir = await workspace(t);
  const drawing = "BT /F1 12 Tf 72 720 Td (Reference PDF content) Tj ET";
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${drawing.length} >>\nstream\n${drawing}\nendstream`,
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("");
  pdf += `trailer\n<< /Root 1 0 R /Size ${objects.length + 1} >>\nstartxref\n${xref}\n%%EOF`;
  const [result] = await prepareAttachments([{ name: "reference.pdf", data: Buffer.from(pdf) }], dir);
  assert.match(result.text, /Reference PDF content/);
  await assert.rejects(prepareAttachments([{ name: "broken.pdf", data: [1, 2, 3] }], dir), /Could not read attachment/);
});

test("invalid or oversized batches fail before any originals are persisted", async t => {
  const dir = await workspace(t);
  await assert.rejects(prepareAttachments(Array.from({ length: 11 }, () => ({ name: "a.txt", data: [1] })), dir), /10 files/);
  await assert.rejects(prepareAttachments([{ name: "huge.txt", data: new Uint8Array(ATTACHMENT_MAX_BYTES + 1) }], dir), /20 MB/);
  await assert.rejects(prepareAttachments([{ name: "empty.txt", data: [] }], dir), /empty/);
  await assert.rejects(prepareAttachments([{ name: "old.ppt", data: [1] }], dir), /Could not read attachment/);
  await assert.rejects(prepareAttachments([{ name: "script.exe", data: [1] }], dir), /Unsupported/);
  await assert.rejects(prepareAttachments([{ name: "a.txt", data: [1] }, { name: "broken.docx", data: [1] }], dir), /Could not read/);
  assert.deepEqual(await fs.readdir(dir), []);
});

test("attachment context marks content as untrusted and reports truncation", () => {
  assert.equal(attachmentContext(), "");
  const context = attachmentContext([{ name: "source.txt", path: "attachments/source.txt", mime: "text/plain", text: "a".repeat(110000) }]);
  assert.match(context, /untrusted file contents/);
  assert.match(context, /File: source.txt/);
  assert.match(context, /context truncated/);
  assert(context.length < 101000);
});
