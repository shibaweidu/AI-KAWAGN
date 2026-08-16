"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowsLeftRight, CheckCircle, Eye, EyeSlash, LockKey, PaperPlaneTilt, ShieldCheck, Storefront, WarningCircle } from "@phosphor-icons/react";
import * as OTPAuth from "otpauth";

function useApiForm() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  async function submit(url: string, payload: unknown, success: (body: any) => string, completed?: (body: any) => void) {
    setLoading(true); setMessage(""); setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, credentials: "include", body: JSON.stringify(payload) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || "请求处理失败");
      setMessage(success(body));
      completed?.(body);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "网络异常，请稍后重试"); }
    finally { setLoading(false); }
  }
  return { message, error, loading, submit };
}

function ResultMessage({ message, error }: { message: string; error: string }) {
  if (message) return <p className="form-success" role="status"><CheckCircle weight="fill" />{message}</p>;
  if (error) return <p className="form-error" role="alert"><WarningCircle weight="fill" />{error}</p>;
  return null;
}

export function SubmitShopForm() {
  const state = useApiForm();
  const [kind, setKind] = useState<"shop" | "gateway">("shop");
  const isGateway = kind === "gateway";
  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    void state.submit("/api/v1/submissions", {
      kind,
      name: data.get("name"),
      url: data.get("url"),
      contactEmail: data.get("email"),
      description: data.get("description"),
      authorizationConfirmed: data.get("authorized") === "on",
      website: data.get("website"),
    }, (body) => body.id ? `已收到投稿，编号：${body.id}。运营将在 1 个工作日内审核。` : "已收到投稿，运营将在 1 个工作日内审核。");
  }
  return <form className="form-card submission-form" onSubmit={onSubmit}>
    <div className="segmented submission-kind" aria-label="投稿类型"><button type="button" className={!isGateway ? "active" : ""} onClick={() => setKind("shop")}><Storefront />提交店铺</button><button type="button" className={isGateway ? "active" : ""} onClick={() => setKind("gateway")}><ArrowsLeftRight />提交中转站</button></div>
    <label>{isGateway ? "中转站名称" : "店铺名称"}<input name="name" required maxLength={200} placeholder={isGateway ? "例如：示例 API" : "例如：示例数字商店"} /></label>
    <label>{isGateway ? "中转站官网或服务介绍页" : "店铺 HTTPS 链接"}<input name="url" type="url" required pattern="https://.*" placeholder={isGateway ? "https://api.example.com" : "https://your-shop.example.com"} /></label>
    <label>联系邮箱<input name="email" type="email" required placeholder="owner@example.com" /></label>
    <label>补充说明（选填）<textarea name="description" maxLength={1000} rows={4} placeholder={isGateway ? "可说明服务特点、支持的模型或活动信息" : "可说明商品范围、授权方式或同步资料"} /></label>
    <label className="submission-honeypot" aria-hidden="true">网站<input name="website" tabIndex={-1} autoComplete="off" /></label>
    <label className="checkbox"><input name="authorized" type="checkbox" required /><span>我确认拥有该{isGateway ? "中转站" : "店铺"}或已获得公开收录授权</span></label>
    <p className="submission-note"><ShieldCheck />无需登录；请勿提交 API Key、账号密码或其他敏感凭据。</p>
    <button className="button dark" type="submit" disabled={state.loading}><ShieldCheck />{state.loading ? "提交中..." : "提交审核"}</button><ResultMessage message={state.message} error={state.error} />
  </form>;
}

export function DemandForm() {
  const state = useApiForm();
  function onSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); void state.submit("/api/v1/demands", { title: data.get("title"), description: data.get("description"), budget: Number(data.get("budget") || 0) }, () => "需求已提交，审核通过后将在大厅展示。"); }
  return <form className="form-card compact-form" onSubmit={onSubmit}><label>需求标题<input name="title" required minLength={6} placeholder="你正在寻找什么？" /></label><label>详细说明<textarea name="description" required minLength={20} rows={4} placeholder="请说明数量、规格、预算和期望交付时间" /></label><label>预算（元）<input name="budget" type="number" min="0" max="100000" placeholder="选填" /></label><button className="button dark" type="submit" disabled={state.loading}><PaperPlaneTilt />{state.loading ? "提交中..." : "发布需求"}</button><ResultMessage message={state.message} error={state.error} /></form>;
}

export function FeedbackForm() {
  const state = useApiForm();
  function onSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); void state.submit("/api/v1/feedback", { contact: data.get("contact") || undefined, message: data.get("message") }, (body) => `已提交，查询编号：${body.ticket}`); }
  return <form className="form-card" onSubmit={onSubmit}><label>联系方式（选填）<input name="contact" placeholder="邮箱、QQ 或手机" /></label><label>问题与建议<textarea name="message" required minLength={10} rows={7} placeholder="请描述页面、操作步骤和问题现象" /></label><button className="button dark" type="submit" disabled={state.loading}><PaperPlaneTilt />{state.loading ? "提交中..." : "提交反馈"}</button><ResultMessage message={state.message} error={state.error} /></form>;
}

export function AccountForm({ initialMode = "login" }: { initialMode?: "login" | "register" }) {
  const [mode, setMode] = useState(initialMode); const [show, setShow] = useState(false); const state = useApiForm(); const router = useRouter();
  function onSubmit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); const data = new FormData(event.currentTarget); void state.submit(`/api/v1/auth/${mode}`, { email: data.get("email"), password: data.get("password") }, () => mode === "login" ? "登录成功，正在进入账户。" : "注册成功，正在进入账户。", (body) => { window.dispatchEvent(new Event("ai-card-auth-changed")); const role = body?.user?.role; router.replace(role === "admin" || role === "moderator" ? "/admin" : "/"); router.refresh(); }); }
  return <div className="account-card"><div className="segmented account-tabs"><button className={mode === "login" ? "active" : ""} onClick={() => setMode("login")}>登录</button><button className={mode === "register" ? "active" : ""} onClick={() => setMode("register")}>注册</button></div><h2>{mode === "login" ? "欢迎回来" : "创建账户"}</h2><p>{mode === "login" ? "继续管理关注、评论和店铺。" : "注册后可直接登录，关注店铺与认领自己的店铺。"}</p><form onSubmit={onSubmit}><label>邮箱<input name="email" type="email" required placeholder="name@example.com" autoComplete="email" /></label><label>密码<span className="password-field"><input name="password" type={show ? "text" : "password"} required minLength={8} placeholder="至少 8 位" autoComplete={mode === "login" ? "current-password" : "new-password"} /><button type="button" className="icon-button" onClick={() => setShow(!show)} aria-label={show ? "隐藏密码" : "显示密码"}>{show ? <EyeSlash /> : <Eye />}</button></span></label><button className="button dark account-submit" type="submit" disabled={state.loading}><LockKey />{state.loading ? "处理中..." : mode === "login" ? "登录用户中心" : "注册并登录"}</button><ResultMessage message={state.message} error={state.error} /></form><small className="privacy-note"><ShieldCheck />密码使用 Argon2id 处理，会话仅存入 HTTP-only Cookie。</small></div>;
}

export function LocalTools() {
  const [secret, setSecret] = useState(""); const [code, setCode] = useState("——————"); const [input, setInput] = useState(""); const [output, setOutput] = useState("");
  function generate() { try { const totp = new OTPAuth.TOTP({ secret: secret.replace(/\s/g, "").toUpperCase(), digits: 6, period: 30 }); setCode(totp.generate()); } catch { setCode("格式错误"); } }
  function convert() { try { setOutput(JSON.stringify(JSON.parse(input), null, 2)); } catch { const parts = input.split(/[-|]{2,}/).map((value) => value.trim()).filter(Boolean); setOutput(JSON.stringify({ account: parts[0] || "", password: parts[1] || "", token: parts[2] || "" }, null, 2)); } }
  return <div className="tools-grid"><section className="panel tool-card"><span className="kicker"><LockKey />2FA</span><h2>TOTP 验证码</h2><p>所有计算均在浏览器本地完成，密钥不会发送到服务器。</p><label>密钥<input value={secret} onChange={(event) => setSecret(event.target.value)} placeholder="JBSWY3DPEHPK3PXP" /></label><div className="totp-code" aria-live="polite">{code}</div><button className="button dark" onClick={generate}>生成验证码</button></section><section className="panel tool-card"><span className="kicker"><ShieldCheck />本地转换</span><h2>Session 格式化</h2><p>将你自己的结构化数据转换为便于阅读的 JSON，数据不会上传。</p><label>输入<textarea rows={5} value={input} onChange={(event) => setInput(event.target.value)} placeholder="粘贴 JSON 或分隔字段" /></label><button className="button dark" onClick={convert}>本地转换</button>{output && <pre className="tool-output">{output}</pre>}</section></div>;
}
