// Runs inside the Microsoft sign-in popup after it returns: hands the result back to Packlist.
import { broadcastResponseToMainFrame } from '@azure/msal-browser/redirect-bridge';

broadcastResponseToMainFrame().catch((e) => {
  document.body.textContent = `Sign-in could not finish: ${(e as Error).message}. You can close this window.`;
});
