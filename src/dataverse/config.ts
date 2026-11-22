/** Where to find the Dataverse environment and the Entra app that lets Packlist sign in to it. */
export interface DataverseConfig {
  /** e.g. https://org81670796.crm.dynamics.com */
  envUrl: string;
  /** Application (client) ID of the Entra app registration. Public, not a secret. */
  clientId: string;
  /** Directory (tenant) ID. */
  tenantId: string;
}

// Defaults can be baked in at build time; until then they're entered once in Settings.
const DEFAULTS: DataverseConfig = {
  envUrl: import.meta.env.VITE_DATAVERSE_URL || 'https://org81670796.crm.dynamics.com',
  clientId: import.meta.env.VITE_ENTRA_CLIENT_ID || '',
  tenantId: import.meta.env.VITE_ENTRA_TENANT_ID || '',
};

const KEY = 'packlist.dataverse';
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** This device's copy of the settings (the account copy is in accountSettings.ts). */
export function loadConfig(): DataverseConfig & { updatedAt?: number } {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<DataverseConfig & { updatedAt: number }>;
    return { ...DEFAULTS, ...Object.fromEntries(Object.entries(saved).filter(([, v]) => v)) };
  } catch {
    return DEFAULTS;
  }
}

export function saveConfig(c: DataverseConfig & { updatedAt?: number }) {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* storage unavailable: config lasts for this visit only */
  }
}

/** Returns a problem to show the user, or null if the config looks usable. */
export function checkConfig(c: DataverseConfig): string | null {
  if (!/^https:\/\/[a-z0-9-]+\.crm[0-9]*\.dynamics\.com\/?$/i.test(c.envUrl.trim()))
    return 'The environment URL should look like https://yourorg.crm.dynamics.com';
  if (!GUID.test(c.clientId.trim())) return 'The Application (client) ID should be a GUID like 1a2b3c4d-…';
  if (!GUID.test(c.tenantId.trim())) return 'The Directory (tenant) ID should be a GUID like 1a2b3c4d-…';
  return null;
}

export function normalizeEnvUrl(url: string) {
  return url.trim().replace(/\/+$/, '');
}

/** The popup comes back to this small page, which hands the result to the main window. */
export function redirectUri() {
  return window.location.origin + import.meta.env.BASE_URL + 'auth-redirect.html';
}
