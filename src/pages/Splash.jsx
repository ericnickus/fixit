import React, { useState } from "react";
import "./Splash.css";

export default function Splash({ onLoginSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    try {
      const endpoint = isLogin
        ? "/api/auth/login"
        : "/api/auth/signup";

      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.message || "Authentication failed.");
        return;
      }

      // Save token
      if (data.token) {
        localStorage.setItem("token", data.token);
      }

      // 🔥 ONLY notify Root (no navigation)
      if (onLoginSuccess) {
        onLoginSuccess();
      }

    } catch (err) {
      setError("Server error. Please try again.");
    }
  };

  return (
    <div className="splash-page">
      <div className="splash-content">

        <div className="logo-container">
          <img
            src="/logo.jpg"
            alt="App Logo"
            className="splash-logo"
          />
        </div>

        <h1>{isLogin ? "Welcome Back" : "Create Account"}</h1>

        <p className="subtitle">
          Secure access to professional repair plans.
        </p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="input-group">
            <label>Email Address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div className="input-group">
            <label>Password</label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && <p className="auth-error">{error}</p>}

          <button type="submit" className="btn btn-primary">
            {isLogin ? "Log In" : "Sign Up"}
          </button>
        </form>

        <button
          className="btn-link"
          onClick={() => {
            setIsLogin(!isLogin);
            setError("");
          }}
        >
          {isLogin
            ? "Need an account? Sign up"
            : "Already have an account? Log in"}
        </button>

      </div>
    </div>
  );
}