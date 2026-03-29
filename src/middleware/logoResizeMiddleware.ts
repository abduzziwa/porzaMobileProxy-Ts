import type { Request, Response, NextFunction } from "express";
import path from "path";
import fs from "fs";
import sharp from "sharp";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const LOGO_SIZE = 100; // px — change this one value to resize all logos
const LOGO_DIR = path.resolve(__dirname, "../../src/public/carlogos/thumb");

/**
 * Middleware: serve car logo PNGs resized to a fixed square.
 *
 * Mount BEFORE express.static so this handler intercepts logo requests:
 *   app.use("/public/carlogos/thumb", logoResizeMiddleware);
 *   app.use("/public", express.static(path.join(__dirname, "public")));
 */
export async function logoResizeMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // req.params[0] contains the filename when mounted with a wildcard,
    // but when mounted as a prefix Express sets req.path.
    const filename = path.basename(req.path);

    // Only handle .png files
    if (!filename.endsWith(".png")) {
      next();
      return;
    }

    const filePath = path.join(LOGO_DIR, filename);

    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Logo not found" });
      return;
    }

    const buffer = await sharp(filePath)
      .resize(LOGO_SIZE, LOGO_SIZE, {
        fit: "contain",
        // Transparent background so the logo shape is preserved
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    res.set("Content-Type", "image/png");
    // Cache aggressively — same slug always produces the same output
    res.set("Cache-Control", "public, max-age=86400");
    res.send(buffer);
  } catch (err) {
    console.error("[logoResizeMiddleware] Error:", (err as Error).message);
    next(err);
  }
}
