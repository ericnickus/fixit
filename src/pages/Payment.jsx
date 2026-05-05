import React, { useState } from "react";

export default function Payment({ onPaymentSuccess }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
        // 🔥 ONLY notify Root
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
    <div className="payment-page">
      <div className="payment-content">
        <h1>Complete Setup Fee</h1>

        <p className="subtitle">
          Unlock your plan by confirming your payment.
        </p>

        {error && <p className="payment-error">{error}</p>}

        <button
          onClick={handlePay}
          className="btn btn-primary"
          disabled={loading}
        >
          {loading ? "Processing..." : "Pay Now ($5.00)"}
        </button>
      </div>

      <style jsx>{`
        .payment-page {
          background-color: #0a0a0a;
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          color: #ffffff;
          font-family: sans-serif;
        }

        .payment-content {
          width: 100%;
          max-width: 400px;
          padding: 2.5rem;
          text-align: center;
          background: #121212;
          border: 1px solid #333;
          border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.6);
        }

        h1 {
          font-size: 1.8rem;
          margin-bottom: 0.5rem;
        }

        .subtitle {
          color: #888;
          margin-bottom: 2rem;
          font-size: 0.9rem;
        }

        .btn {
          width: 100%;
          padding: 0.9rem;
          border: none;
          border-radius: 6px;
          font-weight: bold;
          cursor: pointer;
        }

        .btn-primary {
          background: #ffffff;
          color: #000;
        }

        .btn-primary:disabled {
          background: #555;
          cursor: not-allowed;
        }

        .payment-error {
          color: #ff5555;
          font-size: 0.85rem;
          margin-bottom: 1rem;
        }
      `}</style>
    </div>
  );
}