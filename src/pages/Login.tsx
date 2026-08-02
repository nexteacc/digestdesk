import { useState, type FormEvent } from "react";
import { useSignIn, useSignUp } from "@clerk/react/legacy";
import { isClerkAPIResponseError } from "@clerk/react/errors";
import { FcGoogle } from "react-icons/fc";
import { useLocation } from "wouter";
import DotMatrixBackground from "@/components/auth/DotMatrixBackground";
import { finalizeAuthSession } from "@/lib/auth-session";

type AuthMode = "sign-in" | "sign-up";
type AuthStep = "start" | "verify";
type VerificationKind = "sign-in-first" | "sign-in-second-email" | "sign-in-second-totp" | "sign-up";

type VerificationState = {
  kind: VerificationKind;
  email: string;
};

const supportedSignUpFields = new Set(["first_name", "last_name", "legal_accepted"]);

function readError(error: unknown, fallback: string) {
  if (isClerkAPIResponseError(error)) {
    return error.errors[0]?.longMessage || error.errors[0]?.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function splitName(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts[0] || undefined,
    lastName: parts.length > 1 ? parts.slice(1).join(" ") : undefined,
  };
}

export default function LoginPage() {
  const { isLoaded: signInLoaded, signIn, setActive: setSignInActive } = useSignIn();
  const { isLoaded: signUpLoaded, signUp, setActive: setSignUpActive } = useSignUp();
  const [, navigate] = useLocation();
  const [mode, setMode] = useState<AuthMode>("sign-in");
  const [step, setStep] = useState<AuthStep>("start");
  const [verification, setVerification] = useState<VerificationState | null>(null);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const ready = signInLoaded && signUpLoaded;

  async function completeSignIn(sessionId: string) {
    if (!setSignInActive) {
      throw new Error("Authentication is not ready. Try again.");
    }
    await finalizeAuthSession({
      setActive: setSignInActive,
      sessionId,
      navigate: (route) => navigate(route, { replace: true }),
    });
  }

  async function completeSignUp(sessionId: string) {
    if (!setSignUpActive) {
      throw new Error("Authentication is not ready. Try again.");
    }
    await finalizeAuthSession({
      setActive: setSignUpActive,
      sessionId,
      navigate: (route) => navigate(route, { replace: true }),
    });
  }

  async function prepareSecondFactor() {
    if (!signIn) {
      return false;
    }
    const emailFactor = signIn.supportedSecondFactors?.find((factor) => factor.strategy === "email_code");
    if (emailFactor?.strategy === "email_code") {
      await signIn.prepareSecondFactor({
        strategy: "email_code",
        emailAddressId: emailFactor.emailAddressId,
      });
      setVerification({ kind: "sign-in-second-email", email });
      setStep("verify");
      return true;
    }
    const totpFactor = signIn.supportedSecondFactors?.find((factor) => factor.strategy === "totp");
    if (totpFactor) {
      setVerification({ kind: "sign-in-second-totp", email });
      setStep("verify");
      return true;
    }
    return false;
  }

  async function handleSignInStart() {
    if (!signIn) {
      return;
    }
    const attempt = await signIn.create({ identifier: email.trim() });
    if (attempt.status === "complete" && attempt.createdSessionId) {
      await completeSignIn(attempt.createdSessionId);
      return;
    }
    if (attempt.status === "needs_second_factor") {
      if (!(await prepareSecondFactor())) {
        throw new Error("This account requires a verification method that is not available here.");
      }
      return;
    }
    if (attempt.status !== "needs_first_factor") {
      throw new Error("This account requires a sign-in step that is not supported here.");
    }
    const emailFactor = attempt.supportedFirstFactors?.find((factor) => factor.strategy === "email_code");
    if (!emailFactor || emailFactor.strategy !== "email_code") {
      throw new Error("Email verification is not enabled for this account.");
    }
    await signIn.prepareFirstFactor({
      strategy: "email_code",
      emailAddressId: emailFactor.emailAddressId,
    });
    setVerification({ kind: "sign-in-first", email: email.trim() });
    setStep("verify");
  }

  async function handleSignUpStart() {
    if (!signUp) {
      return;
    }
    const name = splitName(fullName);
    const attempt = await signUp.create({
      emailAddress: email.trim(),
      firstName: name.firstName,
      lastName: name.lastName,
      legalAccepted: true,
    });
    if (attempt.status === "complete" && attempt.createdSessionId) {
      await completeSignUp(attempt.createdSessionId);
      return;
    }
    if (attempt.missingFields.includes("last_name")) {
      throw new Error("Enter both your first and last name to create this account.");
    }
    const unsupportedFields = attempt.missingFields.filter((field) => !supportedSignUpFields.has(field));
    if (unsupportedFields.length > 0) {
      throw new Error(`This sign-up requires unsupported fields: ${unsupportedFields.join(", ")}.`);
    }
    if (!attempt.unverifiedFields.includes("email_address")) {
      throw new Error("Email verification is not available for this sign-up.");
    }
    await signUp.prepareEmailAddressVerification({ strategy: "email_code" });
    setVerification({ kind: "sign-up", email: email.trim() });
    setStep("verify");
  }

  async function submitStart(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      if (mode === "sign-in") {
        await handleSignInStart();
      } else {
        await handleSignUpStart();
      }
    } catch (caught) {
      setError(readError(caught, mode === "sign-in" ? "Unable to sign in." : "Unable to create your account."));
    } finally {
      setSubmitting(false);
    }
  }

  async function submitVerification(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!verification) {
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      if (verification.kind === "sign-up") {
        if (!signUp) {
          return;
        }
        const attempt = await signUp.attemptEmailAddressVerification({ code: code.trim() });
        if (attempt.status !== "complete" || !attempt.createdSessionId) {
          throw new Error("Your account still needs additional information.");
        }
        await completeSignUp(attempt.createdSessionId);
        return;
      }
      if (!signIn) {
        return;
      }
      const attempt = verification.kind === "sign-in-first"
        ? await signIn.attemptFirstFactor({ strategy: "email_code", code: code.trim() })
        : verification.kind === "sign-in-second-email"
          ? await signIn.attemptSecondFactor({ strategy: "email_code", code: code.trim() })
          : await signIn.attemptSecondFactor({ strategy: "totp", code: code.trim() });
      if (attempt.status === "needs_second_factor") {
        if (!(await prepareSecondFactor())) {
          throw new Error("This account requires a verification method that is not available here.");
        }
        setCode("");
        return;
      }
      if (attempt.status !== "complete" || !attempt.createdSessionId) {
        throw new Error("Verification is not complete.");
      }
      await completeSignIn(attempt.createdSessionId);
    } catch (caught) {
      setError(readError(caught, "The verification code could not be confirmed."));
    } finally {
      setSubmitting(false);
    }
  }

  async function resendCode() {
    if (!verification) {
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      if (verification.kind === "sign-up") {
        await signUp?.prepareEmailAddressVerification({ strategy: "email_code" });
      } else if (verification.kind === "sign-in-first") {
        const factor = signIn?.supportedFirstFactors?.find((item) => item.strategy === "email_code");
        if (factor?.strategy !== "email_code") {
          throw new Error("Email verification is not available.");
        }
        await signIn?.prepareFirstFactor({ strategy: "email_code", emailAddressId: factor.emailAddressId });
      } else if (verification.kind === "sign-in-second-email") {
        const factor = signIn?.supportedSecondFactors?.find((item) => item.strategy === "email_code");
        if (factor?.strategy !== "email_code") {
          throw new Error("Email verification is not available.");
        }
        await signIn?.prepareSecondFactor({ strategy: "email_code", emailAddressId: factor.emailAddressId });
      }
    } catch (caught) {
      setError(readError(caught, "Unable to resend the code."));
    } finally {
      setSubmitting(false);
    }
  }

  async function continueWithGoogle() {
    if (!ready) {
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      if (mode === "sign-in") {
        await signIn.authenticateWithRedirect({
          strategy: "oauth_google",
          redirectUrl: "/sso-callback",
          redirectUrlComplete: "/#/",
        });
      } else {
        await signUp.authenticateWithRedirect({
          strategy: "oauth_google",
          redirectUrl: "/sso-callback",
          redirectUrlComplete: "/#/",
          legalAccepted: true,
        });
      }
    } catch (caught) {
      setError(readError(caught, "Unable to continue with Google."));
      setSubmitting(false);
    }
  }

  function switchMode(nextMode: AuthMode) {
    setMode(nextMode);
    setStep("start");
    setVerification(null);
    setCode("");
    setError("");
  }

  function returnToStart() {
    setStep("start");
    setVerification(null);
    setCode("");
    setError("");
  }

  const title = step === "verify"
    ? "Check your email"
    : mode === "sign-in"
      ? "Sign in to DigestDesk"
      : "Create your DigestDesk account";

  return (
    <main className="relative flex min-h-screen min-h-dvh items-center justify-center overflow-hidden bg-[#0d0d0b] px-4 py-6 font-sans text-[#f5f3ee]">
      <DotMatrixBackground />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(13,13,11,0.75)_0%,rgba(13,13,11,0)_100%)]" />

      <section className="relative z-10 flex w-full max-w-[400px] flex-col items-center rounded-xl border border-[#34342f] bg-[#151512]/98 px-7 py-8 shadow-[0_24px_70px_rgba(0,0,0,0.62)] sm:px-8">
        <a href="#/" aria-label="Back to DigestDesk" className="block h-11 w-11 overflow-hidden rounded-xl transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f5f3ee]">
          <img src="/icons/icon-192.png" alt="" className="h-full w-full object-cover" />
        </a>

        <h1 className="mt-3 text-center font-sans text-[22px] font-semibold leading-tight tracking-[-0.035em] text-[#f5f3ee]">
          {title}
        </h1>

        {step === "verify" && verification ? (
          <form onSubmit={submitVerification} className="mt-5 w-full">
            <p className="mb-5 text-center text-sm leading-6 text-[#908e87]">
              {verification.kind === "sign-in-second-totp"
                ? "Enter the code from your authenticator app."
                : `Enter the code sent to ${verification.email}.`}
            </p>
            <label htmlFor="auth-code" className="sr-only">Verification code</label>
            <input
              id="auth-code"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              placeholder="000000"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              className="h-11 w-full rounded-md border border-[#3a3934] bg-[#0d0d0b] px-4 text-center text-base tracking-[0.28em] text-[#f5f3ee] outline-none transition-colors placeholder:text-[#65635e] focus:border-[#74716a]"
            />
            {error ? <p role="alert" className="mt-3 text-sm leading-5 text-[#ff8c79]">{error}</p> : null}
            <button
              type="submit"
              disabled={!ready || submitting || !/^\d{6}$/.test(code.trim())}
              className="mt-2.5 flex h-11 w-full items-center justify-center rounded-lg bg-[#ff6719] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {submitting ? "Verifying…" : "Verify code"}
            </button>
            <div className="mt-5 flex items-center justify-center gap-4 text-sm">
                <button type="button" onClick={returnToStart} className="text-[#aaa79f] transition-colors hover:text-[#f5f3ee] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5f3ee]">Back</button>
              {verification.kind !== "sign-in-second-totp" ? (
                <button type="button" onClick={resendCode} disabled={submitting} className="text-[#f5f3ee] transition-opacity hover:opacity-75 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5f3ee]">Resend code</button>
              ) : null}
            </div>
          </form>
        ) : (
          <>
            <form onSubmit={submitStart} className="mt-5 w-full space-y-2.5">
              {mode === "sign-up" ? (
                <>
                  <label htmlFor="auth-name" className="sr-only">Full name</label>
                  <input
                    id="auth-name"
                    value={fullName}
                    onChange={(event) => setFullName(event.target.value)}
                    type="text"
                    autoComplete="name"
                    placeholder="Full name"
                    required
                    className="h-11 w-full rounded-md border border-[#3a3934] bg-[#0d0d0b] px-3.5 text-sm text-[#f5f3ee] outline-none transition-colors placeholder:text-[#76736d] focus:border-[#74716a]"
                  />
                </>
              ) : null}
              <label htmlFor="auth-email" className="sr-only">Email address</label>
              <input
                id="auth-email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                type="email"
                autoComplete="email"
                placeholder="name@email.com"
                required
                autoFocus
                className="h-11 w-full rounded-md border border-[#3a3934] bg-[#0d0d0b] px-3.5 text-sm text-[#f5f3ee] outline-none transition-colors placeholder:text-[#76736d] focus:border-[#74716a]"
              />
              {error ? <p role="alert" className="text-sm leading-5 text-[#ff8c79]">{error}</p> : null}
              <button
                type="submit"
                disabled={!ready || submitting}
                className="flex h-11 w-full items-center justify-center rounded-lg bg-[#ff6719] px-4 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {submitting ? "Please wait…" : mode === "sign-in" ? "Continue with Email" : "Sign Up with Email"}
              </button>
              <div id="clerk-captcha" className="empty:hidden" />
            </form>

            <div className="my-3.5 h-px w-full bg-[#292925]" />

            <button
              type="button"
              onClick={continueWithGoogle}
              disabled={!ready || submitting}
              className="flex h-11 w-full items-center justify-center gap-2.5 rounded-lg border border-[#3a3934] bg-transparent px-4 text-sm font-semibold text-[#f5f3ee] transition-colors hover:border-[#5a5750] hover:bg-white/[0.025] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#f5f3ee]"
            >
              <FcGoogle aria-hidden className="h-[18px] w-[18px] shrink-0" />
              Continue with Google
            </button>

            <p className="mt-5 text-center text-sm text-[#908e87]">
              {mode === "sign-in" ? "Don't have an account?" : "Already have an account?"}{" "}
              <button
                type="button"
                onClick={() => switchMode(mode === "sign-in" ? "sign-up" : "sign-in")}
                className="font-medium text-[#f5f3ee] transition-opacity hover:opacity-75 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5f3ee]"
              >
                {mode === "sign-in" ? "Sign Up" : "Sign In"}
              </button>
            </p>
          </>
        )}

        <p className="mt-3.5 text-center text-[12px] leading-[18px] text-[#6f6d67]">
          By continuing, you agree to our{" "}
          <a href="#/terms" className="text-[#aaa79f] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5f3ee]">Terms of Service</a>{" "}
          and{" "}
          <a href="#/privacy" className="text-[#aaa79f] underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#f5f3ee]">Privacy Policy</a>.
        </p>
      </section>
    </main>
  );
}
