import "./maintenance.css";
import Link from "next/link";

export default function Maintenance() {
  return <div className="portal-shell maintenance-shell">
    <header className="dashboard-header">
      <div className="dashboard-header-inner">
        <Link className="dashboard-brand" href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/crossing-hurdles-logo.png" alt="Crossing Hurdles Logo" width="40" height="40" />
          <span>Candidate Portal</span>
        </Link>
      </div>
    </header>
    <main id="main-content" className="maintenance-main">
      <div className="maintenance-content">
        <span className="maintenance-badge">Maintenance</span>
        <h1>The candidate portal is currently under maintenance.</h1>
        <p className="maintenance-copy">We&apos;re working on the portal. Please check back soon.</p>
        <iframe
          className="maintenance-game"
          src="/dino/index.html"
          title="Dinosaur runner game"
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
        />
      </div>
    </main>
  </div>;
}
