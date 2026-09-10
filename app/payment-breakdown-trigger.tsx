"use client";
import { useState } from "react";
import { formatMoney, formatDate, type PaymentPeriod } from "@/lib/portal/model";
import PortalDialog from "./portal-dialog";

export default function PaymentBreakdownTrigger({ projectName, period }: { projectName: string; period: PaymentPeriod }) {
  const [open, setOpen] = useState(false);
  return <>
    <button type="button" className="secondary-button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>View breakdown</button>
    <PortalDialog open={open} onClose={() => setOpen(false)} title="Payment breakdown" description={projectName + " · " + period.label + " · " + (period.currency ?? "Currency unavailable")}>
      {period.issues.length ? <div className="notice warning"><p>These payment details need review. Unconfirmed amounts are not displayed.</p><ul>{period.issues.map(issue => <li key={issue}>{issue}</li>)}</ul></div> : <>
        <dl className="payment-totals"><div><dt>Net payable</dt><dd>{formatMoney(period.payable, period.currency)}</dd></div><div><dt>Sent</dt><dd>{formatMoney(period.paid, period.currency)}</dd></div><div><dt>Not yet sent</dt><dd>{formatMoney(period.pending, period.currency)}</dd></div></dl>
        <div className="payment-lines">{period.lines.map(line => <section key={line.key}>
          <div className="payment-line-heading"><h3>{line.label}</h3><strong>{formatMoney(line.amount, line.currency)}</strong></div>
          <dl className="detail-list">
            <div><dt>Status</dt><dd>{line.status}</dd></div>
            <div><dt>Quantity</dt><dd>{line.quantity ?? "Unavailable"}</dd></div>
            <div><dt>Rate</dt><dd>{formatMoney(line.rateAmount, line.rateCurrency)}</dd></div>
            {line.grossAmount !== null && <div><dt>Before TDS</dt><dd>{formatMoney(line.grossAmount, line.currency)}</dd></div>}
            {line.tdsAmount !== null && <div><dt>TDS deducted</dt><dd>{formatMoney(line.tdsAmount, line.currency)}</dd></div>}
            <div><dt>Transfer date</dt><dd>{line.status === "Sent" ? formatDate(line.paidOn) : "Not sent"}</dd></div>
          </dl>
          {line.details.length > 0 && <ul className="component-details">{line.details.map(detail => <li key={detail.key}><span>{detail.label}</span><span>{detail.quantity ?? "Quantity unavailable"} × {formatMoney(detail.rateAmount, detail.rateCurrency)}</span></li>)}</ul>}
        </section>)}</div>
      </>}
    </PortalDialog>
  </>;
}
