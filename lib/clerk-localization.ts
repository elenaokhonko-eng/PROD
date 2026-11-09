// Sign-up consent (Elena, 9 Nov): with legal consent on in Clerk, every new account ticks one box that also confirms
// the person is 18 or over. Clerk fills the two links from the Terms and Privacy URLs set in its dashboard.
export const CLERK_LOCALIZATION = {
  signUp: {
    legalConsent: {
      checkbox: {
        label__termsOfServiceAndPrivacyPolicy:
          'I am 18 or over and agree to the {{ termsOfServiceLink || link("Terms of Service") }} and {{ privacyPolicyLink || link("Privacy Policy") }}',
      },
    },
  },
} as const
