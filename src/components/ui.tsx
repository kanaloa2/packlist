import { Link } from 'react-router-dom';
import type { ReactNode } from 'react';

export function Thumb({ photo, icon, size = 'md', alt = '' }: { photo?: string; icon: string; size?: 'sm' | 'md' | 'lg'; alt?: string }) {
  return photo ? (
    <img className={`thumb thumb-${size}`} src={photo} alt={alt} loading="lazy" />
  ) : (
    <span className={`thumb thumb-${size} thumb-icon`} aria-hidden>
      {icon}
    </span>
  );
}

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="crumbs" aria-label="Breadcrumb">
      {items.map((c, i) => (
        <span key={i} className="crumb">
          {c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
          {i < items.length - 1 && <span className="crumb-sep">›</span>}
        </span>
      ))}
    </nav>
  );
}

/** Detail page header: optional hero photo, title, subtitle, description and actions. */
export function Hero({
  photo,
  icon,
  kicker,
  title,
  subtitle,
  description,
  actions,
}: {
  photo?: string;
  icon: string;
  kicker?: string;
  title: string;
  subtitle?: ReactNode;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <section className={`hero${photo ? ' hero-photo' : ''}`}>
      {photo && <img src={photo} alt="" className="hero-img" />}
      <div className="hero-content">
        {!photo && (
          <span className="hero-icon" aria-hidden>
            {icon}
          </span>
        )}
        <div className="hero-text">
          {kicker && <p className="kicker">{kicker}</p>}
          <h1>{title}</h1>
          {subtitle && <p className="hero-sub">{subtitle}</p>}
        </div>
      </div>
      {(description || actions) && (
        <div className="hero-footer">
          {description && <p className="description">{description}</p>}
          {actions && <div className="hero-actions">{actions}</div>}
        </div>
      )}
    </section>
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon" aria-hidden>
        {icon}
      </div>
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}

export function SectionHeader({ title, count, action }: { title: string; count?: number; action?: ReactNode }) {
  return (
    <div className="section-header">
      <h2>
        {title}
        {count !== undefined && <span className="count">{count}</span>}
      </h2>
      {action}
    </div>
  );
}

export function NotFound({ what }: { what: string }) {
  return (
    <Empty icon="🧭" title={`${what} not found`}>
      <Link className="btn btn-secondary" to="/">
        Back to trips
      </Link>
    </Empty>
  );
}

export function ProgressBar({ percent, label }: { percent: number; label?: string }) {
  return (
    <div className="progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
      <div className="progress-fill" style={{ width: `${percent}%` }} />
    </div>
  );
}
