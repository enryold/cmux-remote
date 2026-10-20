interface HeaderProps {
  title: string;
  onBack?(): void;
  onLogout?(): void;
  onNew?(): void;
  onClose?(): void;
  busy?: boolean;
}

export function Header({ title, onBack, onLogout, onNew, onClose, busy }: HeaderProps) {
  return (
    <header className="app-header">
      {onBack ? (
        <button aria-label="Back" onClick={onBack} type="button">
          ‹
        </button>
      ) : (
        <span className="header-spacer" />
      )}
      <strong>{title}</strong>
      {onNew || onClose ? <div className="header-actions">
        {onNew ? <button type="button" title="New terminal" aria-label="New terminal" disabled={busy} onClick={onNew}><svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></svg></button> : null}
        {onClose ? <button type="button" aria-label="Close tab" disabled={busy} onClick={onClose}><svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75"><path d="m6 6 12 12M6 18 18 6" /></svg></button> : null}
      </div> : onLogout ? (
        <button aria-label="Log out" onClick={onLogout} type="button">
          Log out
        </button>
      ) : (
        <span className="header-spacer" />
      )}
    </header>
  );
}
