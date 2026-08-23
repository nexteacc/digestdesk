export type AiLeaderVideo = {
  slug: string;
  person: string;
  organization: string;
  titleZh: string;
  titleEn: string;
  descriptionZh: string;
  descriptionEn: string;
  thumbnailUrl: string;
  youtubeUrl: string;
  duration: string;
  publishedAt: string;
  takeawaysZh: string[];
  takeawaysEn: string[];
};

export const AI_LEADER_VIDEOS: AiLeaderVideo[] = [
  {
    slug: "sam-altman",
    person: "Sam Altman",
    organization: "OpenAI",
    titleZh: "Sam Altman 谈 AGI、算力与人的主动性",
    titleEn: "Sam Altman on AGI, compute, and human agency",
    descriptionZh: "从 AGI 时间线、算力约束到人的主动性，这场访谈集中呈现了 Altman 对下一阶段智能体与基础设施的判断。",
    descriptionEn: "A focused conversation on AGI timelines, compute constraints, human agency, and the infrastructure behind the next generation of agents.",
    thumbnailUrl: "https://i.ytimg.com/vi/XDB5beon4DY/maxresdefault.jpg",
    youtubeUrl: "https://www.youtube.com/watch?v=XDB5beon4DY",
    duration: "56:00",
    publishedAt: "2026-07-28",
    takeawaysZh: [
      "AGI 的判断不能只看模型能力，还要看推理可靠性、记忆与持续行动能力。",
      "算力仍然是产品和研究扩张的现实边界，基础设施投入决定能力释放的速度。",
      "更强的智能体不会消除人的主动性，反而要求人更清晰地表达目标、约束与价值判断。",
    ],
    takeawaysEn: [
      "AGI should be judged by reasoning reliability, memory, and sustained action, not model capability alone.",
      "Compute remains a practical boundary for research and product expansion, making infrastructure a decisive factor.",
      "More capable agents increase the value of clear human goals, constraints, and judgment rather than removing agency.",
    ],
  },
  {
    slug: "boris-cherny",
    person: "Boris Cherny",
    organization: "Anthropic",
    titleZh: "Boris Cherny 谈 Claude Code 与软件开发的新边界",
    titleEn: "Boris Cherny on Claude Code and the new edge of software development",
    descriptionZh: "Claude Code 的负责人解释代理式编程如何改变开发节奏，以及团队应当如何重新理解工具、安全与工程责任。",
    descriptionEn: "The Claude Code lead explains how agentic coding changes development cadence and the balance between tooling, safety, and engineering responsibility.",
    thumbnailUrl: "https://i.ytimg.com/vi/7C_IHWkHKmU/maxresdefault.jpg",
    youtubeUrl: "https://www.youtube.com/watch?v=7C_IHWkHKmU",
    duration: "1:10:00",
    publishedAt: "2026-08-08",
    takeawaysZh: [
      "代理式编程的核心不是更快地补全代码，而是把更完整的工程任务交给模型执行。",
      "安全边界必须进入开发工作流本身，不能只依赖任务完成后的人工检查。",
      "开发者的角色会更多转向目标拆解、约束定义和结果验证。",
    ],
    takeawaysEn: [
      "Agentic coding is about delegating complete engineering tasks, not merely completing code faster.",
      "Safety boundaries need to be embedded in the workflow rather than deferred to a final human check.",
      "Developers will spend more time decomposing goals, defining constraints, and verifying outcomes.",
    ],
  },
  {
    slug: "michael-truell",
    person: "Michael Truell",
    organization: "Cursor",
    titleZh: "Michael Truell 谈 Cursor 的产品方向与长期代码代理",
    titleEn: "Michael Truell on Cursor's product direction and long-running coding agents",
    descriptionZh: "Cursor 联合创始人讨论代码编辑器如何演化为长期运行的工程代理，以及产品团队如何在速度与可控性之间取舍。",
    descriptionEn: "Cursor's co-founder discusses the editor's evolution toward long-running engineering agents and the tradeoff between speed and control.",
    thumbnailUrl: "https://i.ytimg.com/vi/fWa7uxyhVDE/maxresdefault.jpg",
    youtubeUrl: "https://www.youtube.com/watch?v=fWa7uxyhVDE",
    duration: "27:00",
    publishedAt: "2026-08-15",
    takeawaysZh: [
      "代码编辑器正在从交互式工具转向可以持续执行任务的工作环境。",
      "代理的价值取决于它能否理解代码库上下文并稳定处理长链路任务。",
      "产品体验的关键是让用户始终看得见代理正在做什么，并能在必要时接管。",
    ],
    takeawaysEn: [
      "Code editors are evolving from interactive tools into environments that can execute work continuously.",
      "Agent value depends on repository context and reliable handling of long, multi-step tasks.",
      "The product must keep agent work legible and make human takeover easy whenever it is needed.",
    ],
  },
];

export function getAiLeaderVideo(slug: string) {
  return AI_LEADER_VIDEOS.find((video) => video.slug === slug);
}
