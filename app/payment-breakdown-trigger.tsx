"use client";

import { useEffect, useId, useState } from "react";

export type PaymentDetail = {
  key: string;
  label: string;
  quantity: number | null;
  rateAmount: number | null;
  rateCurrency: string | null;
};

export type PaymentBreakdownLine = {
  key: string;
  label: string;
  amount: number;
  currency: string;
  status: string | null;
  paidOn: string | null;
  quantity: number | null;
  rateAmount: number | null;
  rateCurrency: string | null;
  grossAmount: number | null;
  tdsAmount: number | null;
  details: PaymentDetail[];
};

function formatCurrency(amount: number | null, currency = "INR") {
  if (amount == null) return "Not available";

  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatDate(value: string | null) {
  if (!value) return "Not available";
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) return "Not available";

  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatStatus(value: string | null) {
  if (!value) return "Not available";
  return value.replace(/[_-]/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function PaymentIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-[21px] shrink-0 fill-none stroke-current stroke-[2] text-[#137333] sm:size-[18px]"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="7" width="18" height="10" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 10v4M18 10v4" />
    </svg>
  );
}

export default function PaymentBreakdownTrigger({
  projectName,
  total,
  currency,
  lines,
  children,
}: {
  projectName: string;
  total: number;
  currency: string;
  lines: PaymentBreakdownLine[];
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        className="block w-full rounded-[9px] text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6257dd]/40"
        onClick={() => setOpen(true)}
      >
        {children}
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(27,27,36,0.28)] p-[16px] backdrop-blur-[1px]"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="flex max-h-[min(680px,calc(100vh-32px))] w-full max-w-[500px] flex-col overflow-hidden rounded-[12px] border border-[#e2e1e8] bg-white shadow-[0px_18px_50px_rgba(27,27,36,0.18)]"
          >
            <header className="flex items-start justify-between border-b border-[#e2e1e8] px-[20px] py-[18px] sm:px-[22px]">
              <div>
                <p className="text-[11px] font-semibold uppercase leading-[14px] tracking-[0.05em] text-[#625f72]">
                  {projectName}
                </p>
                <h2 id={titleId} className="mt-[3px] text-[20px] font-semibold leading-[26px] text-[#1b1b24]">
                  Payment Breakdown
                </h2>
              </div>
              <button
                type="button"
                aria-label="Close payment breakdown"
                autoFocus
                className="inline-flex size-[32px] items-center justify-center rounded-full text-[24px] leading-none text-[#625f72] transition-colors hover:bg-[#f5f2ff] hover:text-[#3525cd] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6257dd]/40"
                onClick={() => setOpen(false)}
              >
                <span aria-hidden="true">&times;</span>
              </button>
            </header>

            <div className="overflow-y-auto px-[20px] py-[18px] sm:px-[22px]">
              <div className="flex items-center justify-between rounded-[9px] bg-[#f5f2ff] px-[16px] py-[14px]">
                <div className="flex items-center gap-[10px] text-[#137333]">
                  <PaymentIcon />
                  <span className="text-[12px] font-semibold uppercase leading-[15px] tracking-[0.05em] text-[#464555]">
                    Total Final Amount
                  </span>
                </div>
                <strong className="text-[20px] font-bold leading-[25px] text-[#3525cd]">
                  {formatCurrency(total, currency)}
                </strong>
              </div>

              <div className="mt-[14px] divide-y divide-[#e2e1e8] rounded-[9px] border border-[#e2e1e8]">
                {lines.map((line) => (
                  <div key={line.key} className="px-[15px] py-[14px]">
                    <div className="flex items-start justify-between gap-[16px]">
                      <div className="min-w-0">
                        <p className="break-words text-[15px] font-semibold leading-[20px] text-[#1b1b24]">
                          {line.label}
                        </p>
                        {line.quantity != null && line.rateAmount != null ? (
                          <p className="mt-[3px] text-[12px] leading-[17px] text-[#625f72]">
                            {line.quantity} &times; {formatCurrency(line.rateAmount, line.rateCurrency ?? "INR")}
                          </p>
                        ) : null}
                      </div>
                      <strong className="shrink-0 text-[16px] font-semibold leading-[21px] text-[#1b1b24]">
                        {formatCurrency(line.amount, line.currency)}
                      </strong>
                    </div>

                    {line.details.length ? (
                      <div className="mt-[10px] space-y-[6px] rounded-[7px] bg-[#faf9fc] px-[10px] py-[8px]">
                        {line.details.map((detail) => (
                          <div key={detail.key} className="flex items-center justify-between gap-[12px] text-[12px] leading-[17px] text-[#625f72]">
                            <span>{detail.label}</span>
                            <span className="text-right font-medium text-[#464555]">
                              {detail.quantity ?? 0} &times; {formatCurrency(detail.rateAmount, detail.rateCurrency ?? "INR")}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : null}

                    <div className="mt-[10px] grid grid-cols-2 gap-x-[14px] gap-y-[5px] text-[11px] leading-[16px] text-[#625f72]">
                      <span>Status</span>
                      <span className="text-right font-medium text-[#464555]">{formatStatus(line.status)}</span>
                      {line.grossAmount != null ? (
                        <>
                          <span>Payable before TDS</span>
                          <span className="text-right font-medium text-[#464555]">{formatCurrency(line.grossAmount, line.currency)}</span>
                        </>
                      ) : null}
                      {line.tdsAmount != null ? (
                        <>
                          <span>TDS deducted</span>
                          <span className="text-right font-medium text-[#464555]">{formatCurrency(line.tdsAmount, line.currency)}</span>
                        </>
                      ) : null}
                      <span>Amount sent date</span>
                      <span className="text-right font-medium text-[#464555]">{formatDate(line.paidOn)}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
