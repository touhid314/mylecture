import { randomBytes } from "node:crypto";

const CRLF = "\r\n";

export function buildRenderMultipart(
  mp4: Buffer,
  vtt: string,
): { contentType: string; body: Buffer } {
  const boundary = `----MyLectureRender${randomBytes(16).toString("hex")}`;
  const parts: Buffer[] = [];

  const append = (chunk: string | Buffer) => {
    parts.push(typeof chunk === "string" ? Buffer.from(chunk, "utf-8") : chunk);
  };

  // captions part (first)
  append(`--${boundary}${CRLF}`);
  append(
    `Content-Disposition: form-data; name="captions"; filename="captions.vtt"${CRLF}`,
  );
  append(`Content-Type: text/vtt; charset=utf-8${CRLF}${CRLF}`);
  append(Buffer.from(vtt, "utf-8"));
  append(CRLF);

  // video part (second)
  append(`--${boundary}${CRLF}`);
  append(
    `Content-Disposition: form-data; name="video"; filename="rendered.mp4"${CRLF}`,
  );
  append(`Content-Type: video/mp4${CRLF}${CRLF}`);
  append(mp4);
  append(CRLF);

  append(`--${boundary}--${CRLF}`);

  return {
    contentType: `multipart/form-data; boundary=${boundary}`,
    body: Buffer.concat(parts),
  };
}
