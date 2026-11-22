'use strict';
const DEFAULT_VIDEO = Object.freeze({bootEnabled: true, bootSound: true, backgroundEnabled: true, strength: 60});
function normalizeVideo(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  return {
    bootEnabled: typeof value.bootEnabled === 'boolean' ? value.bootEnabled : DEFAULT_VIDEO.bootEnabled,
    bootSound: typeof value.bootSound === 'boolean' ? value.bootSound : DEFAULT_VIDEO.bootSound,
    backgroundEnabled: typeof value.backgroundEnabled === 'boolean' ? value.backgroundEnabled : DEFAULT_VIDEO.backgroundEnabled,
    strength: Number.isFinite(value.strength) ? Math.round(Math.max(0, Math.min(100, value.strength))) : DEFAULT_VIDEO.strength,
  };
}
function updateVideo(current, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('无效的视频设置');
  for (const [key, value] of Object.entries(patch)) {
    if (!(Object.hasOwn(DEFAULT_VIDEO, key)) || (key === 'strength' ? !Number.isFinite(value) || value < 0 || value > 100 : typeof value !== 'boolean')) throw new Error('无效的视频设置');
  }
  return normalizeVideo({...normalizeVideo(current), ...patch});
}
module.exports = {DEFAULT_VIDEO, normalizeVideo, updateVideo};
