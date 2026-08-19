import { Link } from 'react-router-dom';
import type { Channel } from '../types';
import { logoUrl, prefetchStream, watchPath } from '../lib/api';

export default function ChannelCard({ channel }: { channel: Channel }) {
  return (
    <Link
      to={watchPath(channel)}
      className="anime-card"
      onMouseEnter={() => prefetchStream(channel.id)}
      onFocus={() => prefetchStream(channel.id)}
    >
      <div className="channel-card-poster">
        <img src={logoUrl(channel.logo)} alt={channel.name} loading="lazy" />
        <div className="anime-card-overlay">
          <span className="play-btn">▶</span>
        </div>
        <span className="anime-card-badge">Live</span>
      </div>
      <div className="anime-card-info">
        <h3>{channel.name}</h3>
        {channel.category && <span className="anime-card-year">{channel.category}</span>}
      </div>
    </Link>
  );
}
