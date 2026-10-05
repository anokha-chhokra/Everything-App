// Turns a pasted YouTube link into a safe embed URL.
// Only YouTube is accepted, and only IDs matching strict patterns.

import { bad } from './validate.js';

const YT_VIDEO = /^[A-Za-z0-9_-]{11}$/;
const YT_LIST = /^[A-Za-z0-9_-]{10,64}$/;
const YT_HOSTS = ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtube-nocookie.com'];

export function parseMusicUrl(input) {
  if (typeof input !== 'string' || !input.trim()) throw bad('Paste a YouTube link');
  let url;
  try {
    url = new URL(input.trim());
  } catch {
    throw bad('That does not look like a link');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw bad('That does not look like a web link');
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const parts = url.pathname.split('/').filter(Boolean);

  if (host !== 'youtu.be' && !YT_HOSTS.includes(host)) throw bad('Only YouTube links are supported');

  let video = null;
  let list = url.searchParams.get('list');
  if (host === 'youtu.be') video = parts[0] || null;
  else if (parts[0] === 'watch') video = url.searchParams.get('v');
  else if (['embed', 'shorts', 'live', 'v'].includes(parts[0])) video = parts[1] || null;
  else if (parts[0] === 'playlist') video = null;
  else throw bad('That YouTube link is not a video or playlist');

  if (video && !YT_VIDEO.test(video)) video = null;
  if (list && !YT_LIST.test(list)) list = null;
  if (!video && !list) throw bad('Could not find a video or playlist in that YouTube link');
  return youtube(video, list);
}

function youtube(video, list) {
  const base = 'https://www.youtube-nocookie.com/embed/';
  const embedUrl = video
    ? `${base}${video}${list ? `?list=${list}` : ''}`
    : `${base}videoseries?list=${list}`;
  const url = video
    ? `https://www.youtube.com/watch?v=${video}${list ? `&list=${list}` : ''}`
    : `https://www.youtube.com/playlist?list=${list}`;
  return {
    provider: 'youtube',
    kind: video ? 'video' : 'playlist',
    url,
    embedUrl,
    defaultLabel: video ? (list ? 'YouTube video + playlist' : 'YouTube video') : 'YouTube playlist',
  };
}
