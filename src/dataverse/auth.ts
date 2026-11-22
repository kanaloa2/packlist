import type { AccountInfo, IPublicClientApplication } from '@azure/msal-browser';
import { normalizeEnvUrl, redirectUri, type DataverseConfig } from './config';

// MSAL is only loaded when someone actually uses the Dataverse import.
let app: { key: string; pca: IPublicClientApplication } | null = null;

const scopesFor = (c: DataverseConfig) => [`${normalizeEnvUrl(c.envUrl)}/user_impersonation`];

async function client(c: DataverseConfig): Promise<IPublicClientApplication> {
  const key = `${c.clientId}|${c.tenantId}`;
  if (app?.key === key) return app.pca;
  const { PublicClientApplication } = await import('@azure/msal-browser');
  const pca = new PublicClientApplication({
    auth: {
      clientId: c.clientId.trim(),
      authority: `https://login.microsoftonline.com/${c.tenantId.trim()}`,
      redirectUri: redirectUri(),
    },
    cache: { cacheLocation: 'localStorage' },
    // MSAL can't see the popup close, so it waits for this long. Leave room for MFA.
    system: { popupBridgeTimeout: 5 * 60_000 },
  });
  await pca.initialize();
  app = { key, pca };
  return pca;
}

export async function currentAccount(c: DataverseConfig): Promise<AccountInfo | null> {
  const pca = await client(c);
  return pca.getActiveAccount() ?? pca.getAllAccounts()[0] ?? null;
}

/** Opens Microsoft sign-in in a popup and asks for permission to read Dataverse. */
export async function signIn(c: DataverseConfig): Promise<AccountInfo> {
  const pca = await client(c);
  const res = await pca.loginPopup({ scopes: scopesFor(c), prompt: 'select_account' });
  pca.setActiveAccount(res.account);
  return res.account;
}

/** Plain-English version of an MSAL error. */
export function friendlyAuthError(e: unknown): string {
  const code = (e as { errorCode?: string })?.errorCode ?? '';
  const msg = (e as Error)?.message ?? String(e);
  if (code === 'popup_window_error' || /popup.*blocked/i.test(msg)) return 'Your browser blocked the sign-in popup. Allow popups for this site and try again.';
  if (code === 'user_cancelled' || code === 'timed_out') return 'Sign-in was cancelled or took too long. Try again.';
  if (/AADSTS50011/.test(msg)) return 'The redirect address isn’t registered on the Entra app. Add the exact address shown in the setup steps.';
  if (/AADSTS65001|consent/i.test(msg)) return 'Packlist hasn’t been granted access to Dataverse yet. Grant admin consent on the app’s API permissions page.';
  if (/AADSTS700016/.test(msg)) return 'Microsoft doesn’t recognize that Application (client) ID in this tenant. Check both IDs.';
  if (/AADSTS90002/.test(msg)) return 'Microsoft doesn’t recognize that Directory (tenant) ID.';
  return msg;
}

export async function signOut(c: DataverseConfig) {
  const pca = await client(c);
  const account = await currentAccount(c);
  // Forget the account in this app only; don't sign the user out of Microsoft everywhere.
  if (account) await pca.clearCache({ account });
}

/** An access token for the Dataverse Web API, renewing silently or via popup if needed. */
export async function getToken(c: DataverseConfig): Promise<string> {
  const pca = await client(c);
  const account = await currentAccount(c);
  if (!account) throw new Error('Sign in with Microsoft first.');
  try {
    return (await pca.acquireTokenSilent({ scopes: scopesFor(c), account })).accessToken;
  } catch {
    return (await pca.acquireTokenPopup({ scopes: scopesFor(c), account })).accessToken;
  }
}
