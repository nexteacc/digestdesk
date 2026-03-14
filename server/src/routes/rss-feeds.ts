import { z } from "zod";
import { getRssAdapter } from "../sources/factory.js";
import { createSourceFeedRouter } from "./source-feed-router.js";

const discoverSchema = z.object({
  url: z.string().trim().min(1, "请输入有效的 URL"),
});

const createRssFeedSchema = z.object({
  feedUrl: z.string().url(),
  siteUrl: z.string().url(),
  title: z.string().min(1),
  description: z.string().optional(),
  logoUrl: z.string().optional(),
  authorName: z.string().optional(),
});

export const rssFeedsRouter = createSourceFeedRouter({
  adapter: getRssAdapter(),
  discoverSchema,
  createSchema: createRssFeedSchema,
  sourceType: "rss",
  logPrefix: "[rss]",
});
