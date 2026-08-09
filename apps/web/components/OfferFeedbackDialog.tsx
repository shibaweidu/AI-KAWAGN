"use client";

import { useEffect, useRef, useState } from "react";
import { CheckCircle, Flag, SpinnerGap, X } from "@phosphor-icons/react";
import { offerFeedbackTypeSchema, type OfferFeedback } from "@ai-card/contracts";
import { submitOfferFeedback } from "@/lib/home-api";

const reasons = [
  ["price_error", "价格错误"],
  ["stock_error", "库存错误"],
  ["broken_link", "链接失效"],
  ["other", "其他问题"],
] as const;

export function OfferFeedbackDialog({ offerId, productName }: { offerId: string; productName: string }) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<OfferFeedback["type"]>("price_error");
  const [details, setDetails] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => event.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setStatus("submitting");
    setMessage("");
    try {
      const validType = offerFeedbackTypeSchema.parse(type);
      await submitOfferFeedback(offerId, { type: validType, details: details.trim() || undefined });
      setStatus("success");
      setMessage("已收到，我们会核对这条报价。");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "反馈提交失败，请稍后重试");
    }
  }

  return <>
    <button className="offer-feedback-trigger" type="button" onClick={() => { setOpen(true); setStatus("idle"); setMessage(""); }} aria-label={`反馈 ${productName} 的报价问题`} title="反馈报价问题"><Flag /></button>
    {open && <div className="modal-backdrop" onMouseDown={(event) => event.currentTarget === event.target && setOpen(false)}>
      <section className="feedback-dialog" role="dialog" aria-modal="true" aria-labelledby={`feedback-title-${offerId}`}>
        <div className="feedback-dialog-head"><div><span className="kicker"><Flag />信息纠错</span><h2 id={`feedback-title-${offerId}`}>反馈报价问题</h2><p>{productName}</p></div><button ref={closeButton} className="icon-button" type="button" onClick={() => setOpen(false)} aria-label="关闭反馈窗口"><X /></button></div>
        {status === "success" ? <div className="feedback-success" role="status"><CheckCircle weight="fill" /><strong>{message}</strong><button className="button dark" type="button" onClick={() => setOpen(false)}>完成</button></div> : <form onSubmit={submit}>
          <fieldset><legend>问题类型</legend><div className="feedback-reasons">{reasons.map(([value, label]) => <label key={value}><input type="radio" name={`reason-${offerId}`} value={value} checked={type === value} onChange={() => setType(value)} /><span>{label}</span></label>)}</div></fieldset>
          <label className="feedback-details">补充说明（选填）<textarea value={details} onChange={(event) => setDetails(event.target.value)} maxLength={500} rows={4} placeholder="请说明你看到的价格、库存或链接状态"/><small>{details.length}/500</small></label>
          {status === "error" && <p className="dialog-error" role="alert">{message}</p>}
          <div className="dialog-actions"><button className="button ghost" type="button" onClick={() => setOpen(false)}>取消</button><button className="button dark" type="submit" disabled={status === "submitting"}>{status === "submitting" ? <><SpinnerGap className="spin" />提交中</> : "提交反馈"}</button></div>
        </form>}
      </section>
    </div>}
  </>;
}
