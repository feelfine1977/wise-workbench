import { expect, it } from "vitest";
import { http as mockHttp, HttpResponse } from "msw";
import { server } from "@/mocks/node";
import { normSignalQuery } from "./norms";
import { makeTestQueryClient } from "@/test/utils";

it("fetches scoped norm evidence using a cancellable request", async () => {
  server.use(mockHttp.get("*/projects/preview/norms/v/signals/c", ({ request }) => HttpResponse.json({ query: new URL(request.url).searchParams.get("selectionId") })));
  const client = makeTestQueryClient();
  await expect(client.fetchQuery(normSignalQuery("preview", "v", "ct", "c", "cohort"))).resolves.toEqual({ query: "cohort" });
});
