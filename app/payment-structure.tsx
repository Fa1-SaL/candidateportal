import { formatMoney, type PaymentTerm } from "@/lib/portal/model";
export default function PaymentStructure({ terms }: { terms: PaymentTerm[] }) {
  return <section><h3>Payment terms</h3>{terms.length ? <dl className="detail-list">{terms.map(term => <div key={term.id}>
    <dt>{term.label}</dt><dd>{!term.is_specified ? "Not specified" : term.amount !== null ? formatMoney(term.amount, term.currency) : term.minimum_amount !== null && term.maximum_amount !== null ? formatMoney(term.minimum_amount, term.currency) + " – " + formatMoney(term.maximum_amount, term.currency) : "Unavailable"}{term.is_specified && term.unit ? " / " + term.unit : ""}</dd>
  </div>)}</dl> : <p className="secondary-text">Verified payment terms are not available yet.</p>}</section>;
}
