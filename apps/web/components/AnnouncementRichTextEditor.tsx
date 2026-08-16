"use client";

import { useEffect, useRef, useState, type ClipboardEvent, type MouseEvent } from "react";
import { Check, LinkBreak, LinkSimple } from "@phosphor-icons/react";
import type { AnnouncementColor, AnnouncementSegment } from "@ai-card/contracts";

const EMPTY_SEGMENT: AnnouncementSegment = { text: "", bold: false, italic: false, underline: false, color: "default", href: null };
const COLORS: Array<{ value: AnnouncementColor; label: string; command: string }> = [
  { value: "default", label: "默认", command: "#344054" },
  { value: "blue", label: "蓝色", command: "#1d4ed8" },
  { value: "orange", label: "橙色", command: "#a33b0b" },
  { value: "green", label: "绿色", command: "#067647" },
  { value: "red", label: "红色", command: "#b42318" },
];

type Marks = Omit<AnnouncementSegment, "text">;
type Props = { value: AnnouncementSegment[]; onChange: (value: AnnouncementSegment[]) => void; disabled?: boolean };

export function AnnouncementRichTextEditor({ value, onChange, disabled = false }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const selectionRef = useRef<Range | null>(null);
  const emittedSignatureRef = useRef("");
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkValue, setLinkValue] = useState("");
  const [linkError, setLinkError] = useState("");
  const [hasSelection, setHasSelection] = useState(false);
  const [active, setActive] = useState({ bold: false, italic: false, underline: false, color: "default" as AnnouncementColor, linked: false });

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const normalized = normalizeSegments(value);
    const signature = segmentSignature(normalized);
    if (signature === emittedSignatureRef.current) return;
    writeSegments(editor, normalized);
    emittedSignatureRef.current = signature;
  }, [value]);

  function syncFromEditor() {
    const editor = editorRef.current;
    if (!editor) return;
    const next = readSegments(editor);
    emittedSignatureRef.current = segmentSignature(next);
    onChange(next);
    updateToolbarState();
  }

  function rememberSelection() {
    const editor = editorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection?.rangeCount) return;
    const range = selection.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    selectionRef.current = range.cloneRange();
    setHasSelection(!range.collapsed);
    updateToolbarState();
  }

  function restoreSelection() {
    const selection = window.getSelection();
    if (!selection || !selectionRef.current) return false;
    selection.removeAllRanges();
    selection.addRange(selectionRef.current);
    return true;
  }

  function updateToolbarState() {
    const selection = window.getSelection();
    const editor = editorRef.current;
    if (!editor || !selection?.rangeCount || !editor.contains(selection.anchorNode)) return;
    const anchor = selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement;
    setActive({
      bold: document.queryCommandState("bold"),
      italic: document.queryCommandState("italic"),
      underline: document.queryCommandState("underline"),
      color: parseColor(document.queryCommandValue("foreColor")) || "default",
      linked: Boolean(anchor?.closest("a")),
    });
  }

  function applyCommand(event: MouseEvent<HTMLButtonElement>, command: "bold" | "italic" | "underline") {
    event.preventDefault();
    rememberSelection();
    if (!restoreSelection()) return;
    document.execCommand(command, false);
    editorRef.current?.focus();
    rememberSelection();
    syncFromEditor();
  }

  function applyColor(color: AnnouncementColor) {
    if (!restoreSelection()) return;
    document.execCommand("foreColor", false, COLORS.find((item) => item.value === color)?.command || COLORS[0].command);
    editorRef.current?.focus();
    rememberSelection();
    syncFromEditor();
  }

  function openLinkEditor(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    rememberSelection();
    if (!selectionRef.current || selectionRef.current.collapsed) return;
    setLinkValue(closestAnchor(selectionRef.current.startContainer)?.getAttribute("href") || "");
    setLinkError("");
    setLinkOpen(true);
  }

  function applyLink() {
    const href = linkValue.trim();
    if (!isSafeHref(href)) {
      setLinkError("仅允许站内路径或 HTTPS 地址");
      return;
    }
    if (!restoreSelection()) return;
    document.execCommand("createLink", false, href);
    setLinkOpen(false);
    setLinkError("");
    editorRef.current?.focus();
    rememberSelection();
    syncFromEditor();
  }

  function removeLink(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
    rememberSelection();
    if (!restoreSelection()) return;
    document.execCommand("unlink", false);
    editorRef.current?.focus();
    rememberSelection();
    syncFromEditor();
  }

  function pastePlainText(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain").replace(/[\r\n]+/g, " ");
    document.execCommand("insertText", false, text);
    syncFromEditor();
  }

  return <div className="announcement-rich-editor">
    <div className="announcement-rich-toolbar" role="toolbar" aria-label="公告文字格式">
      <button className={active.bold ? "format-button is-active" : "format-button"} type="button" aria-label="加粗所选文字" title="加粗" aria-pressed={active.bold} disabled={disabled} onMouseDown={(event) => applyCommand(event, "bold")}><strong>B</strong></button>
      <button className={active.italic ? "format-button is-active" : "format-button"} type="button" aria-label="倾斜所选文字" title="斜体" aria-pressed={active.italic} disabled={disabled} onMouseDown={(event) => applyCommand(event, "italic")}><em>I</em></button>
      <button className={active.underline ? "format-button is-active" : "format-button"} type="button" aria-label="给所选文字添加下划线" title="下划线" aria-pressed={active.underline} disabled={disabled} onMouseDown={(event) => applyCommand(event, "underline")}><u>U</u></button>
      <label className="announcement-rich-color"><span>颜色</span><select aria-label="所选文字颜色" value={active.color} disabled={disabled} onMouseDown={rememberSelection} onChange={(event) => applyColor(event.target.value as AnnouncementColor)}>{COLORS.map((color) => <option value={color.value} key={color.value}>{color.label}</option>)}</select></label>
      <span className="announcement-toolbar-divider" aria-hidden="true" />
      <button className={active.linked ? "format-button is-active" : "format-button"} type="button" aria-label="给所选文字添加链接" title="添加或修改链接" disabled={disabled || !hasSelection} onMouseDown={openLinkEditor}><LinkSimple /></button>
      <button className="format-button" type="button" aria-label="移除所选文字的链接" title="移除链接" disabled={disabled || !active.linked} onMouseDown={removeLink}><LinkBreak /></button>
    </div>
    {linkOpen && <div className="announcement-link-popover" role="group" aria-label="设置所选文字链接">
      <label><span>链接地址</span><input autoFocus value={linkValue} onChange={(event) => { setLinkValue(event.target.value); setLinkError(""); }} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); applyLink(); } if (event.key === "Escape") { event.preventDefault(); setLinkOpen(false); setLinkError(""); } }} maxLength={500} placeholder="/privacy 或 https://example.com" /></label>
      <button className="icon-button primary" type="button" aria-label="应用链接" title="应用链接" onClick={applyLink}><Check /></button>
      <button className="button ghost compact" type="button" onClick={() => { setLinkOpen(false); setLinkError(""); }}>取消</button>
      {linkError && <small role="alert">{linkError}</small>}
    </div>}
    <div ref={editorRef} className="announcement-rich-input" contentEditable={!disabled} role="textbox" aria-label="公告内容" aria-multiline="false" data-placeholder="输入公告内容" suppressContentEditableWarning onInput={syncFromEditor} onMouseUp={rememberSelection} onKeyUp={rememberSelection} onFocus={rememberSelection} onPaste={pastePlainText} onDrop={(event) => event.preventDefault()} onClick={(event) => { if ((event.target as Element).closest("a")) event.preventDefault(); }} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault(); }} />
  </div>;
}

function writeSegments(editor: HTMLDivElement, segments: AnnouncementSegment[]) {
  const fragment = document.createDocumentFragment();
  for (const segment of segments) {
    if (!segment.text) continue;
    const element = document.createElement(segment.href ? "a" : "span");
    element.className = segmentClassName(segment);
    element.textContent = segment.text;
    if (segment.href) element.setAttribute("href", segment.href);
    fragment.appendChild(element);
  }
  editor.replaceChildren(fragment);
}

function readSegments(editor: HTMLDivElement) {
  const segments: AnnouncementSegment[] = [];
  const visit = (node: Node, marks: Marks) => {
    if (node.nodeType === Node.TEXT_NODE) {
      appendSegment(segments, (node.textContent || "").replace(/\u00a0/g, " ").replace(/[\r\n]+/g, " "), marks);
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.tagName === "BR") { appendSegment(segments, " ", marks); return; }
    const next = marksFromElement(node, marks);
    node.childNodes.forEach((child) => visit(child, next));
  };
  editor.childNodes.forEach((node) => visit(node, { bold: false, italic: false, underline: false, color: "default", href: null }));
  return normalizeSegments(segments);
}

function marksFromElement(element: HTMLElement, current: Marks): Marks {
  const fontWeight = element.style.fontWeight;
  const colorClass = (["default", "blue", "orange", "green", "red"] as AnnouncementColor[]).find((color) => element.classList.contains(`color-${color}`));
  return {
    bold: current.bold || ["B", "STRONG"].includes(element.tagName) || fontWeight === "bold" || Number(fontWeight) >= 600,
    italic: current.italic || ["I", "EM"].includes(element.tagName) || element.style.fontStyle === "italic",
    underline: current.underline || element.tagName === "U" || element.style.textDecoration.includes("underline"),
    color: colorClass || parseColor(element.getAttribute("color") || element.style.color) || current.color,
    href: element.tagName === "A" ? element.getAttribute("href") : current.href,
  };
}

function appendSegment(target: AnnouncementSegment[], text: string, marks: Marks) {
  if (!text) return;
  let remaining = text;
  while (remaining) {
    const previous = target.at(-1);
    const sameMarks = previous && previous.bold === marks.bold && previous.italic === marks.italic && previous.underline === marks.underline && previous.color === marks.color && previous.href === marks.href;
    if (sameMarks && previous.text.length < 200) {
      const room = 200 - previous.text.length;
      previous.text += remaining.slice(0, room);
      remaining = remaining.slice(room);
    } else {
      target.push({ text: remaining.slice(0, 200), ...marks });
      remaining = remaining.slice(200);
    }
  }
}

function normalizeSegments(segments: AnnouncementSegment[]) {
  const normalized: AnnouncementSegment[] = [];
  for (const segment of segments) appendSegment(normalized, segment.text, { bold: segment.bold, italic: segment.italic, underline: segment.underline, color: segment.color, href: segment.href || null });
  if (!normalized.length) return [{ ...EMPTY_SEGMENT }];
  if (normalized.length <= 50) return normalized;
  const flattened: AnnouncementSegment[] = [];
  appendSegment(flattened, normalized.map((segment) => segment.text).join("").slice(0, 10_000), { bold: false, italic: false, underline: false, color: "default", href: null });
  return flattened;
}

function segmentSignature(segments: AnnouncementSegment[]) {
  return JSON.stringify(segments.map((segment) => [segment.text, segment.bold, segment.italic, segment.underline, segment.color, segment.href]));
}

function segmentClassName(segment: AnnouncementSegment) {
  return `announcement-segment color-${segment.color}${segment.bold ? " is-bold" : ""}${segment.italic ? " is-italic" : ""}${segment.underline ? " is-underlined" : ""}`;
}

function closestAnchor(node: Node) {
  const element = node instanceof Element ? node : node.parentElement;
  return element?.closest("a") || null;
}

function parseColor(value: string): AnnouncementColor | null {
  const normalized = value.toLowerCase().replace(/\s/g, "");
  if (["#1d4ed8", "rgb(29,78,216)"].includes(normalized)) return "blue";
  if (["#a33b0b", "rgb(163,59,11)"].includes(normalized)) return "orange";
  if (["#067647", "rgb(6,118,71)"].includes(normalized)) return "green";
  if (["#b42318", "rgb(180,35,24)"].includes(normalized)) return "red";
  if (["#344054", "rgb(52,64,84)"].includes(normalized)) return "default";
  return null;
}

function isSafeHref(value: string) {
  if (value.startsWith("/") && !value.startsWith("//")) return true;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch { return false; }
}
