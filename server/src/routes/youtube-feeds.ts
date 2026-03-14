import { z } from "zod";
import { getYouTubeAdapter } from "../sources/factory.js";
import { createSourceFeedRouter } from "./source-feed-router.js";

const discoverSchema = z.object({
  url: z.string().trim().min(1, "请输入有效的 YouTube URL"),
});

const createYouTubeFeedSchema = z.object({
  channelId: z
    .string()
    .trim()
    .regex(/^UC[a-zA-Z0-9_-]{22}$/, "channelId 格式不正确"),
  title: z.string().min(1),
  logoUrl: z.string().optional(),
});

export const youtubeFeedsRouter = createSourceFeedRouter({
  adapter: getYouTubeAdapter(),
  discoverSchema,
  createSchema: createYouTubeFeedSchema,
  sourceType: "youtube",
  logPrefix: "[youtube]",
  duplicateError: "该频道已订阅",
});
