import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { Bindings, Variables } from "../../env";
import { chooseModelRequest, setMarksRequest } from "./schema";
import {
  getBench,
  getBenchFile,
  getBenchTally,
  getReaderState,
  listBench,
  postBench,
  postBenchRead,
  postReaderModel,
  putBenchMarks,
} from "./handler";

type Env = { Bindings: Bindings; Variables: Variables };

const invalid = (result: { success: boolean }, c: { json: (b: unknown, s: 400) => Response }) => {
  if (!result.success) return c.json({ success: false, error: { code: "VALIDATION_ERROR" } }, 400);
};

/* Pure router (constitution III; receipt-reader-tuning D18), mounted at
   /platform/reader by routes/platform, behind that file's
   `requireSession, requirePlatformOperator`. */
export const readerOperatorRoute = new Hono<Env>();

readerOperatorRoute.get("/", (c) => getReaderState(c));
readerOperatorRoute.post("/model", zValidator("json", chooseModelRequest, invalid), (c) =>
  postReaderModel(c, c.req.valid("json").modelId),
);

readerOperatorRoute.post("/bench", (c) => postBench(c));
readerOperatorRoute.get("/bench", (c) => listBench(c, c.req.query("cursor")));
/* Declared before `/bench/:id`, which would otherwise take "tally" as an id */
readerOperatorRoute.get("/bench/tally", (c) => getBenchTally(c));
readerOperatorRoute.get("/bench/:id", (c) => getBench(c, c.req.param("id")));
readerOperatorRoute.get("/bench/:id/file", (c) => getBenchFile(c, c.req.param("id")));
readerOperatorRoute.post("/bench/:id/read", (c) => postBenchRead(c, c.req.param("id")));
readerOperatorRoute.put("/bench/readings/:readingId/marks", zValidator("json", setMarksRequest, invalid), (c) =>
  putBenchMarks(c, c.req.param("readingId"), c.req.valid("json").marks),
);
