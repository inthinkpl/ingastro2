export default function PageHeader({ eyebrow, title, description, actions }) {
  return (
    <div className="flex items-start justify-between gap-6">
      <div>
        {eyebrow && (
          <div className="text-[10px] uppercase tracking-[0.2em] text-blue-400 mb-2">{eyebrow}</div>
        )}
        <h1 className="font-display text-3xl font-semibold tracking-tight" data-testid="page-title">{title}</h1>
        {description && <p className="text-sm text-muted-foreground mt-1">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}
