export interface Channel {
  id: string;
  name: string;
  category: string;
  logo: string;
}

export interface StreamSource {
  url: string;
  label: string;
  kind: 'default' | 'alt';
  playPath: string;
  weight?: number;
}

export interface StreamInfo {
  id: string;
  name: string | null;
  url: string;
  type: 'hls' | 'mp4';
  referer: string;
  playPath?: string;
  sources?: StreamSource[];
}
