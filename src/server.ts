// import express, {
//   type Request,
//   type Response,
//   type NextFunction,
// } from "express";
// import morgan from "morgan";
// import homeRoutes from "./routes/homeRoutes.js";
// import cors from "cors";
// import path from "path";
// import { fileURLToPath } from "url";

// const app = express();

// app.use(cors());
// app.use(express.json());
// app.use(cors({ origin: "*" }));

// const __filename = fileURLToPath(import.meta.url);
// const __dirname = path.dirname(__filename);

// // Serve static files from the project root (one level up from dist/src)
// const projectRoot = path.resolve(__dirname, "../");
// console.log("projectRoot :" + projectRoot);
// app.use(express.static(projectRoot));

// // Serve car logos at /public/carlogos/
// app.use("/public", express.static(path.join(projectRoot, "src/public")));

// // Intercept response for logging
// app.use((req: Request, res: Response, next: NextFunction) => {
//   const oldSend = res.send.bind(res);
//   res.send = function (body: unknown) {
//     console.log("Request/Response Log:", {
//       method: req.method,
//       url: req.url,
//       body: req.body,
//       response: body,
//     });
//     return oldSend(body);
//   };
//   next();
// });

// app.use(morgan("dev"));

// app.get("/", (req: Request, res: Response) => {
//   const safeRequestInfo = {
//     method: req.method,
//     url: req.url,
//     originalUrl: req.originalUrl,
//     path: req.path,
//     hostname: req.hostname,
//     protocol: req.protocol,
//     ip: req.ip,
//     ips: req.ips,
//     query: req.query,
//     params: req.params,
//     headers: {
//       "user-agent": req.headers["user-agent"],
//       accept: req.headers["accept"],
//       "accept-language": req.headers["accept-language"],
//       "accept-encoding": req.headers["accept-encoding"],
//       host: req.headers["host"],
//       referer: req.headers["referer"] || req.headers["referrer"],
//       connection: req.headers["connection"],
//       "sec-ch-ua": req.headers["sec-ch-ua"],
//       "sec-ch-ua-platform": req.headers["sec-ch-ua-platform"],
//       "sec-fetch-site": req.headers["sec-fetch-site"],
//       "sec-fetch-mode": req.headers["sec-fetch-mode"],
//       "sec-fetch-user": req.headers["sec-fetch-user"],
//       "sec-fetch-dest": req.headers["sec-fetch-dest"],
//     },
//     cookies:
//       (req as Request & { cookies?: Record<string, unknown> }).cookies || {},
//   };

//   console.log("Full Safe Request Info for /:", safeRequestInfo);
//   res.sendFile(path.join(projectRoot, "danger.html"));
// });

// app.use("/", homeRoutes);

// app.listen(3000, "0.0.0.0", () => {
//   console.log("Server running on port 3000");
// });

import express, {
  type Request,
  type Response,
} from "express";
import morgan from "morgan";
import homeRoutes from "./routes/homeRoutes.js";
import v3Routes from "./routes/v3Routes.js";
import v3ImagesRoutes from "./routes/v3Images.js";
import v3InternalNotificationsRoutes from "./routes/v3InternalNotifications.js";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";
import { logoResizeMiddleware } from "./middleware/logoResizeMiddleware.js";
import { v3RequestLogger } from "./middleware/v3RequestLoggerMiddleware.js";
import { scheduleFiltersWarmup } from "./jobs/v3FiltersWarmupJob.js";
import { scheduleAccountPurge } from "./jobs/v3AccountPurgeJob.js";

const app = express();

app.use(cors());
app.use(express.json());
app.use(cors({ origin: "*" }));

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Serve static files from the project root (one level up from dist/src)
const projectRoot = path.resolve(__dirname, "../");
console.log("projectRoot :" + projectRoot);
app.use(express.static(projectRoot));

// Intercept logo requests and resize to fixed square BEFORE static middleware
app.use("/public/carlogos/thumb", logoResizeMiddleware);

// Serve car logos at /public/carlogos/
app.use("/public", express.static(path.join(projectRoot, "src/public")));

// Intercept response for logging (redacts sensitive routes — see v3RequestLoggerMiddleware.ts)
app.use(v3RequestLogger);

app.use(morgan("dev"));

app.get("/", (req: Request, res: Response) => {
  const safeRequestInfo = {
    method: req.method,
    url: req.url,
    originalUrl: req.originalUrl,
    path: req.path,
    hostname: req.hostname,
    protocol: req.protocol,
    ip: req.ip,
    ips: req.ips,
    query: req.query,
    params: req.params,
    headers: {
      "user-agent": req.headers["user-agent"],
      accept: req.headers["accept"],
      "accept-language": req.headers["accept-language"],
      "accept-encoding": req.headers["accept-encoding"],
      host: req.headers["host"],
      referer: req.headers["referer"] || req.headers["referrer"],
      connection: req.headers["connection"],
      "sec-ch-ua": req.headers["sec-ch-ua"],
      "sec-ch-ua-platform": req.headers["sec-ch-ua-platform"],
      "sec-fetch-site": req.headers["sec-fetch-site"],
      "sec-fetch-mode": req.headers["sec-fetch-mode"],
      "sec-fetch-user": req.headers["sec-fetch-user"],
      "sec-fetch-dest": req.headers["sec-fetch-dest"],
    },
    cookies:
      (req as Request & { cookies?: Record<string, unknown> }).cookies || {},
  };

  console.log("Full Safe Request Info for /:", safeRequestInfo);
  res.sendFile(path.join(projectRoot, "danger.html"));
});

app.use("/", v3ImagesRoutes);
app.use("/", v3InternalNotificationsRoutes);
app.use("/", homeRoutes);
app.use("/", v3Routes);

app.listen(3000, "0.0.0.0", () => {
  console.log("Server running on port 3000");
  scheduleFiltersWarmup();
  scheduleAccountPurge();
});
