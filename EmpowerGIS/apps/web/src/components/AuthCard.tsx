import { useState, type FormEvent } from "react";
import { login, register } from "../lib/api";

interface AuthCardProps {
  onLoginSuccess: (tokens: { accessToken: string; refreshToken: string }) => void;
}

type AuthMode = "login" | "register";

export default function AuthCard({ onLoginSuccess }: AuthCardProps) {
  const [mode, setMode] = useState<AuthMode>("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [phoneNumber, setPhoneNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      if (mode === "register") {
        await register({
          username,
          email,
          password,
          phoneNumber,
          companyName
        });
      }

      const response = await login({ username, password });
      onLoginSuccess({
        accessToken: response.accessToken,
        refreshToken: response.refreshToken
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to authenticate");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="overlay">
      <section className="modal auth">
        <h2>{mode === "login" ? "Login" : "Create Account"}</h2>
        <p>Use your EmpowerGIS account to access Austin metro layers.</p>
        <form onSubmit={handleSubmit}>
          <label>
            Username
            <input
              autoComplete="username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              required
            />
          </label>

          {mode === "register" ? (
            <>
              <label>
                Email
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </label>
              <label>
                Company Name
                <input
                  autoComplete="organization"
                  value={companyName}
                  onChange={(event) => setCompanyName(event.target.value)}
                  required
                />
              </label>
              <label>
                Phone Number
                <input
                  autoComplete="tel"
                  value={phoneNumber}
                  onChange={(event) => setPhoneNumber(event.target.value)}
                  required
                />
              </label>
            </>
          ) : null}

          <label>
            Password
            <input
              type="password"
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error ? <p className="error">{error}</p> : null}
          <button className="primary" type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? "Submitting..."
              : mode === "login"
                ? "Sign In"
                : "Register and Sign In"}
          </button>
          <button
            className="ghost"
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              setError(null);
              setMode((current) => (current === "login" ? "register" : "login"));
            }}
          >
            {mode === "login" ? "Need an account?" : "Already registered?"}
          </button>
        </form>
      </section>
    </div>
  );
}
