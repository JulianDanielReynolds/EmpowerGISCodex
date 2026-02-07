import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from "react";
import { login, register } from "../lib/api";
export default function AuthCard({ onLoginSuccess }) {
    const [mode, setMode] = useState("login");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [email, setEmail] = useState("");
    const [companyName, setCompanyName] = useState("");
    const [phoneNumber, setPhoneNumber] = useState("");
    const [error, setError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const handleSubmit = async (event) => {
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
        }
        catch (err) {
            setError(err instanceof Error ? err.message : "Unable to authenticate");
        }
        finally {
            setIsSubmitting(false);
        }
    };
    return (_jsx("div", { className: "overlay", children: _jsxs("section", { className: "modal auth", children: [_jsx("h2", { children: mode === "login" ? "Login" : "Create Account" }), _jsx("p", { children: "Use your EmpowerGIS account to access Austin metro layers." }), _jsxs("form", { onSubmit: handleSubmit, children: [_jsxs("label", { children: ["Username", _jsx("input", { autoComplete: "username", value: username, onChange: (event) => setUsername(event.target.value), required: true })] }), mode === "register" ? (_jsxs(_Fragment, { children: [_jsxs("label", { children: ["Email", _jsx("input", { type: "email", autoComplete: "email", value: email, onChange: (event) => setEmail(event.target.value), required: true })] }), _jsxs("label", { children: ["Company Name", _jsx("input", { autoComplete: "organization", value: companyName, onChange: (event) => setCompanyName(event.target.value), required: true })] }), _jsxs("label", { children: ["Phone Number", _jsx("input", { autoComplete: "tel", value: phoneNumber, onChange: (event) => setPhoneNumber(event.target.value), required: true })] })] })) : null, _jsxs("label", { children: ["Password", _jsx("input", { type: "password", autoComplete: mode === "login" ? "current-password" : "new-password", value: password, onChange: (event) => setPassword(event.target.value), required: true })] }), error ? _jsx("p", { className: "error", children: error }) : null, _jsx("button", { className: "primary", type: "submit", disabled: isSubmitting, children: isSubmitting
                                ? "Submitting..."
                                : mode === "login"
                                    ? "Sign In"
                                    : "Register and Sign In" }), _jsx("button", { className: "ghost", type: "button", disabled: isSubmitting, onClick: () => {
                                setError(null);
                                setMode((current) => (current === "login" ? "register" : "login"));
                            }, children: mode === "login" ? "Need an account?" : "Already registered?" })] })] }) }));
}
