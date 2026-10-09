import { useEffect, useState, useRef } from "react";
import { useParams, useSearchParams, Link } from "react-router-dom";
import axios from "axios";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import { API } from "@/lib/api";
import "@/pages/store/store.css";

export default function StorePayment() {
  const { slug, result } = useParams();
  const [sp] = useSearchParams();
  const sessionId = sp.get("session_id");
  const [state, setState] = useState(result === "cancel" ? "cancelled" : "checking");
  const [orderId, setOrderId] = useState(sp.get("order_id"));
  const tries = useRef(0);

  useEffect(() => {
    if (result !== "success" || !sessionId) return;
    let stop = false;
    const poll = async () => {
      if (stop) return;
      try {
        const { data } = await axios.get(`${API}/public/payments/status/${sessionId}`);
        setOrderId(data.order_id);
        if (data.payment_status === "paid") return setState("paid");
        if (["failed", "expired"].includes(data.payment_status)) return setState("failed");
      } catch {
        /* keep polling */
      }
      if (++tries.current >= 10) return setState("timeout");
      setTimeout(poll, 2000);
    };
    poll();
    return () => { stop = true; };
  }, [result, sessionId]);

  const view = {
    checking: [Loader2, "Sprawdzamy płatność…", "To potrwa chwilę. Nie zamykaj strony.", "animate-spin text-neutral-500"],
    paid: [CheckCircle2, "Płatność przyjęta!", "Zamówienie trafiło do kuchni. Możesz śledzić jego status.", "text-emerald-600"],
    failed: [XCircle, "Płatność nie powiodła się", "Spróbuj ponownie lub wybierz płatność przy odbiorze.", "text-[#c8553d]"],
    cancelled: [XCircle, "Płatność anulowana", "Zamówienie czeka – możesz wrócić do koszyka i zapłacić ponownie.", "text-[#c8553d]"],
    timeout: [Loader2, "Płatność w trakcie weryfikacji", "Potwierdzenie przyjdzie za moment. Sprawdź status zamówienia.", "text-neutral-500"],
  }[state];
  const Icon = view[0];

  return (
    <div className="store min-h-screen grid place-items-center p-6">
      <div className="max-w-md w-full text-center bg-[#fffdf8] border border-[#e4dccb] rounded-2xl p-10" data-testid={`payment-${state}`}>
        <Icon size={44} className={`mx-auto mb-5 ${view[3]}`} />
        <h1 className="font-serif text-3xl">{view[1]}</h1>
        <p className="text-neutral-600 mt-3">{view[2]}</p>
        <div className="mt-8 flex flex-col gap-2">
          {orderId && <Link to={`/s/${slug}/order/${orderId}`} className="store-btn justify-center" data-testid="track-order">Śledź zamówienie</Link>}
          <Link to={`/s/${slug}`} className="store-btn secondary justify-center" data-testid="back-to-store">Wróć do menu</Link>
        </div>
      </div>
    </div>
  );
}
