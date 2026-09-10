export function fixturePreviewEnabled(environment = process.env.NODE_ENV, flag = process.env.PORTAL_FIXTURE_PREVIEW) {
  return environment === "development" && flag === "true";
}
