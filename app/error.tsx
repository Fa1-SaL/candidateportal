"use client";

import { useEffect } from "react";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex min-h-[calc(100vh-94px)] items-center justify-center bg-[#fcf8ff] px-5 py-10 text-[#1b1b24]">
      <section className="w-full max-w-[520px] rounded-[15px] border border-[#e2e1e8] bg-white p-8 text-center shadow-[0px_1px_3px_rgba(0,0,0,0.02),0px_10px_20px_rgba(0,0,0,0.04)]">
        <p className="text-[12px] font-semibold uppercase leading-[16px] text-[#625f72]">
          Candidate Portal
        </p>
        <h1 className="mt-3 text-[22px] font-bold leading-[28px]">
          We could not load your dashboard.
        </h1>
        <p className="mt-3 text-[14px] leading-[20px] text-[#625f72]">
          Your information has not been changed. Please try loading it again.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-5 h-[38px] rounded-[7px] bg-[#3525cd] px-5 text-[13px] font-semibold leading-[18px] text-white transition-colors hover:bg-[#271baa] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6257dd]/45 focus-visible:ring-offset-2"
        >
          Try again
        </button>
      </section>
    </main>
  );
}
