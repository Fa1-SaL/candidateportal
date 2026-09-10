/** Missing/invalid sessions may return to sign-in; service/rate-limit/network
 * failures must not masquerade as a logged-out account. */
export function authenticationUnavailable(error: { status?: number } | null): boolean {
  return !!error && ![400, 401, 403].includes(error.status ?? 0);
}
