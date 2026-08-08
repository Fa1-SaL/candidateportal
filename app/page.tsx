import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

type Candidate = {
  id: string;
  email: string;
  full_name: string | null;
};

type Assignment = {
  id: string;
  candidate_id: string;
  subproject_id: string;
  domain: string | null;
  remofirst_status: string | null;
  contract_status: string | null;
  rate_amount: number | null;
  rate_currency: string | null;
  rate_unit: string | null;
  last_seen_at: string;
  updated_at: string;
  is_offboarded_heuristic: boolean;
  has_flagged_task: boolean;
  source_sheet: string | null;
  source_row: number | null;
};

type BackgroundVerification = {
  id_status: string | null;
  updated_at: string;
};

type TaskMetrics = {
  submitted: number | null;
  accepted: number | null;
  rejected: number | null;
  rework: number | null;
};

type Payment = {
  amount: number | null;
  currency: string | null;
  status: string | null;
  paid_on: string | null;
};

type NamedRecord = {
  id: string;
  display_name: string;
};

type Subproject = NamedRecord & {
  vertical_id: string;
  active: boolean;
};

type Vertical = NamedRecord & {
  client_id: string;
};

function formatStatus(value: string | boolean | null | undefined) {
  if (typeof value === "boolean") {
    return value ? "Yes" : "No";
  }

  if (!value) {
    return "Not available";
  }

  return value
    .replace(/[_-]/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatBinaryStatus(
  value: string | boolean | null | undefined,
  positiveValues: string[],
  positiveLabel = "Verified",
  negativeLabel = "Not Verified",
) {
  if (typeof value === "boolean") {
    return value ? positiveLabel : negativeLabel;
  }

  if (!value) {
    return negativeLabel;
  }

  const normalized = value.toLowerCase().replace(/[_-]/g, " ").trim();
  return positiveValues.includes(normalized) ? positiveLabel : negativeLabel;
}

function formatCurrency(amount: number | null | undefined, currency?: string | null) {
  if (amount == null) {
    return "Not available";
  }

  const resolvedCurrency = currency ?? "USD";
  const locale = resolvedCurrency === "INR" ? "en-IN" : "en-US";

  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: resolvedCurrency,
    maximumFractionDigits: 2,
  }).format(amount);
}

function getRateParts(assignment: Assignment) {
  if (assignment.rate_amount == null) {
    return {
      amount: "Not available",
      unit: "",
    };
  }

  return {
    amount: formatCurrency(assignment.rate_amount, assignment.rate_currency),
    unit: assignment.rate_unit ? " / " + assignment.rate_unit : "",
  };
}

function projectDetailsFallback(assignment: Assignment) {
  const text = [
    assignment.source_sheet,
    assignment.subproject_id,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const projects = [
    { key: "rainier", label: "Rainier", vertical: "STEM" },
    { key: "riga", label: "Riga", vertical: "Coding" },
    { key: "sequoia", label: "Sequoia", vertical: "Coding" },
    { key: "starfish", label: "Starfish", vertical: "STEM" },
  ];

  const project = projects.find(({ key }) => text.includes(key));

  return {
    clientName: "Snorkel",
    verticalName: project?.vertical ?? null,
    projectName: project?.label ?? null,
  };
}

function MaterialIcon({
  name,
  className = "",
  fill = false,
}: {
  name: string;
  className?: string;
  fill?: boolean;
}) {
  const paths: Record<string, React.ReactNode> = {
    person: (
      <>
        <circle cx="12" cy="8" r="3.25" />
        <path d="M5 20c.8-3.8 3.2-5.75 7-5.75s6.2 1.95 7 5.75" />
      </>
    ),
    mail: (
      <>
        <rect x="3" y="5" width="18" height="14" rx="2" />
        <path d="m4 7 8 6 8-6" />
      </>
    ),
    business: (
      <>
        <path d="M4 21V5h10v16" />
        <path d="M14 9h6v12" />
        <path d="M7 8h3M7 12h3M7 16h3M17 13h1M17 17h1" />
      </>
    ),
    category: (
      <>
        <path d="m12 3 4 7H8l4-7Z" />
        <rect x="4" y="14" width="6" height="6" rx="1.5" />
        <circle cx="17" cy="17" r="3" />
      </>
    ),
    description: (
      <>
        <path d="M6 3h8l4 4v14H6V3Z" />
        <path d="M14 3v5h5M9 12h6M9 16h6" />
      </>
    ),
    verified_user: (
      <>
        <path d="M12 3 5 6v5c0 4.4 2.8 8.4 7 10 4.2-1.6 7-5.6 7-10V6l-7-3Z" />
        <path d="m8.8 12.1 2.1 2.1 4.4-4.6" />
      </>
    ),
    gpp_maybe: (
      <>
        <path d="M12 3 5 6v5c0 4.4 2.8 8.4 7 10 4.2-1.6 7-5.6 7-10V6l-7-3Z" />
        <path d="M12 8v5" />
        <path d="M12 16.5h.01" />
      </>
    ),
    task_alt: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="m8.5 12.4 2.2 2.2 4.8-5.2" />
      </>
    ),
    build: (
      <path d="M22.61 18.99 13.8 10.18c.93-2.34.45-5.1-1.44-6.99-2.07-2.07-5.15-2.42-7.57-1.04l4.06 4.06-2.83 2.83-4.18-3.94C.46 7.52.81 10.6 2.88 12.67c1.89 1.89 4.65 2.37 6.99 1.44l8.81 8.81c.39.39 1.03.39 1.42 0l2.48-2.48c.42-.38.42-1.02.03-1.45Z" />
    ),
    pending_actions: (
      <>
        <path d="M17 3H7c-1.1 0-2 .9-2 2v16l4-4h8c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2Zm-1 10H8v-2h8v2Zm0-3H8V8h8v2Z" />
        <path d="M19 15.2c-2.11 0-3.8 1.69-3.8 3.8s1.69 3.8 3.8 3.8 3.8-1.69 3.8-3.8-1.69-3.8-3.8-3.8Zm.4 4.01 1.7 1.01-.6.98-2.3-1.4V17h1.2v2.21Z" />
      </>
    ),
    payments: (
      <>
        <rect x="3" y="7" width="18" height="10" rx="2" />
        <circle cx="12" cy="12" r="2.5" />
        <path d="M6 10v4M18 10v4" />
      </>
    ),
    schedule: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
  };

  if (name === "fiber_manual_record") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={"inline-block size-[1em] shrink-0 fill-current " + className}>
        <circle cx="12" cy="12" r="6" />
      </svg>
    );
  }

  if (name === "check_circle") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={"inline-block size-[1em] shrink-0 fill-current " + className}>
        <circle cx="12" cy="12" r="10" />
        <path d="m7.5 12.4 2.8 2.8 6.2-6.5" className="fill-none stroke-white" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  if (name === "cancel") {
    return (
      <svg aria-hidden="true" viewBox="0 0 24 24" className={"inline-block size-[1em] shrink-0 fill-current " + className}>
        <circle cx="12" cy="12" r="10" />
        <path d="m8.5 8.5 7 7M15.5 8.5l-7 7" className="fill-none stroke-white" strokeWidth="2.4" strokeLinecap="round" />
      </svg>
    );
  }

  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className={
        "inline-block size-[1em] shrink-0 " +
        (fill ? "fill-current stroke-0 " : "fill-none stroke-current stroke-[2] ") +
        className
      }
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name] ?? paths.category}
    </svg>
  );
}

function VerificationBadge({ verified }: { verified: boolean }) {
  if (verified) {
    return (
      <span className="inline-flex h-[25px] w-[96px] items-center justify-center gap-[6px] rounded-full bg-[#e6f4ea] text-[13px] font-semibold leading-[16px] tracking-[0.04em] text-[#137333] sm:h-[19px] sm:w-[80px] sm:text-[11px] sm:leading-[14px]">
        <MaterialIcon name="check_circle" className="text-[18px] sm:text-[14px]" fill />
        Verified
      </span>
    );
  }

  return (
    <span className="inline-flex h-[40px] w-[112px] items-center justify-center gap-[7px] rounded-full bg-[#ffdad6] text-[13px] font-semibold leading-[16px] tracking-[0.04em] text-[#ba1a1a] sm:h-[33px] sm:w-[95px] sm:text-[11px] sm:leading-[14px]">
      <MaterialIcon name="cancel" className="text-[18px] sm:text-[14px]" fill />
      <span className="flex flex-col leading-[16px] sm:leading-[14px]">
        <span>Not</span>
        <span>Verified</span>
      </span>
    </span>
  );
}

function Card({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "rounded-[20px] border border-[#e2e1e8] bg-white p-[24px] shadow-[0px_1px_3px_rgba(0,0,0,0.02),0px_10px_20px_rgba(0,0,0,0.04)] transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-[2px] hover:border-[#c7c4d8] hover:shadow-[0px_3px_8px_rgba(0,0,0,0.035),0px_16px_30px_rgba(0,0,0,0.06)] sm:rounded-[15px] sm:p-[18px] sm:hover:-translate-y-[1.5px] " +
        className
      }
    >
      {children}
    </div>
  );
}

function Label({
  icon,
  children,
}: {
  icon: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 text-[#464555]">
      <MaterialIcon name={icon} className="text-[21px] sm:text-[19px]" />
      <span className="text-[12px] font-semibold uppercase leading-[15px] tracking-[0.05em] sm:text-[11px] sm:leading-[12px]">
        {children}
      </span>
    </div>
  );
}

function InfoCard({
  icon,
  label,
  value,
  subvalue,
  className = "",
}: {
  icon: string;
  label: string;
  value: string;
  subvalue?: string | null;
  className?: string;
}) {
  return (
    <Card className={"flex flex-col justify-center gap-[16px] sm:gap-[12px] " + className}>
      <Label icon={icon}>{label}</Label>
      <div className="min-w-0">
        <p className="break-words text-[18px] font-semibold leading-[24px] text-[#1b1b24] sm:text-[17px] sm:leading-[21px]">
          {value}
        </p>
        {subvalue ? (
          <p className="mt-[6px] break-words text-[14px] font-normal leading-[20px] text-[#464555] sm:mt-[4px] sm:text-[13px] sm:leading-[18px]">
            {subvalue}
          </p>
        ) : null}
      </div>
    </Card>
  );
}

function StatusChip({
  tone,
  label,
  icon,
}: {
  tone: "success" | "error" | "primary" | "neutral" | "warning";
  label: string;
  icon?: string;
}) {
  const tones = {
    success: "bg-[#e6f4ea] text-[#137333]",
    error: "bg-[#ffdad6] text-[#ba1a1a]",
    primary: "bg-[#e2dfff] text-[#3525cd]",
    neutral: "bg-[#f0ecf9] text-[#464555]",
    warning: "bg-[#fff4d6] text-[#9a6700]",
  } as const;

  return (
    <span
      className={
        "inline-flex h-[31px] items-center gap-[8px] rounded-full px-[13px] text-[15px] font-medium leading-[19px] tracking-normal sm:h-[26px] sm:gap-[6px] sm:px-[11px] sm:text-[14px] sm:leading-[17px] " +
        tones[tone]
      }
    >
      {icon ? <MaterialIcon name={icon} className="text-[16px] sm:text-[12px]" fill /> : null}
      {label}
    </span>
  );
}

function VerificationCard({
  icon,
  label,
  value,
  verified,
  primary = false,
}: {
  icon: string;
  label: string;
  value: string;
  verified: boolean;
  primary?: boolean;
}) {
  return (
    <Card className="flex h-[145px] flex-col justify-between gap-4 sm:h-[109px] sm:gap-3">
      <Label icon={icon}>{label}</Label>
      <div className="flex items-center justify-between gap-3">
        <p className="max-w-[112px] text-[18px] font-semibold leading-[24px] text-[#1b1b24] sm:max-w-[84px] sm:text-[17px] sm:leading-[21px]">
          {value}
        </p>
        {primary && verified ? (
          <span className="inline-flex h-[19px] w-[80px] items-center justify-center gap-[5px] rounded-full bg-[#e2dfff] text-[11px] font-semibold leading-[14px] tracking-[0.04em] text-[#3525cd]">
            Verified
          </span>
        ) : (
          <VerificationBadge verified={verified} />
        )}
      </div>
    </Card>
  );
}

function MetricTile({
  icon,
  value,
  label,
  tone,
  wide = false,
}: {
  icon: string;
  value: number;
  label: string;
  tone: "primary" | "success" | "error" | "warning" | "neutral";
  wide?: boolean;
}) {
  const iconColors = {
    primary: "text-[#3525cd]",
    success: "text-[#137333]",
    error: "text-[#ba1a1a]",
    warning: "text-[#f9ab00]",
    neutral: "text-[#777587]",
  } as const;

  return (
    <div
      className={
        "flex h-[154px] flex-col items-center justify-center gap-[7px] rounded-xl bg-[#f5f2ff] p-4 text-center transition-[transform,box-shadow,background-color] duration-200 ease-out hover:-translate-y-[2px] hover:bg-[#f0ecff] hover:shadow-[0px_8px_18px_rgba(53,37,205,0.08)] sm:h-[116px] sm:gap-[5px] sm:rounded-[9px] sm:p-3 " +
        (wide ? "col-span-2" : "")
      }
    >
      {wide ? null : (
        <MaterialIcon
          name={icon}
          className={"text-[28px] sm:text-[24px] " + iconColors[tone]}
          fill={icon === "build" || icon === "pending_actions"}
        />
      )}
      <p className="text-[28px] font-bold leading-[34px] text-[#1b1b24] sm:text-[26px] sm:leading-[30px]">{value}</p>
      <p className="text-[13px] font-normal leading-[18px] text-[#464555] sm:text-[12px] sm:leading-[17px]">{label}</p>
    </div>
  );
}

function PaymentInfo({
  icon,
  label,
  value,
  tone,
}: {
  icon: string;
  label: string;
  value: string;
  tone: "success" | "warning" | "neutral";
}) {
  const iconColors = {
    success: "text-[#137333]",
    warning: "text-[#f9ab00]",
    neutral: "text-[#777587]",
  } as const;

  return (
    <div className="h-[86px] rounded-xl border border-[#e2e1e8] bg-white px-[20px] py-[15px] transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-[2px] hover:border-[#c7c4d8] hover:shadow-[0px_8px_18px_rgba(0,0,0,0.045)] sm:h-[65px] sm:rounded-[9px] sm:px-[15px] sm:py-[11px]">
      <p className="text-[14px] font-semibold uppercase leading-[16px] tracking-[0.05em] text-[#464555] sm:text-[11px] sm:leading-[12px]">
        {label}
      </p>
      <div className="mt-[9px] flex items-center gap-[10px] sm:mt-[7px] sm:gap-[8px]">
        <MaterialIcon name={icon} className={"text-[21px] sm:text-[18px] " + iconColors[tone]} />
        <p className="break-words text-[17px] font-semibold leading-[22px] text-[#1b1b24] sm:text-[15px] sm:leading-[19px]">
          {value}
        </p>
      </div>
    </div>
  );
}

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user?.email) {
    redirect("/login");
  }

  const { data: candidate } = await supabase
    .from("candidates")
    .select("id,email,full_name")
    .eq("email", user.email)
    .maybeSingle<Candidate>();

  if (!candidate) {
    return (
      <main className="min-h-screen bg-[#fcf8ff] px-5 py-10 text-[#1b1b24] md:px-10">
        <section className="mx-auto max-w-3xl rounded-[20px] border border-[#c7c4d8]/40 bg-white p-8 shadow-[0px_1px_3px_rgba(0,0,0,0.02),0px_10px_20px_rgba(0,0,0,0.04)]">
          <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[#464555]">
            Candidate Portal
          </p>
          <h1 className="mt-3 text-3xl font-bold text-[#1b1b24]">
            We could not find your candidate profile.
          </h1>
          <p className="mt-4 text-[#464555]">
            You are signed in as {user.email}. Ask Crossing Hurdles support to
            confirm this email exists in the candidate source sheet.
          </p>
        </section>
      </main>
    );
  }

  const { data: assignments } = await supabase
    .from("assignments")
    .select(
      "id,candidate_id,subproject_id,domain,remofirst_status,contract_status,rate_amount,rate_currency,rate_unit,last_seen_at,updated_at,is_offboarded_heuristic,has_flagged_task,source_sheet,source_row",
    )
    .eq("candidate_id", candidate.id)
    .eq("is_offboarded_heuristic", false)
    .order("last_seen_at", { ascending: false })
    .limit(1)
    .returns<Assignment[]>();

  const assignment = assignments?.[0] ?? null;

  if (!assignment) {
    return (
      <main className="min-h-screen bg-[#fcf8ff] px-5 py-10 text-[#1b1b24] md:px-10">
        <section className="mx-auto max-w-3xl rounded-[20px] border border-[#c7c4d8]/40 bg-white p-8 shadow-[0px_1px_3px_rgba(0,0,0,0.02),0px_10px_20px_rgba(0,0,0,0.04)]">
          <p className="text-xs font-semibold uppercase tracking-[0.05em] text-[#464555]">
            Candidate Portal
          </p>
          <h1 className="mt-3 text-3xl font-bold text-[#1b1b24]">
            Hi {candidate.full_name ?? candidate.email}
          </h1>
          <p className="mt-4 text-[#464555]">
            There is no active assignment connected to your profile right now.
          </p>
        </section>
      </main>
    );
  }

  const { data: subproject } = await supabase
    .from("subprojects")
    .select("id,vertical_id,display_name,active")
    .eq("id", assignment.subproject_id)
    .maybeSingle<Subproject>();

  const { data: vertical } = !subproject?.vertical_id
    ? { data: null }
    : await supabase
      .from("verticals")
      .select("id,client_id,display_name")
      .eq("id", subproject.vertical_id)
      .maybeSingle<Vertical>();

  const { data: client } = !vertical?.client_id
    ? { data: null }
    : await supabase
      .from("clients")
      .select("id,display_name")
      .eq("id", vertical.client_id)
      .maybeSingle<NamedRecord>();

  const { data: subprojectByText } =
    subproject || !assignment.source_sheet
      ? { data: null }
      : await supabase
        .from("subprojects")
        .select("id,vertical_id,display_name,active")
        .ilike("display_name", `%${assignment.source_sheet}%`)
        .maybeSingle<Subproject>();

  const resolvedSubproject = subproject ?? subprojectByText;

  const { data: verticalByText } = resolvedSubproject?.vertical_id && !vertical
    ? await supabase
      .from("verticals")
      .select("id,client_id,display_name")
      .eq("id", resolvedSubproject.vertical_id)
      .maybeSingle<Vertical>()
    : { data: null };

  const resolvedVertical = vertical ?? verticalByText;

  const { data: clientByText } = resolvedVertical?.client_id && !client
    ? await supabase
      .from("clients")
      .select("id,display_name")
      .eq("id", resolvedVertical.client_id)
      .maybeSingle<NamedRecord>()
    : { data: null };

  const resolvedClient = client ?? clientByText;

  const [
    { data: backgroundVerification },
    { data: taskMetrics },
    { data: payments },
  ] = await Promise.all([
    supabase
      .from("background_verification")
      .select("id_status,updated_at")
      .eq("candidate_id", candidate.id)
      .maybeSingle<BackgroundVerification>(),
    supabase
      .from("task_metrics")
      .select("submitted,accepted,rejected,rework")
      .eq("assignment_id", assignment.id)
      .order("as_of", { ascending: false })
      .limit(1)
      .maybeSingle<TaskMetrics>(),
    supabase
      .from("payments")
      .select("amount,currency,status,paid_on")
      .eq("assignment_id", assignment.id)
      .order("period_end", { ascending: false, nullsFirst: false })
      .order("created_at", { ascending: false })
      .returns<Payment[]>(),
  ]);

  const assignmentStatus = assignment.is_offboarded_heuristic ? "Offboarded" : "Active";
  const fallbackProjectDetails = projectDetailsFallback(assignment);
  const clientName = resolvedClient?.display_name ?? fallbackProjectDetails.clientName;
  const verticalName = resolvedVertical?.display_name ?? fallbackProjectDetails.verticalName ?? "Not available";
  const projectName = resolvedSubproject?.display_name ?? fallbackProjectDetails.projectName ?? "Not available";
  const disbursedPayments =
    payments?.filter((payment) => payment.status?.toLowerCase() === "disbursed") ??
    [];
  const totalDisbursed = disbursedPayments.reduce(
    (total, payment) => total + (payment.amount ?? 0),
    0,
  );
  const paymentCurrency = disbursedPayments[0]?.currency ?? payments?.[0]?.currency ?? "INR";
  const latestPaymentStatus = payments?.[0]?.status
    ? formatStatus(payments[0].status)
    : "Not available";
  const springVerifyStatus = formatBinaryStatus(backgroundVerification?.id_status, [
    "done",
    "verified",
    "approved",
  ]);
  const remofirstStatus = formatBinaryStatus(assignment.remofirst_status, [
    "approved",
    "verified",
  ]);
  const contractStatus = formatBinaryStatus(
    assignment.contract_status,
    ["signed"],
    "Signed",
    "Not Signed",
  );
  const contractSigned = contractStatus === "Signed";
  const springVerified = springVerifyStatus === "Verified";
  const remofirstVerified = remofirstStatus === "Verified";
  const taskEvaluationPending = Math.max(
    (taskMetrics?.submitted ?? 0) -
    (taskMetrics?.accepted ?? 0) -
    (taskMetrics?.rejected ?? 0) -
    (taskMetrics?.rework ?? 0),
    0,
  );
  const rate = getRateParts(assignment);
  const candidateName = candidate.full_name ?? "Not available";

  return (
    <div className="min-h-[844px] overflow-x-hidden bg-[#fcf8ff] text-[#1b1b24] sm:min-h-screen 2xl:min-h-[1080px]">
      <nav className="relative z-[2] h-[80px] bg-[rgba(252,248,255,0.8)] shadow-[0px_1px_2px_rgba(0,0,0,0.05)] backdrop-blur-[6px] sm:h-[60px]">
        <div className="mx-auto flex h-[80px] w-full max-w-[390px] items-center justify-between px-[20px] sm:h-[60px] sm:max-w-[960px] sm:px-[30px] 2xl:max-w-[1380px]">
          <div className="flex min-w-0 items-center gap-[16px] sm:gap-[12px]">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="Crossing Hurdles Logo"
              className="h-[40px] w-[40px] shrink-0 rounded-[6px] object-cover sm:h-[30px] sm:w-[30px] sm:rounded-[5px]"
              src="/crossing-hurdles-logo.png"
            />
            <span className="truncate text-[18px] font-semibold leading-[26px] text-[#3525cd] sm:text-[15px] sm:leading-[21px]">
              Candidate Portal
            </span>
          </div>
          <div className="group relative ml-4 shrink-0">
            <button
              type="button"
              className="rounded-full border border-[#c7c4d8] bg-[#f5f2ff] px-[9px] py-[4px] text-[10px] font-semibold leading-[12px] text-[#5d52c8] shadow-[0px_1px_2px_rgba(53,37,205,0.04)] transition-colors hover:border-[#b8b2e8] hover:bg-[#f0ecff] focus:outline-none focus:ring-2 focus:ring-[#d8d3ff]"
              aria-describedby="early-beta-popover"
            >
              Early Beta
            </button>
            <div className="pointer-events-none absolute right-0 top-full z-50 w-[280px] pt-[10px] group-hover:pointer-events-auto group-focus-within:pointer-events-auto">
              <div
                id="early-beta-popover"
                className="hidden rounded-[12px] border border-[#e2e1e8] bg-[#ffffff] p-[14px] text-left shadow-[0px_3px_8px_rgba(0,0,0,0.035),0px_16px_30px_rgba(0,0,0,0.06)] group-hover:block group-focus-within:block"
              >
                <p className="text-[12px] font-semibold leading-[16px] text-[#1b1b24]">
                  Early Beta
                </p>
                <p className="mt-[8px] text-[11px] font-normal leading-[16px] text-[#5f5d6d]">
                  This portal is currently in its early beta stage. Some information may occasionally be inaccurate or incomplete.
                </p>
                <p className="mt-[8px] text-[11px] font-normal leading-[16px] text-[#5f5d6d]">
                  For ideas, suggestions, or corrections, please email{" "}
                  <a className="font-medium text-[#3525cd] transition-colors hover:text-[#1f1599]" href="mailto:faisal@crossinghurdles.com">
                    faisal@crossinghurdles.com
                  </a>
                  .
                </p>
              </div>
            </div>
          </div>
        </div>
      </nav>

      <main className="mx-auto flex w-full max-w-[390px] flex-col gap-[24px] px-[20px] pt-[24px] pb-[43px] sm:max-w-[960px] sm:gap-[26px] sm:px-[30px] sm:pt-[24px] sm:pb-[32px] 2xl:max-w-[1380px]">
        <section className="relative min-h-[160px] overflow-hidden rounded-[20px] border border-[rgba(199,196,216,0.3)] bg-[#f5f2ff] p-[26px] shadow-[0px_1px_3px_rgba(0,0,0,0.02),0px_10px_20px_rgba(0,0,0,0.04)] sm:h-[161px] sm:min-h-0 sm:rounded-[15px] sm:p-[37px]">
          <div
            className="pointer-events-none absolute inset-px"
            style={{
              backgroundImage:
                "linear-gradient(170.90210952802815deg, rgba(195, 192, 255, 0.2) 0%, rgba(195, 192, 255, 0) 100%)",
            }}
          />
          <div className="relative z-10 max-w-4xl">
            <h1 className="break-words text-[28px] font-extrabold leading-[36px] text-[#1b1b24] sm:text-[36px] sm:leading-[42px] sm:tracking-[-0.72px]">
              Hi {candidate.full_name ?? candidate.email}
            </h1>
            <p className="mt-[8px] text-[14px] font-normal leading-[22px] text-[#464555] sm:mt-[6px] sm:text-[14px] sm:leading-[21px]">
              Here is an overview of your current assignment and tasks.
            </p>
          </div>
        </section>

        <div className="grid grid-cols-1 gap-[24px] xl:grid-cols-[minmax(0,594px)_286px] xl:gap-[20px] 2xl:grid-cols-[minmax(0,895px)_405px]">
          <div className="flex flex-col gap-[24px] sm:gap-[26px]">
            <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2 sm:gap-x-[14px] sm:gap-y-[14px]">
              <InfoCard
                icon="person"
                label="Candidate"
                value={candidateName}
                className="h-[115px] sm:h-[86px]"
              />
              <InfoCard
                icon="mail"
                label="Email"
                value={candidate.email}
                className="h-[115px] sm:h-[86px]"
              />
              <InfoCard
                icon="business"
                label="Client"
                value={clientName}
                className="h-[140px] sm:h-[105px]"
              />
              <InfoCard
                icon="category"
                label="Vertical / Project"
                value={verticalName}
                subvalue={projectName}
                className="h-[140px] sm:h-[105px]"
              />
            </div>

            <div className="grid grid-cols-1 gap-[14px] lg:grid-cols-[191px_minmax(0,1fr)] lg:gap-[14px] 2xl:grid-cols-[293px_minmax(0,1fr)]">
              <Card className="flex h-[132px] flex-col items-start justify-center gap-[20px] sm:h-[99px] sm:gap-[15px]">
                <span className="text-[12px] font-semibold uppercase leading-[15px] tracking-[0.05em] text-[#464555] sm:text-[11px] sm:leading-[12px]">
                  Status
                </span>
                <StatusChip
                  tone={assignmentStatus === "Active" ? "success" : "neutral"}
                  label={assignmentStatus}
                  icon={assignmentStatus === "Active" ? "fiber_manual_record" : undefined}
                />
              </Card>

              <Card className="flex min-h-[132px] min-w-0 flex-col justify-center overflow-hidden lg:h-[99px] lg:min-h-0">
                <div className="grid min-w-0 items-center gap-[14px] sm:grid-cols-[minmax(0,1fr)_100px] 2xl:grid-cols-[minmax(0,1fr)_143px]">
                  <div className="min-w-0 overflow-hidden">
                    <p className="text-[12px] font-semibold uppercase leading-[15px] tracking-[0.05em] text-[#464555] sm:text-[11px] sm:leading-[12px]">
                      Pay Rate & Domain
                    </p>
                    <div className="mt-[8px] flex min-w-0 flex-wrap items-baseline gap-x-[7px] gap-y-[2px] sm:mt-[6px]">
                      <span className="max-w-full break-words text-[28px] font-extrabold leading-[34px] text-[#3525cd] sm:text-[27px] sm:leading-[32px] 2xl:text-[35px] 2xl:leading-[39px]">
                        {rate.amount}
                      </span>
                      {rate.unit ? (
                        <span className="inline-flex min-w-0 items-baseline gap-[6px] text-[15px] font-normal leading-[20px] text-[#464555] sm:text-[12px] sm:leading-[17px] 2xl:text-[15px] 2xl:leading-[20px]">
                          <span>/</span>
                          <span className="break-words">{rate.unit.replace(/^\s*\/\s*/, "")}</span>
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="min-w-0 text-left sm:text-right">
                    <p className="text-[12px] font-semibold uppercase leading-[15px] tracking-[0.05em] text-[#464555] sm:text-[11px] sm:leading-[12px]">
                      Domain
                    </p>
                    <p className="mt-[8px] break-words text-[18px] font-semibold leading-[24px] text-[#1b1b24] sm:mt-[8px] sm:text-[15px] sm:leading-[20px] 2xl:text-[17px] 2xl:leading-[21px]">
                      {assignment.domain ? formatStatus(assignment.domain) : "Not available"}
                    </p>
                  </div>
                </div>
              </Card>
            </div>

            <div className="grid grid-cols-1 gap-[14px] md:grid-cols-3 md:gap-[14px]">
              <VerificationCard
                icon="description"
                label="Contract Status"
                value={contractStatus}
                verified={contractSigned}
                primary
              />
              <VerificationCard
                icon="verified_user"
                label="SpringVerify Status"
                value={springVerifyStatus}
                verified={springVerified}
              />
              <VerificationCard
                icon="gpp_maybe"
                label="Remofirst Status"
                value={remofirstStatus}
                verified={remofirstVerified}
              />
            </div>
          </div>

          <aside className="flex flex-col gap-[34px] sm:gap-[26px]">
            <Card className="h-auto p-[24px] sm:p-[26px] xl:h-[446px]">
              <h2 className="text-[20px] font-semibold leading-[26px] text-[#1b1b24] sm:text-[18px] sm:leading-[23px]">
                Task Summary
              </h2>
              <div className="mt-[24px] grid grid-cols-2 gap-[9px] sm:mt-[18px] sm:gap-[7px]">
                <MetricTile
                  icon="check_circle"
                  value={taskMetrics?.submitted ?? 0}
                  label="Submitted"
                  tone="primary"
                />
                <MetricTile
                  icon="task_alt"
                  value={taskMetrics?.accepted ?? 0}
                  label="Accepted"
                  tone="success"
                />
                <MetricTile
                  icon="cancel"
                  value={taskMetrics?.rejected ?? 0}
                  label="Rejected"
                  tone="error"
                />
                <MetricTile
                  icon="build"
                  value={taskMetrics?.rework ?? 0}
                  label="Requiring Rework"
                  tone="warning"
                />
                <MetricTile
                  icon="pending_actions"
                  value={taskEvaluationPending}
                  label="Evaluation Pending"
                  tone="neutral"
                  wide
                />
              </div>
            </Card>

            <Card className="h-auto p-[24px] sm:p-[26px] xl:h-[227px]">
              <h2 className="text-[20px] font-semibold leading-[26px] text-[#1b1b24] sm:text-[18px] sm:leading-[23px]">
                Payments Overview
              </h2>
              <div className="mt-[24px] flex flex-col gap-[20px] sm:mt-[18px] sm:gap-[15px]">
                <PaymentInfo
                  icon="payments"
                  label="Already Disbursed"
                  value={formatCurrency(totalDisbursed, paymentCurrency)}
                  tone="success"
                />
                <PaymentInfo
                  icon="schedule"
                  label="Latest Status"
                  value={latestPaymentStatus}
                  tone={latestPaymentStatus === "Not available" ? "neutral" : "warning"}
                />
              </div>
            </Card>
          </aside>
        </div>
      </main>
    </div>
  );
}
