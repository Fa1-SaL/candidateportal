type PaymentTerm = {
  id: string;
  label: string;
  amount: number | null;
  minimum_amount: number | null;
  maximum_amount: number | null;
  currency: string | null;
  unit: string | null;
  is_specified: boolean;
  display_order: number;
};

type FallbackTerm = {
  label: string;
  value: string;
};

function formatCurrency(amount: number, currency: string | null) {
  const resolvedCurrency = currency ?? "INR";
  const locale = resolvedCurrency === "INR" ? "en-IN" : "en-US";

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: resolvedCurrency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function formatTermValue(term: PaymentTerm) {
  if (!term.is_specified) {
    return "Not specified yet";
  }

  let value = "Not available";

  if (term.amount != null) {
    value = formatCurrency(term.amount, term.currency);
  } else if (term.minimum_amount != null && term.maximum_amount != null) {
    value = `${formatCurrency(term.minimum_amount, term.currency)} - ${formatCurrency(term.maximum_amount, term.currency)}`;
  }

  return term.unit && value !== "Not available" ? `${value} / ${term.unit}` : value;
}

export default function PaymentStructure({
  terms,
  fallbackTerm,
}: {
  terms: PaymentTerm[];
  fallbackTerm: FallbackTerm;
}) {
  const visibleTerms = terms.length
    ? terms
    : [
      {
        id: "fallback",
        label: fallbackTerm.label,
        value: fallbackTerm.value,
      },
    ];

  return (
    <section className="rounded-[20px] border border-[#e2e1e8] bg-white p-[24px] shadow-[0px_1px_3px_rgba(0,0,0,0.02),0px_10px_20px_rgba(0,0,0,0.04)] transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-[2px] hover:border-[#c7c4d8] hover:shadow-[0px_3px_8px_rgba(0,0,0,0.035),0px_16px_30px_rgba(0,0,0,0.06)] sm:rounded-[15px] sm:p-[18px] sm:hover:-translate-y-[1.5px]">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 text-[#464555]">
          <svg aria-hidden="true" viewBox="0 0 24 24" className="size-[21px] shrink-0 fill-none stroke-current stroke-[2] sm:size-[19px]" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="7" width="18" height="10" rx="2" />
            <circle cx="12" cy="12" r="2.5" />
            <path d="M6 10v4M18 10v4" />
          </svg>
          <h2 className="text-[12px] font-semibold uppercase leading-[15px] tracking-[0.05em] sm:text-[11px] sm:leading-[12px]">
            Payment Structure
          </h2>
        </div>
        <span className="shrink-0 text-[12px] font-medium leading-[15px] text-[#5f5d6d] sm:text-[11px] sm:leading-[12px]">
          Project terms
        </span>
      </div>
      <div className="mt-[18px] grid gap-x-[24px] md:grid-cols-2 sm:mt-[14px] sm:gap-x-[18px]">
        {visibleTerms.map((term, index) => {
          const value = "value" in term ? term.value : formatTermValue(term);

          return (
            <div
              key={term.id}
              className={
                "flex min-w-0 items-baseline justify-between gap-4 border-t border-[#eeedf2] py-[12px] first:border-t-0 first:pt-0 sm:py-[10px] " +
                (index === 1 ? "md:border-t-0 md:pt-0" : "")
              }
            >
              <p className="min-w-0 text-[14px] font-medium leading-[20px] text-[#464555] sm:text-[12px] sm:leading-[17px]">
                {term.label}
              </p>
              <p className="shrink-0 text-right text-[15px] font-semibold leading-[20px] text-[#1b1b24] sm:text-[13px] sm:leading-[18px]">
                {value}
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
