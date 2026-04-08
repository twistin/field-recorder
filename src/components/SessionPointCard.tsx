import { MapPin } from 'lucide-react';
import { format } from 'date-fns';
import { es } from 'date-fns/locale';

export interface SessionPointCardItem {
  id: string;
  placeName: string;
  createdAt: string;
  observedWeather: string;
  zoomTakeReference: string;
  microphoneSetup: string;
  tags: string[];
  photoPreviewUrl?: string;
}

export function SessionPointCard({
  point,
  active,
  onSelect,
}: {
  point: SessionPointCardItem;
  active: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={`panel point-card flex w-full flex-col gap-4 p-5 text-left transition ${
        active ? 'is-active' : ''
      }`}
    >
      {point.photoPreviewUrl ? (
        <img
          src={point.photoPreviewUrl}
          alt={`Foto de ${point.placeName}`}
          className="point-card__image h-44 w-full object-cover"
        />
      ) : null}

      <div className="point-card__header">
        <div>
          <p className="display-heading text-2xl text-[color:var(--ink)]">{point.placeName}</p>
          <p className="mt-2 text-sm text-[color:var(--muted)]">
            {format(new Date(point.createdAt), 'd MMM yyyy · HH:mm:ss', { locale: es })}
          </p>
        </div>
        <span className="point-card__status">{active ? 'Ficha abierta' : 'Abrir'}</span>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="soft-card">
          <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.28em] text-[color:var(--muted)]">
            <MapPin className="h-4 w-4 text-[color:var(--ember)]" />
            Clima
          </div>
          <p className="mt-2 text-sm text-[color:var(--ink)]">{point.observedWeather || 'Sin dato'}</p>
        </div>
        <div className="soft-card">
          <p className="eyebrow text-[color:var(--muted)]">Referencia Zoom H6</p>
          <p className="mt-2 text-sm text-[color:var(--ink)]">{point.zoomTakeReference || 'Sin referencia'}</p>
          <p className="mt-2 text-sm text-[color:var(--muted)]">{point.microphoneSetup || 'Sin setup'}</p>
        </div>
      </div>

      {point.tags.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {point.tags.map((tag) => (
            <span key={tag} className="tag-pill">
              {tag}
            </span>
          ))}
        </div>
      ) : null}
    </button>
  );
}
