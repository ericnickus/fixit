import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import App from "./App";
import Splash from "./pages/Splash";
import Payment from "./pages/Payment";

import "./styles.css";

function Root() {
  const [status, setStatus] = useState({
    loading: true,
    authenticated: false,
    hasPaid: false,
  });

  useEffect(() => {
    const checkUserStatus = async () => {
      try {
        const token = localStorage.getItem("token");

        if (!token) {
          setStatus({ loading: false, authenticated: false, hasPaid: false });
          return;
        }

        const res = await fetch("/api/auth/status", {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (!res.ok) {
          setStatus({ loading: false, authenticated: false, hasPaid: false });
          return;
        }

        const data = await res.json();

        setStatus({
          loading: false,
          authenticated: data.authenticated,
          hasPaid: data.hasPaid,
        });
      } catch (err) {
        console.error(err);
        setStatus({ loading: false, authenticated: false, hasPaid: false });
      }
    };

    checkUserStatus();
  }, []);

  if (status.loading) {
    return <div>Loading...</div>;
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Login */}
        <Route
          path="/login"
          element={<Splash />}
        />

        {/* Payment protected */}
        <Route
          path="/payment"
          element={
            status.authenticated ? (
              <Payment />
            ) : (
              <Navigate to="/login" />
            )
          }
        />

        {/* App protected */}
        <Route
          path="/app"
          element={
            status.authenticated && status.hasPaid ? (
              <App />
            ) : status.authenticated ? (
              <Navigate to="/payment" />
            ) : (
              <Navigate to="/login" />
            )
          }
        />

        {/* Default redirect */}
        <Route
          path="*"
          element={<Navigate to="/login" />}
        />
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById("root")).render(<Root />);
