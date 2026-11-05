const CHANNEL_NAMES: Record<string, string> = {
  "github-popular": "全站热门（不限年份）",
  "github-active-popular": "近期活跃热门（不限年份）",
  "github-trending-daily": "GitHub 官方日榜",
  "github-trending-weekly": "GitHub 官方周榜",
  "github-recent-established": "近期创建成熟项目",
  "early-candidate": "早期候选",
  "new-low-star": "早期项目（旧规则）",
  recent: "近期创建项目（旧规则）",
  "active-small": "活跃小项目（旧规则）",
};

export const discoveryChannelLabel = (channel: string): string => {
  if (CHANNEL_NAMES[channel]) return CHANNEL_NAMES[channel];
  if (/^(?:github-archive-|archive-|established-|active-established-)/.test(channel)) return `历史分片（${channel.slice(-4)}年）`;
  return "其他发现渠道";
};
