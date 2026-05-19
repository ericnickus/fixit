import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import App from "./App";
import Splash from "./pages/Splash";
import Payment from "./pages/Payment";

import "./styles.css";

function Root() {
  // Single source of truth state machine: loading | guest | authed | paid
  const [status, setStatus] = useState("loading");

  // 🔄 Extracted checking function so it can be re-run on demand
  const checkUserStatus = async () => {
    try {
      const token = localStorage.getItem("token");

      if (!token) {
        setStatus("guest");
        return;
      }

      const res = await fetch("/api/auth/status", {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!res.ok) {
        localStorage.removeItem("token");
        setStatus("guest");
        return;
      }

      const data = await res.json();

      if (!data.authenticated) {
        localStorage.removeItem("token");
        setStatus("guest");
      } else if (!data.hasPaid) {
        setStatus("authed"); // Authenticated, but needs to pay $5
      } else {
        setStatus("paid"); // Authenticated and active subscriber
      }
    } catch (err) {
      console.error("Auth check failed:", err);
      localStorage.removeItem("token");
      setStatus("guest");
    }
  };

  // Run the validation once when the app first mounts
  useEffect(() => {
    checkUserStatus();
  }, []);

  // Safe Loading Screen within the Router Context
  if (status === "loading") {
    return (
      <div style={{ color: "#fff", textAlign: "center", marginTop: "20%" }}>
        Loading...
      </div>
    );
  }

  return (
    <Routes>
      {/* Explicitly catch the bare domain root / path */}
      <Route 
        path="/" 
        element={
          status === "paid" ? (
            <Navigate to="/app" replace />
          ) : status === "authed" ? (
            <Navigate to="/payment" replace />
          ) : (
            <Navigate to="/login" replace />
          )
        } 
      />

      {/* Splash / Login */}
      <Route
        path="/login"
        element={
          status === "guest" ? (
            // 💡 FIX: Pass checkUserStatus here so returning paid members don't get stuck on the paywall
            <Splash onLoginSuccess={checkUserStatus} />
          ) : status === "authed" ? (
            <Navigate to="/payment" replace />
          ) : (
            <Navigate to="/app" replace />
          )
        }
      />

      {/* Payment gate */}
      <Route
        path="/payment"
        element={
          status === "authed" ? (
            <Payment onPaymentSuccess={() => setStatus("paid")} />
          ) : status === "paid" ? (
            <Navigate to="/app" replace />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      {/* Main App */}
      <Route
        path="/app"
        element={
          status === "paid" ? (
            <App />
          ) : status === "authed" ? (
            <Navigate to="/payment" replace />
          ) : (
            <Navigate to="/login" replace />
          )
        }
      />

      {/* Default fallback route */}
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
  );
}

// Wrapping BrowserRouter OUTSIDE the Root state tree so context exists immediately
createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Root />
  </BrowserRouter>
);
