import type { OpenTarget } from '../shared/types';

/**
 * 抖音创作者中心入口 URL。
 *
 * 全部集中在这里，改版时只改这一个文件。
 *
 * ⚠️ 目前**只放已验证可用的地址**。发布页 `creator-micro/content/upload` 尚未在本机实测确认，
 * 因此尚未加进来 —— 宁可少一个按钮，也不留一个必然 404 的入口。
 * 待 S5 用真实浏览器确认后再补 `upload` 目标。
 */
export const CREATOR_HOME = 'https://creator.douyin.com/';

export function urlForTarget(_target: OpenTarget): string {
  return CREATOR_HOME;
}
