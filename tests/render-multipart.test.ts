import { buildRenderMultipart } from "../src/utils/render-multipart.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const mp4 = Buffer.from([0, 1, 2, 3, 4, 255, 254, 253]);
const vtt = "WEBVTT\n\n1\n00:00:00.000 --> 00:00:01.000\nHi\n";

const { contentType, body } = buildRenderMultipart(mp4, vtt);

const res = new Response(body, {
  headers: { "content-type": contentType },
});
const form = await res.formData();

const captions = form.get("captions");
assert(captions !== null, "captions part missing");

const captionsText =
  typeof captions === "string"
    ? captions
    : await (captions as Blob).text();
assert(captionsText === vtt, "captions text mismatch");

const video = form.get("video");
assert(video !== null, "video part missing");

const videoBytes = Buffer.from(await (video as Blob).arrayBuffer());
assert(videoBytes.length === mp4.length, "video length mismatch");
for (let i = 0; i < mp4.length; i++) {
  if (videoBytes[i] !== mp4[i]) {
    throw new Error(`video byte mismatch at index ${i}`);
  }
}

console.log("render-multipart.test passed");
