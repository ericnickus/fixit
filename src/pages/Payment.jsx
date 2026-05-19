import React, { useState } from "react";

export default function Payment({ userEmail, onPaymentSuccess }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const username = userEmail ? userEmail.split("@")[0] : "";

  const handlePay = async () => {
    setLoading(true);
    setError("");

    try {
      const token = localStorage.getItem("token");

      const response = await fetch("/api/payment/charge", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (response.ok && data.success) {
        if (onPaymentSuccess) {
          onPaymentSuccess();
        }
      } else {
        setError(data.message || "Payment failed. Please try again.");
      }
    } catch (err) {
      setError("Network error. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={styles.paymentPage}>
      {username && (
        <div style={styles.welcomeBanner}>
          Welcome, <span style={styles.welcomeUsername}>{username}</span>
        </div>
      )}

      <div style={styles.paymentContent}>
        <h1 style={styles.heading}>Complete Setup Fee</h1>
        <p style={styles.subtitle}>Unlock your plan by confirming your payment.</p>

        {error && <p style={styles.paymentError}>{error}</p>}

        <button
          onClick={handlePay}
          style={{
            ...styles.btn,
            ...styles.btnPrimary,
            ...(loading ? styles.btnDisabled : {})
          }}
          disabled={loading}
        >
          {loading ? "Processing..." : "Pay Now ($5.00)"}
        </button>
      </div>
    </div>
  );
}

const styles = {
  paymentPage: {
    position: "relative",
    backgroundColor: "#0a0a0a",
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#ffffff",
    fontFamily: "sans-serif",
  },
  welcomeBanner: {
    position: "absolute",
    top: "24px",
    right: "24px",
    fontSize: "0.85rem",
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: "0.05em",
  },
  welcomeUsername: { color: "#ffffff", fontWeight: "bold" },
  paymentContent: {
    width: "100%",
    maxWidth: "400px",
    padding: "2.5rem",
    textAlign: "center",
    background: "#121212",
    border: "1px solid #333",
    borderRadius: "12px",
    boxShadow: "0 10px 30px rgba(0, 0, 0, 0.6)",
  },
  heading: { fontSize: "1.8rem", marginBottom: "0.5rem", marginTop: 0 },
  subtitle: { color: "#888", marginBottom: "2rem", fontSize: "0.9rem" },
  btn: {
    width: "100%",
    padding: "0.9rem",
    border: "none",
    borderRadius: "6px",
    fontWeight: "bold",
    cursor: "pointer",
    fontSize: "1rem",
  },
  btnPrimary: { background: "#ffffff", color: "#000" },
  btnDisabled: { background: "#555", color: "#888", cursor: "not-allowed" },
  paymentError: { color: "#ff5555", fontSize: "0.85rem", marginBottom: "1rem" },
};
