import React, { useState } from "react";

export default function Splash({ onLoginSuccess }) {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    try {
      // Replace this URL with your Hetzner Node API endpoint
      const endpoint = isLogin ? "/api/auth/login" : "/api/auth/signup";
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (response.ok) {
        // 1. Save the token to localStorage so main.jsx can read it!
        if (data.token) {
          localStorage.setItem("token", data.token);
        }

        // 2. This triggers the switch to Payment or App in main.jsx
        onLoginSuccess();
      } else {
        setError(data.message || "Authentication failed. Please try again.");
      }
    } catch (err) {
      setError("Server error. Please check your connection.");
    }
  };

  return (
    <div className="splash-page">
      <div className="splash-content">
        {/* CENTERED IMAGE / LOGO */}
        <div className="logo-container">
          <img 
            src="/logo.jpg" 
            alt="App Logo" 
            className="splash-logo" 
          />
        </div>

        <h1>{isLogin ? "Welcome Back" : "Create Account"}</h1>
        <p className="subtitle">Secure access to professional repair plans.</p>

        <form className="auth-form" onSubmit={handleSubmit}>
          <div className="input-group">
            <label>Email Address</label>
            <input 
              type="email" 
              value={email} 
              onChange={(e) => setEmail(e.target.value)} 
              placeholder="you@example.com"
              required 
            />
          </div>

          <div className="input-group">
            <label>Password</label>
            <input 
              type="password" 
              value={password} 
              onChange={(e) => setPassword(e.target.value)} 
              placeholder="••••••••"
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
          onClick={() => setIsLogin(!isLogin)}
        >
          {isLogin ? "Need an account? Sign up" : "Already have an account? Log in"}
        </button>
      </div>

      <style jsx>{`
        .splash-page {
          background-color: #0a0a0a; /* Deep Black/Dark Grey */
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          font-family: sans-serif;
        }

        .splash-content {
          width: 100%;
          max-width: 400px;
          padding: 2rem;
          text-align: center;
          background: #121212;
          border: 1px solid #333;
          border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0,0,0,0.5);
        }

        .logo-container {
          margin-bottom: 2rem;
        }

        .splash-logo {
          width: 120px;
          height: auto;
          filter: drop-shadow(0 0 10px rgba(255,255,255,0.1));
        }

        h1 { font-size: 1.8rem; margin-bottom: 0.5rem; }
        .subtitle { color: #888; margin-bottom: 2rem; font-size: 0.9rem; }

        .auth-form {
          display: flex;
          flex-direction: column;
          gap: 1.2rem;
          text-align: left;
        }

        .input-group label {
          display: block;
          font-size: 0.8rem;
          margin-bottom: 0.4rem;
          color: #bbb;
        }

        .input-group input {
          width: 100%;
          padding: 0.8rem;
          background: #1d1d1d;
          border: 1px solid #333;
          border-radius: 6px;
          color: white;
          outline: none;
        }

        .input-group input:focus {
          border-color: #555;
        }

        .btn-primary {
          background: #ffffff;
          color: #000;
          padding: 0.9rem;
          border: none;
          border-radius: 6px;
          font-weight: bold;
          cursor: pointer;
          transition: transform 0.1s;
        }

        .btn-primary:active { transform: scale(0.98); }

        .auth-error { color: #ff5555; font-size: 0.8rem; margin: 0; }

        .btn-link {
          background: none;
          border: none;
          color: #888;
          margin-top: 1.5rem;
          cursor: pointer;
          font-size: 0.85rem;
          text-decoration: underline;
        }
      `}</style>
    </div>
  );
}