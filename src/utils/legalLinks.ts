// ── Legal links shown wherever we offer a purchase ──────────────────────────
//
// Guideline 3.1.2(c) requires a *functional* Terms of Use (EULA) and Privacy
// Policy link on any screen that sells a subscription, and the privacy URL must
// match the Privacy Policy field in App Store Connect. Build 2.8(16) was
// rejected because the URL here pointed at a GitHub Pages site that had never
// been created, so keep these in one place — a second hardcoded copy drifting
// out of sync is exactly how that happened.

import {Linking} from 'react-native';

// Apple's standard EULA. Replace only if a custom agreement is registered in
// App Store Connect.
export const TERMS_URL =
  'https://www.apple.com/legal/internet-services/itunes/dev/stdeula/';

// The support site serves every app from one page and picks the copy off the
// ?app= key, so the query string is load-bearing: /privacy with no key — or any
// path that does not exist — falls back to the generic support page with a 200
// rather than a 404, which looks alive to a status check but shows no policy.
export const PRIVACY_URL = 'https://gan-67f.pages.dev/privacy?app=calendar';

export const openLegalLink = (url: string): void => {
  Linking.openURL(url).catch(err => {
    console.warn('[legalLinks] failed to open', url, err);
  });
};
