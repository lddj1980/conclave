function envBool(name: string, fallback = false): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === '') return fallback;
  const v = String(raw).trim().toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export const securityConfig = {
  secureAuthEnforced: envBool('SECURE_AUTH_ENFORCED', false),
  secureAdminEnforced: envBool('SECURE_ADMIN_ENFORCED', false),
  secureSandboxIsolated: envBool('SECURE_SANDBOX_ISOLATED', false),
  secureStrictCors: envBool('SECURE_STRICT_CORS', false),
};

