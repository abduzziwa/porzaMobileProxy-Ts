import type { Request, Response } from "express";
import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const TYPESENSE_BASE_URL = process.env.TYPESENSE_BASE_URL || "https://typesense.accept.corenio.com";
const TYPESENSE_API_KEY = process.env.TYPESENSE_API_KEY || "dummy";
const TYPESENSE_HASH = process.env.TYPESENSE_HASH || "";
const TYPESENSE_CID = process.env.TYPESENSE_CID || "120";

interface TypesenseHit {
  document: {
    id: string;
    title_en?: string;
    title_nl?: string;
    productnumber?: string;
    image_thumb_url?: string;
    seourl?: string;
    categories?: string[];
    eancode?: string;
  };
}

interface TypesenseResponse {
  found: number;
  hits: TypesenseHit[];
}

interface SearchResult {
  id: string;
  name: string;
  sku: string;
  ean: string;
  categories: string[];
  image: string;
  seourl: string;
}

export async function v3Search(req: Request, res: Response): Promise<Response> {
  const { query, language = "en", page = 1, per_page = 20 } = req.body as {
    query?: string;
    language?: string;
    page?: number;
    per_page?: number;
  };

  if (!query || query.trim().length < 2) {
    return res.status(400).json({ error: "Query must be at least 2 characters" });
  }

  try {
    const response = await axios.get<TypesenseResponse>(
      `${TYPESENSE_BASE_URL}/collections/products/documents/search`,
      {
        params: {
          q: query.trim(),
          query_by: language === "nl"
            ? "title_nl,title_en,usagenumbers.usagenumber,productnumber,configurations,eancode,categories,brand,connected_cars.manufacturer,connected_cars.car_model,connected_cars.car_model_short,oenumbers.oenumber"
            : "title_en,title_nl,usagenumbers.usagenumber,productnumber,configurations,eancode,categories,brand,connected_cars.manufacturer,connected_cars.car_model,connected_cars.car_model_short,oenumbers.oenumber",
          include_fields: "id,seourl,title_en,title_nl,productnumber,eancode,categories,image_thumb_url",
          filter_by: "published:=true",
          per_page,
          page,
          hash: TYPESENSE_HASH,
          cid: TYPESENSE_CID,
          timeout_seconds: 3,
        },
        headers: {
          "x-typesense-api-key": TYPESENSE_API_KEY,
          accept: "application/json",
        },
      }
    );

    const { found, hits } = response.data;

    const results: SearchResult[] = hits.map((hit) => {
      const doc = hit.document;
      const name = language === "nl"
        ? (doc.title_nl || doc.title_en || "")
        : (doc.title_en || doc.title_nl || "");

      return {
        id: doc.id,
        name,
        sku: doc.productnumber || "",
        ean: doc.eancode || "",
        categories: doc.categories || [],
        image: doc.image_thumb_url || "",
        seourl: doc.seourl || "",
      };
    });

    return res.json({ success: true, total: found, page, results });
  } catch (err) {
    console.error("[v3Search] Error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}
