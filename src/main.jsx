import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import App from "./App";
import Splash from "./pages/Splash";
import Payment from "./pages/Payment";

import "./styles.css";

function Root() {
  // Single source of truth state machine
  const [status, setStatus] = useState("loading");
  // loading | guest | authed | paid

  useEffect(() => {
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
          setStatus("authed");
        } else {
          setStatus("paid");
        }
      } catch (err) {
        console.error("Auth check failed:", err);
        localStorage.removeItem("token");
        setStatus("guest");
      }
    };

    checkUserStatus();
  }, []);

  // Loading screen
  if (status === "loading") {
    return (
      <div style={{ color: "#fff", textAlign: "center", marginTop: "20%" }}>
        Loading...
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>

        {/* Splash / Login */}
        <Route
          path="/login"
          element={
            <Splash
              onLoginSuccess={() => {
                setStatus("authed");
              }}
            />
          }
        />

        {/* Payment gate */}
        <Route
          path="/payment"
          element={
            status === "authed" ? (
              <Payment
                onPaymentSuccess={() => {
                  setStatus("paid");
                }}
              />
            ) : status === "paid" ? (
              <Navigate to="/app" />
            ) : (
              <Navigate to="/login" />
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
              <Navigate to="/payment" />
            ) : (
              <Navigate to="/login" />
            )
          }
        />

        {/* Default route */}
        <Route path="*" element={<Navigate to="/login" />} />

      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")).render(<Root />);