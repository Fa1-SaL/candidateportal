"use client";

import { use, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export default function LoginPage({
    searchParams,
}: {
    searchParams: Promise<{ auth_error?: string | string[] }>;
}) {
    const resolvedSearchParams = use(searchParams);
    const initialAuthError = Array.isArray(resolvedSearchParams.auth_error)
        ? resolvedSearchParams.auth_error[0] ?? ""
        : resolvedSearchParams.auth_error ?? "";
    const [email, setEmail] = useState("");
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState(initialAuthError);
    const siteUrl =
        typeof window !== "undefined"
            ? window.location.origin
            : process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
              "http://localhost:3000";

    async function handleLogin(e: React.FormEvent) {
        e.preventDefault();

        setLoading(true);
        setMessage("");

        const supabase = createClient();

        const { error } = await supabase.auth.signInWithOtp({
            email: email.trim().toLowerCase(),
            options: {
                emailRedirectTo: `${siteUrl}/auth/callback`,
            },
        });

        if (error) {
            setMessage(error.message);
        } else {
            setMessage("Check your email for your login link.");
        }

        setLoading(false);
    }

    return (
        <main className="flex min-h-screen items-center justify-center bg-[#fcf8ff] px-5 text-[#1b1b24]">
            <form
                onSubmit={handleLogin}
                className="w-full max-w-[336px] space-y-4 rounded-[14px] border border-[#e2e1e8] bg-white p-6 shadow-[0px_1px_3px_rgba(0,0,0,0.02),0px_10px_20px_rgba(0,0,0,0.04)] sm:space-y-3 sm:rounded-[11px] sm:p-[18px]"
            >
                <h1 className="text-[22px] font-bold leading-[28px] sm:text-[18px] sm:leading-[22px]">
                    Candidate Portal
                </h1>

                <input
                    type="email"
                    placeholder="Email address"
                    className="h-[46px] w-full rounded-[8px] border border-[#e2e1e8] px-3 text-[15px] leading-[20px] outline-none transition-colors focus:border-[#3525cd] sm:h-[36px] sm:rounded-[6px] sm:px-[10px] sm:text-[12px] sm:leading-[16px]"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                />

                <button
                    type="submit"
                    disabled={loading}
                    className="h-[46px] w-full rounded-[8px] bg-[#1b1b24] px-3 text-[15px] font-semibold leading-[20px] text-white transition-colors hover:bg-[#3525cd] disabled:cursor-not-allowed disabled:opacity-70 sm:h-[36px] sm:rounded-[6px] sm:px-[10px] sm:text-[12px] sm:leading-[16px]"
                >
                    {loading ? "Sending..." : "Send Magic Link"}
                </button>

                {message && (
                    <p className="text-[13px] leading-[18px] text-[#464555] sm:text-[11px] sm:leading-[15px]">
                        {message}
                    </p>
                )}
            </form>
        </main>
    );
}
