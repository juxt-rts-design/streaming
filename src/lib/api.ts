import type { Channel, StreamInfo } from '../types';

async function request<T>(url: string, noCache = false): Promise<T> {
  const response = await fetch(url, noCache ? { cache: 'no-store' } : undefined);
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error((data as { error?: string }).error || `Erreur ${response.status}`);
  }
  return response.json();
}

export function getChannels(category?: string, query?: string) {
  const params = new URLSearchParams();
  if (category && category !== 'all') params.set('category', category);
  if (query) params.set('q', query);
  const suffix = params.toString() ? `?${params}` : '';
  return request<{ channels: Channel[]; categories: string[] }>(`/api/channels${suffix}`);
}

export function resolveStream(id: string) {
  return request<StreamInfo>(`/api/stream/${id}?_=${Date.now()}`, true);
}

export function toPlayableUrl(stream: StreamInfo): string {
  if (stream.playPath) return stream.playPath;
  const params = new URLSearchParams({
    url: stream.url,
    referer: stream.referer,
  });
  return `/api/proxy?${params}`;
}

const prefetchKeys = new Set<string>();

export function prefetchStream(id: string) {
  if (!id || prefetchKeys.has(id)) return;
  prefetchKeys.add(id);
  void resolveStream(id).catch(() => {
    prefetchKeys.delete(id);
  });
}

export function watchPath(channel: Pick<Channel, 'id'>) {
  return `/watch/${channel.id}`;
}

export function logoUrl(url: string) {
  if (!url) return '/placeholder.svg';
  return url;
}
