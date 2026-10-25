import type { Route } from './navigation';

export const regions = [[4, '游戏'], [36, '知识'], [188, '科技'], [160, '生活'], [3, '音乐'], [1, '动画'], [211, '美食'], [181, '影视']] as const;
export const cinemaTypes = [[1, '番剧'], [2, '电影'], [3, '纪录片'], [4, '国创'], [5, '电视剧'], [7, '综艺']] as const;
export const browseTabs: Partial<Record<Route, [string, string][]>> = {
  bilibili: [['recommend', 'App 推荐'], ['dynamic', '关注动态'], ['regions', '分区浏览']],
  cinema: [['cinema', '发现影视'], ['followingCinema', '我的追番追剧']],
  mine: [['watchlater', '稍后再看'], ['favorites', 'B 站收藏'], ['history', 'B 站历史'], ['localHistory', '本机历史'], ['queue', '播放队列']],
};
