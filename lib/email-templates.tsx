import type * as React from "react"
import { buildAppUrl } from "@/lib/url"

type WelcomeEmailProps = {
  userName?: string
  userEmail: string
  hasRouterSession: boolean
}

export const WelcomeEmail: React.FC<WelcomeEmailProps> = ({ userName, userEmail, hasRouterSession }) => (
  <div style={{ fontFamily: "sans-serif", maxWidth: "600px", margin: "0 auto" }}>
    <div style={{ backgroundColor: "#0066cc", padding: "32px", textAlign: "center" }}>
      <h1 style={{ color: "white", margin: 0 }}>Welcome to GuideBuoy AI</h1>
    </div>
    <div style={{ padding: "32px", backgroundColor: "#f9fafb" }}>
      <p style={{ fontSize: "16px", lineHeight: "1.6" }}>Hi {userName || "there"},</p>
      <p style={{ fontSize: "16px", lineHeight: "1.6" }}>
        Thank you for creating your GuideBuoy AI account! We{"'"}re here to help you navigate your financial dispute
        with confidence.
      </p>
      {hasRouterSession && (
        <div
          style={{
            backgroundColor: "#dbeafe",
            padding: "16px",
            borderRadius: "8px",
            marginTop: "16px",
            marginBottom: "16px",
          }}
        >
          <p style={{ fontSize: "14px", margin: 0, fontWeight: "bold" }}>⭐ Your case assessment has been saved</p>
          <p style={{ fontSize: "14px", margin: "8px 0 0 0" }}>
            We{"'"}ve imported your dispute details. You can continue where you left off.
          </p>
        </div>
      )}
      <h2 style={{ fontSize: "18px", marginTop: "24px" }}>What{"'"}s Next?</h2>
      <ol style={{ fontSize: "16px", lineHeight: "1.8" }}>
        <li>Complete your profile setup</li>
        <li>Review your case assessment</li>
        <li>Upload supporting documents</li>
        <li>Submit your FIDReC complaint</li>
      </ol>
      <div style={{ textAlign: "center", marginTop: "32px" }}>
        <a
          href={buildAppUrl("/onboarding")}
          style={{
            backgroundColor: "#0066cc",
            color: "white",
            padding: "12px 24px",
            textDecoration: "none",
            borderRadius: "6px",
            display: "inline-block",
          }}
        >
          Get Started
        </a>
      </div>
      <p style={{ fontSize: "14px", color: "#6b7280", marginTop: "32px" }}>
        Need help? Reply to this email or visit our support center.
      </p>
      <p style={{ fontSize: "12px", color: "#9ca3af", marginTop: "16px" }}>This message was sent to {userEmail}.</p>
    </div>
    <div style={{ padding: "16px", textAlign: "center", fontSize: "12px", color: "#9ca3af" }}>
      <p>&copy; 2025 GuideBuoy AI. All rights reserved.</p>
    </div>
  </div>
)

type WaitlistConfirmationProps = {
  userName?: string
  userEmail: string
  source?: string
}

export const WaitlistConfirmationEmail: React.FC<WaitlistConfirmationProps> = ({ userName, userEmail, source }) => (
  <div style={{ fontFamily: "sans-serif", maxWidth: "600px", margin: "0 auto" }}>
    <div style={{ backgroundColor: "#0066cc", padding: "32px", textAlign: "center" }}>
      <h1 style={{ color: "white", margin: 0 }}>You{"'"}re on the Waitlist!</h1>
    </div>
    <div style={{ padding: "32px", backgroundColor: "#f9fafb" }}>
      <p style={{ fontSize: "16px", lineHeight: "1.6" }}>Hi {userName || "there"},</p>
      <p style={{ fontSize: "16px", lineHeight: "1.6" }}>
        Thank you for joining the GuideBuoy AI waitlist! We{"'"}re working hard to launch our full case management
        platform.
      </p>
      <div
        style={{
          backgroundColor: "#dbeafe",
          padding: "20px",
          borderRadius: "8px",
          marginTop: "24px",
          marginBottom: "24px",
        }}
      >
        <h3 style={{ fontSize: "16px", margin: "0 0 12px 0" }}>What you{"'"}ll get:</h3>
        <ul style={{ fontSize: "14px", lineHeight: "1.8", margin: 0, paddingLeft: "20px" }}>
          <li>Early access to the full platform</li>
          <li>Priority case review by our team</li>
          <li>Exclusive launch pricing</li>
          <li>Direct support from our founders</li>
        </ul>
      </div>
      <p style={{ fontSize: "16px", lineHeight: "1.6" }}>
        We{"'"}ll notify you as soon as we{"'"}re ready to onboard new users. In the meantime, feel free to explore our
        self-service resources.
      </p>
      {source && (
        <p style={{ fontSize: "12px", color: "#6b7280", marginTop: "8px" }}>
          You found us via: <strong>{source}</strong>
        </p>
      )}
      <div style={{ textAlign: "center", marginTop: "32px" }}>
        <a
          href={buildAppUrl("/resources")}
          style={{
            backgroundColor: "#0066cc",
            color: "white",
            padding: "12px 24px",
            textDecoration: "none",
            borderRadius: "6px",
            display: "inline-block",
          }}
        >
          Browse Resources
        </a>
      </div>
      <p style={{ fontSize: "14px", color: "#6b7280", marginTop: "32px" }}>
        This confirmation was sent to {userEmail}. Questions? Reply to this email anytime.
      </p>
    </div>
    <div style={{ padding: "16px", textAlign: "center", fontSize: "12px", color: "#9ca3af" }}>
      <p>&copy; 2025 GuideBuoy AI. All rights reserved.</p>
    </div>
  </div>
)

type InvitationEmailProps = {
  inviterName: string
  inviterEmail: string
  caseTitle: string
  invitationToken: string
  role: string
}

export const InvitationEmail: React.FC<InvitationEmailProps> = ({
  inviterName,
  inviterEmail,
  caseTitle,
  invitationToken,
  role,
}) => {
  const inviteUrl = buildAppUrl(`/invite/${invitationToken}`)

  return (
    <div style={{ fontFamily: "sans-serif", maxWidth: "600px", margin: "0 auto" }}>
      <div style={{ backgroundColor: "#0066cc", padding: "32px", textAlign: "center" }}>
        <h1 style={{ color: "white", margin: 0 }}>You{"'"}ve Been Invited!</h1>
      </div>
      <div style={{ padding: "32px", backgroundColor: "#f9fafb" }}>
        <p style={{ fontSize: "16px", lineHeight: "1.6" }}>Hi there,</p>
        <p style={{ fontSize: "16px", lineHeight: "1.6" }}>
          <strong>{inviterName}</strong> ({inviterEmail}) has invited you to collaborate on their case:
        </p>
        <div
          style={{
            backgroundColor: "#dbeafe",
            padding: "20px",
            borderRadius: "8px",
            marginTop: "24px",
            marginBottom: "24px",
          }}
        >
          <h3 style={{ fontSize: "18px", margin: "0 0 8px 0" }}>{caseTitle}</h3>
          <p style={{ fontSize: "14px", margin: 0, color: "#374151" }}>
            Role: <strong>{role === "helper" ? "Helper" : "Lead Victim"}</strong>
          </p>
        </div>
        <p style={{ fontSize: "16px", lineHeight: "1.6" }}>
          GuideBuoy AI helps you manage financial disputes with FIDReC. By accepting this invitation, you{"'"}ll be
          able to collaborate on case documents, evidence, and submissions.
        </p>
        <div style={{ textAlign: "center", marginTop: "32px" }}>
          <a
            href={inviteUrl}
            style={{
              backgroundColor: "#0066cc",
              color: "white",
              padding: "12px 32px",
              textDecoration: "none",
              borderRadius: "6px",
              display: "inline-block",
              fontSize: "16px",
              fontWeight: "bold",
            }}
          >
            Accept Invitation
          </a>
        </div>
        <p style={{ fontSize: "14px", color: "#6b7280", marginTop: "32px", textAlign: "center" }}>
          This invitation will expire in 7 days.
        </p>
        <p style={{ fontSize: "14px", color: "#6b7280", marginTop: "16px" }}>
          If you don{"'"}t have a GuideBuoy AI account yet, you{"'"}ll be prompted to create one when you accept the
          invitation.
        </p>
      </div>
      <div style={{ padding: "16px", textAlign: "center", fontSize: "12px", color: "#9ca3af" }}>
        <p>&copy; 2025 GuideBuoy AI. All rights reserved.</p>
        <p style={{ marginTop: "8px" }}>
          If you didn{"'"}t expect this invitation, you can safely ignore this email.
        </p>
      </div>
    </div>
  )
}

