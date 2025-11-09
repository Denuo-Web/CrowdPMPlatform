import { useEffect, useState } from "react";
import { FirebaseError } from "firebase/app";
import { Button, Dialog, Flex, Text, TextField } from "@radix-ui/themes";
import { useAuth } from "../providers/AuthProvider";

export type AuthMode = "login" | "signup";

type AuthDialogProps = {
  open: boolean;
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onOpenChange: (open: boolean) => void;
  onAuthenticated?: () => void;
};

function getReadableError(error: unknown): string {
  if (error instanceof FirebaseError) {
    switch (error.code) {
      case "auth/invalid-email":
        return "That email address looks invalid. Please check the format and try again.";
      case "auth/user-disabled":
        return "This account has been disabled. Contact the project administrator for help.";
      case "auth/user-not-found":
        return "We couldn't find an account with that email. Sign up instead?";
      case "auth/wrong-password":
        return "Incorrect password. Double-check your password and try again.";
      case "auth/email-already-in-use":
        return "That email is already in use. Log in instead.";
      case "auth/weak-password":
        return "Choose a stronger password (at least 6 characters).";
      default:
        return "Authentication failed. Please try again.";
    }
  }
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

export function AuthDialog({ open, mode, onModeChange, onOpenChange, onAuthenticated }: AuthDialogProps) {
  const { signIn, signUp } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!open) {
      setEmail("");
      setPassword("");
      setConfirmPassword("");
      setError(null);
      setIsSubmitting(false);
    }
  }, [open]);

  useEffect(() => {
    setError(null);
    setPassword("");
    setConfirmPassword("");
  }, [mode]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (mode === "signup") {
        if (password !== confirmPassword) {
          setError("Passwords do not match.");
          setIsSubmitting(false);
          return;
        }
        await signUp(email, password);
      } else {
        await signIn(email, password);
      }
      onOpenChange(false);
      onAuthenticated?.();
    }
    catch (err) {
      setError(getReadableError(err));
    }
    finally {
      setIsSubmitting(false);
    }
  }

  const title = mode === "signup" ? "Sign up" : "Log in";
  const description =
    mode === "signup"
      ? "Create an account with your email and password to access the user dashboard."
      : "Enter your email and password to access the user dashboard.";

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Content size="3" style={{ maxWidth: 420 }}>
        <Dialog.Title>{title}</Dialog.Title>
        <Dialog.Description>{description}</Dialog.Description>
        <form onSubmit={handleSubmit}>
          <Flex direction="column" gap="3" mt="4">
            <div>
              <Text as="label" htmlFor="auth-email" size="2" color="gray">
                Email
              </Text>
              <TextField.Root
                id="auth-email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="you@example.com"
                mt="1"
              />
            </div>
            <div>
              <Text as="label" htmlFor="auth-password" size="2" color="gray">
                Password
              </Text>
              <TextField.Root
                id="auth-password"
                type="password"
                autoComplete={mode === "signup" ? "new-password" : "current-password"}
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                minLength={6}
                mt="1"
              />
            </div>
            {mode === "signup" ? (
              <div>
                <Text as="label" htmlFor="auth-confirm-password" size="2" color="gray">
                  Confirm password
                </Text>
                <TextField.Root
                  id="auth-confirm-password"
                  type="password"
                  autoComplete="new-password"
                  required
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  minLength={6}
                  mt="1"
                />
              </div>
            ) : null}
            {error ? (
              <Text color="red" size="2">
                {error}
              </Text>
            ) : null}
            <Flex align="center" justify="between" mt="2">
              <Text size="2" color="gray">
                {mode === "signup" ? "Already have an account?" : "Need an account?"}
              </Text>
              <Button
                type="button"
                onClick={() => onModeChange(mode === "signup" ? "login" : "signup")}
                variant="ghost"
                size="2"
              >
                {mode === "signup" ? "Log in" : "Sign up"}
              </Button>
            </Flex>
            <Flex gap="3" justify="end">
              <Button type="button" variant="soft" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {mode === "signup" ? (isSubmitting ? "Creating..." : "Create account") : isSubmitting ? "Signing in..." : "Log in"}
              </Button>
            </Flex>
          </Flex>
        </form>
      </Dialog.Content>
    </Dialog.Root>
  );
}
