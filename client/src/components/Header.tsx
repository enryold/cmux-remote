interface HeaderProps {
  title: string;
  onBack?(): void;
  onLogout?(): void;
}

export function Header({ title, onBack, onLogout }: HeaderProps) {
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
      {onLogout ? (
        <button aria-label="Log out" onClick={onLogout} type="button">
          Log out
        </button>
      ) : (
        <span className="header-spacer" />
      )}
    </header>
  );
}
