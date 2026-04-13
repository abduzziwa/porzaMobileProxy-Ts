// import type { Request, Response } from "express";
// import pgClient from "../services/db.js";

// export async function appEvent(req: Request, res: Response): Promise<Response> {
//   try {
//     const { uniqueDeviceId, event } = req.body as {
//       uniqueDeviceId: string;
//       event: "app_open" | "app_close";
//     };

//     if (!uniqueDeviceId) {
//       return res.status(400).json({ success: false, error: "Missing uniqueDeviceId" });
//     }
//     if (event !== "app_open" && event !== "app_close") {
//       return res.status(400).json({ success: false, error: "event must be app_open or app_close" });
//     }

//     const column = event === "app_open" ? "open_count" : "close_count";

//     const result = await pgClient.query(
//       `UPDATE app_user_state
//        SET ${column} = COALESCE(${column}, 0) + 1,
//            last_updated_at = NOW()
//        WHERE unique_device_id = $1
//        RETURNING open_count, close_count, last_updated_at`,
//       [uniqueDeviceId]
//     );

//     if (result.rows.length === 0) {
//       return res.status(404).json({ success: false, error: "User state not found" });
//     }

//     const { open_count, close_count, last_updated_at } = result.rows[0];

//     console.log(`[AppEvent] ${event} for ${uniqueDeviceId} — opens: ${open_count}, closes: ${close_count}`);

//     return res.status(200).json({
//       success: true,
//       event,
//       open_count,
//       close_count,
//       last_updated_at,
//     });
//   } catch (err) {
//     console.error("[AppEvent] Error:", (err as Error).message);
//     return res.status(500).json({ success: false, error: "Internal server error" });
//   }
// }


import type { Request, Response } from "express";
import pgClient from "../services/db.js";

export async function appEvent(req: Request, res: Response): Promise<Response> {
  try {
    const { uniqueDeviceId, event } = req.body as {
      uniqueDeviceId: string;
      event: "app_open" | "app_close";
    };

    if (!uniqueDeviceId) {
      return res.status(400).json({ success: false, error: "Missing uniqueDeviceId" });
    }
    if (event !== "app_open" && event !== "app_close") {
      return res.status(400).json({ success: false, error: "event must be app_open or app_close" });
    }

    const column = event === "app_open" ? "open_count" : "close_count";
    const isLive = event === "app_open";

    const result = await pgClient.query(
      `UPDATE app_user_state
       SET ${column} = COALESCE(${column}, 0) + 1,
           is_live = $2,
           last_updated_at = NOW()
       WHERE unique_device_id = $1
       RETURNING open_count, close_count, last_updated_at`,
      [uniqueDeviceId, isLive]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: "User state not found" });
    }

    const { open_count, close_count, last_updated_at } = result.rows[0];

    console.log(`[AppEvent] ${event} for ${uniqueDeviceId} — opens: ${open_count}, closes: ${close_count}`);

    return res.status(200).json({
      success: true,
      event,
      open_count,
      close_count,
      last_updated_at,
    });
  } catch (err) {
    console.error("[AppEvent] Error:", (err as Error).message);
    return res.status(500).json({ success: false, error: "Internal server error" });
  }
}