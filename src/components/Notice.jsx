export default function Notice({ tone = "info", children, onDismiss }) {
  return (
    <div className={`notice notice-${tone}`} role={tone === "error" ? "alert" : "status"}>
      <span>{children}</span>
      {onDismiss && <button className="btn-text" onClick={onDismiss} aria-label="Dismiss">Dismiss</button>}
    </div>
  );
}
