export function MaintenanceScreen() {
  return (
    <main className="maintenance-screen grain" role="alert" aria-live="polite">
      <div className="maintenance-screen__inner">
        <p className="maintenance-screen__eyebrow">NOCTURNE</p>
        <h1 className="maintenance-screen__title">Salon fermé</h1>
        <p className="maintenance-screen__lead">
          Maintenance en cours — aucune mise ni synchronisation wallet pour le moment.
        </p>
        <p className="maintenance-screen__sub">On revient très vite. Merci de votre patience.</p>
      </div>
    </main>
  );
}
