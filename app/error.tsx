"use client";

import { useEffect, useRef } from "react";

export default function ErrorPage({ retry }: {
  error: Error & { digest?: string }; retry: () => void;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { heading.current?.focus(); }, []);
  return <main id="main-content" className="login-main">
    <section className="panel empty-state">
      <h1 ref={heading} tabIndex={-1}>We could not load your dashboard.</h1>
      <p>Your information has not been changed. Please try again. If this continues, contact support.</p>
      <p><button type="button" onClick={retry} className="primary-button">Try again</button></p>
      <p><a className="text-link" href="mailto:faisal@crossinghurdles.com">Contact support</a></p>
    </section>
  </main>;
}
