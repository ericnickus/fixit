import React, { useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import Splash from "./pages/Splash";   // Ensure these files exist in src/pages/
import Payment from "./pages/Payment";
import "./styles.css";

/**
 * Root Component serves as the 'Guardian'.
 * It checks the Node server for the user's session and payment status
 * before allowing App.js to mount.
 */
function Root() {
  // Access levels: 'loading', 'splash', 'payment', 'app'
  const [accessLevel, setAccessLevel] = useState('loading');

  useEffect(() => {
    // This calls your Node server on Hetzner to check the Postgres DB status
    const checkUserStatus = async () => {
      try {
        // Retrieve the token from localStorage (saved upon login)
        const token = localStorage.getItem('token');

        // If no token exists, send them straight to the splash page
        if (!token) {
          setAccessLevel('splash');
          return;
        }

        const response = await fetch("/api/auth/status", {
          headers: {
            "Authorization": `Bearer ${token}` // Pass the token to verify the user
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          // Logic based on your Postgres users table columns
          if (!data.authenticated) {
            setAccessLevel('splash');
          } else if (!data.hasPaid) {
            setAccessLevel('payment');
          } else {
            setAccessLevel('app');
          }
        } else {
          setAccessLevel('splash');
        }
      } catch (error) {
        console.error("Auth check failed:", error);
        setAccessLevel('splash');
      }
    };

    checkUserStatus();
  }, []);

  // Show a simple loader while the server responds
  if (accessLevel === 'loading') {
    return (
      <div className="app-shell" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh' }}>
        <span className="spinner-wheel"></span>
      </div>
    );
  }

  return (
    <React.StrictMode>
      {/* 1. Show Splash Page for Login/Signup */}
      {accessLevel === 'splash' && (
        <Splash onLoginSuccess={() => setAccessLevel('payment')} />
      )}

      {/* 2. Show Payment Page if logged in but $5 not paid */}
      {accessLevel === 'payment' && (
        <Payment onPaymentSuccess={() => setAccessLevel('app')} />
      )}

      {/* 3. Show your actual Repair App only after payment */}
      {accessLevel === 'app' && <App />}
    </React.StrictMode>
  );
}

const container = document.getElementById("root");
const root = createRoot(container);
root.render(<Root />);