// AWS Signature V4 presigned URLs (query signing), plain JS with WebCrypto: runs in Deno (Edge Function
// studio-media) and in Node (scripts/studio.mjs). Used for Cloudflare R2, which speaks the S3 API (region "auto").
// Tested with the example of the AWS documentation in tests/studio-sigv4.test.mjs.

const enc = new TextEncoder();
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
const sha256 = async (s) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
async function hmac(key, s) {
  const k = await crypto.subtle.importKey("raw", typeof key === "string" ? enc.encode(key) : key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(s));
}
// RFC 3986, as S3 wants it (keep / in paths)
const uri = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

// → presigned https URL. path: "/bucket/key" (path style) or "/key" (virtual host); now: Date
export async function presign({ method = "GET", host, path, region, service = "s3", accessKeyId, secretAccessKey, expires = 3600, now = new Date(), headers = {} }) {
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");   // 20130524T000000Z
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const signed = { host, ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])) };
  const signedHeaders = Object.keys(signed).sort().join(";");
  const q = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expires),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const query = Object.keys(q).sort().map((k) => `${uri(k)}=${uri(q[k])}`).join("&");
  const canonicalPath = path.split("/").map((p) => uri(decodeURIComponent(p))).join("/");
  const canonicalHeaders = Object.keys(signed).sort().map((k) => `${k}:${signed[k]}\n`).join("");
  const request = [method, canonicalPath, query, canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, await sha256(request)].join("\n");
  let key = await hmac(`AWS4${secretAccessKey}`, day);
  for (const part of [region, service, "aws4_request"]) key = await hmac(key, part);
  const signature = hex(await hmac(key, toSign));
  return `https://${host}${canonicalPath}?${query}&X-Amz-Signature=${signature}`;
}

// Cloudflare R2: https://<account>.r2.cloudflarestorage.com/<bucket>/<key>
export const r2Presign = ({ accountId, bucket, key, ...rest }) =>
  presign({ ...rest, host: `${accountId}.r2.cloudflarestorage.com`, path: `/${bucket}/${key}`, region: "auto" });

// a studio media key: only studio/<slug>/v<n>/<file>, never anything else in the bucket
export const STUDIO_KEY = /^studio\/[a-z0-9][a-z0-9._-]{1,80}\/v\d{1,3}\/[A-Za-z0-9._-]{1,120}$/;
