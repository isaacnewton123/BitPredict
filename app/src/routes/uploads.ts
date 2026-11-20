import fs from "node:fs";
import path from "node:path";
import { Elysia, t } from "elysia";
import { getCurrentUserFromRequest } from "@/lib/auth/server";
import {
  buildR2ObjectKey,
  buildR2PublicUrl,
  getObjectFromR2,
  getR2Config,
  isR2StrictDriver,
  uploadObjectToR2,
} from "@/lib/storage/r2";

const UPLOAD_DIR = path.resolve(process.cwd(), "data/uploads");
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const SAFE_FILENAME_RE = /^[A-Za-z0-9_-]+\.(png|jpg|webp|gif)$/;

const EXT_TO_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

function sniffImageType(bytes: Uint8Array): { ext: "png" | "jpg" | "webp" | "gif"; mime: string } | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return { ext: "png", mime: "image/png" };
  }

  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { ext: "jpg", mime: "image/jpeg" };
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return { ext: "webp", mime: "image/webp" };
  }

  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x38 &&
    (bytes[4] === 0x37 || bytes[4] === 0x39) &&
    bytes[5] === 0x61
  ) {
    return { ext: "gif", mime: "image/gif" };
  }

  return null;
}

export const uploadRoutes = new Elysia({ name: "upload-routes" })
  .post(
    "/api/v1/uploads/market-image",
    async ({ request, body, set }) => {
      const user = await getCurrentUserFromRequest(request);
      if (!user) {
        set.status = 401;
        return { error: { code: "UNAUTHORIZED", message: "Log in with Nostr before uploading an image" } };
      }

      const file = body.file;
      if (file.size > MAX_IMAGE_BYTES) {
        set.status = 413;
        return { error: { code: "PAYLOAD_TOO_LARGE", message: "Image must be 5 MB or smaller" } };
      }

      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.byteLength === 0) {
        set.status = 400;
        return { error: { code: "EMPTY_FILE", message: "Uploaded file is empty" } };
      }
      if (bytes.byteLength > MAX_IMAGE_BYTES) {
        set.status = 413;
        return { error: { code: "PAYLOAD_TOO_LARGE", message: "Image must be 5 MB or smaller" } };
      }

      const detected = sniffImageType(bytes);
      if (!detected) {
        set.status = 415;
        return {
          error: {
            code: "UNSUPPORTED_MEDIA_TYPE",
            message: "Only PNG, JPEG, WEBP, and GIF image files are supported",
          },
        };
      }

      const filename = `${crypto.randomUUID()}.${detected.ext}`;
      const r2 = getR2Config();

      if (!r2 && isR2StrictDriver()) {
        set.status = 503;
        return {
          error: {
            code: "STORAGE_NOT_CONFIGURED",
            message:
              "Cloudflare R2 storage is required (STORAGE_DRIVER=r2) but R2 credentials are incomplete.",
          },
        };
      }

      if (r2) {
        const key = buildR2ObjectKey(filename, r2.keyPrefix);
        const uploaded = await uploadObjectToR2(r2, {
          key,
          body: bytes,
          contentType: detected.mime,
        });
        if (!uploaded.ok) {
          set.status = 502;
          return {
            error: {
              code: "STORAGE_UPLOAD_FAILED",
              message: uploaded.error,
            },
          };
        }

        const displayUrl = r2.publicUrl
          ? buildR2PublicUrl(r2.publicUrl, key)
          : `/api/v1/uploads/${filename}`;

        set.status = 201;
        return {
          url: displayUrl,
          filename,
          key,
          storage: "r2" as const,
          mime: detected.mime,
          size: bytes.byteLength,
        };
      }

      fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      const targetPath = path.join(UPLOAD_DIR, filename);
      fs.writeFileSync(targetPath, bytes);

      set.status = 201;
      return {
        url: `/api/v1/uploads/${filename}`,
        filename,
        storage: "local" as const,
        mime: detected.mime,
        size: bytes.byteLength,
      };
    },
    {
      body: t.Object({
        file: t.File(),
      }),
      detail: {
        summary: "Upload a market cover image (PNG, JPEG, WEBP, GIF up to 5 MB)",
        tags: ["Media"],
      },
    },
  )
  .get(
    "/api/v1/uploads/:filename",
    async ({ params, set }) => {
      if (!SAFE_FILENAME_RE.test(params.filename)) {
        set.status = 400;
        return { error: { code: "INVALID_FILENAME", message: "Invalid image filename" } };
      }

      const ext = params.filename.split(".").pop()?.toLowerCase() ?? "png";
      const fallbackMime = EXT_TO_MIME[ext] ?? "application/octet-stream";

      const r2 = getR2Config();
      if (r2) {
        const key = buildR2ObjectKey(params.filename, r2.keyPrefix);
        const remote = await getObjectFromR2(r2, key);
        if (remote.ok) {
          const headers: Record<string, string> = {
            "Content-Type": remote.contentType || fallbackMime,
            "Cache-Control": "public, max-age=31536000, immutable",
            "X-Content-Type-Options": "nosniff",
          };
          if (remote.etag) headers.ETag = remote.etag;
          return new Response(Buffer.from(remote.bytes), {
            status: 200,
            headers,
          });
        }
      }

      const filePath = path.join(UPLOAD_DIR, params.filename);
      if (!fs.existsSync(filePath)) {
        set.status = 404;
        return { error: { code: "NOT_FOUND", message: "Image not found" } };
      }

      const bytes = fs.readFileSync(filePath);

      return new Response(bytes, {
        status: 200,
        headers: {
          "Content-Type": fallbackMime,
          "Cache-Control": "public, max-age=31536000, immutable",
          "X-Content-Type-Options": "nosniff",
        },
      });
    },
    {
      params: t.Object({
        filename: t.String(),
      }),
      detail: {
        summary: "Serve an uploaded market cover image",
        tags: ["Media"],
      },
    },
  );
