import { memo, useEffect, useId, useMemo, useRef, useState } from "react";
import { CONTRACTS } from "../../config/contracts";
import { GOVERNANCE_ADDRESSES } from "../governance/governanceSpec";
import "./contract-showcase.css";

export const CONTRACT_SOURCES = [
  { file: "DEGEN-explorer.sol", label: "Full DEGEN contract + dependencies", name: "DEGEN.sol", contract: "DEGEN", address: CONTRACTS.degen },
  { file: "DEGEN-token.sol", label: "DEGEN token contract only", name: "DEGEN.sol", contract: "DEGEN", address: CONTRACTS.degen },
  { file: "DTXgovernor-explorer.sol", label: "Governor contract + dependencies", name: "DTXgovernor.sol", contract: "DTXgovernor", address: GOVERNANCE_ADDRESSES.governor },
] as const;

type CodeToken = { text: string; kind: string };
const SourceCode = memo(function SourceCode({ source }: { source: string }) {
  const lines = useMemo(() => {
    const rows: CodeToken[][] = [[]];
    const append = (text: string, kind: string) => text.split("\n").forEach((part, index) => {
      if (index) rows.push([]);
      if (part) rows[rows.length - 1].push({ text: part, kind });
    });
    const tokens = /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:pragma|solidity|import|interface|contract|is|using|for|uint\d*|int\d*|bytes\d*|address|bool|string|function|constructor|modifier|public|private|internal|external|view|pure|virtual|returns|return|require|constant|immutable|override|memory|storage|calldata|mapping|event|indexed|emit|if|else|new|true|false)\b|\b(?:0x[\da-fA-F]+|\d[\d_]*(?:\.\d+)?)\b/g;
    let cursor = 0;
    for (const match of source.matchAll(tokens)) {
      append(source.slice(cursor, match.index), "plain");
      const text = match[0];
      append(text, text.startsWith("/") ? "comment" : /^["']/.test(text) ? "string" : /^\d/.test(text) ? "numeric" : "keyword");
      cursor = match.index! + text.length;
    }
    append(source.slice(cursor), "plain");
    return rows;
  }, [source]);
  return <code>{lines.map((line, index) => <span className="degen-code-line" data-source-line={index + 1} key={index}>
    <span className="degen-code-number" aria-hidden="true">{index + 1}</span>
    <span className="degen-code-text">{line.map((token, part) => <span className={`degen-code-${token.kind}`} key={part}>{token.text}</span>)}{"\n"}</span>
  </span>)}</code>;
});

export function ContractShowcase() {
  const [sourceFile, setSourceFile] = useState<string>(CONTRACT_SOURCES[0].file);
  const selected = CONTRACT_SOURCES.find(item => item.file === sourceFile)!;
  const [sources, setSources] = useState<Record<string, string>>({});
  const source = sources[sourceFile] ?? "";
  const [error, setError] = useState("");
  const [copyStatus, setCopyStatus] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [wrap, setWrap] = useState(false);
  const [lightOn, setLightOn] = useState(false);
  const [motionPaused, setMotionPaused] = useState(false);
  const codeViewport = useRef<HTMLPreElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const expandedTitle = useId();

  useEffect(() => () => clearTimeout(copyTimer.current), []);
  useEffect(() => {
    if (expanded) dialog.current?.showModal();
    else if (dialog.current?.open) dialog.current.close();
  }, [expanded]);
  useEffect(() => {
    setError("");
    setCopyStatus("");
    if (source) return;
    const controller = new AbortController();
    void fetch(`${import.meta.env.BASE_URL}contracts/${sourceFile}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw Error("Source unavailable");
      const text = (await response.text()).replace(/\r\n/g, "\n");
      if (text.length > 300000 || !new RegExp(`\\bcontract ${selected.contract}\\b`).test(text)) throw Error("Source unavailable");
      if (!controller.signal.aborted) setSources(current => ({ ...current, [sourceFile]: text }));
    }).catch(() => { if (!controller.signal.aborted) setError("Contract source unavailable."); });
    return () => controller.abort();
  }, [sourceFile, source, selected.contract]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(source);
      setCopyStatus("Copied!");
    } catch { setCopyStatus("Select the code to copy it."); }
    clearTimeout(copyTimer.current);
    copyTimer.current = setTimeout(() => setCopyStatus(""), 2500);
  };
  const jumpToContract = () => {
    const line = source.split("\n").findIndex(text => new RegExp(`^\\s*contract ${selected.contract}\\b`).test(text));
    const viewport = codeViewport.current;
    const row = viewport?.querySelector<HTMLElement>(`[data-source-line="${line + 1}"]`);
    if (row && viewport) {
      viewport.scrollTop = row.offsetTop - 14;
      viewport.focus({ preventScroll: true });
    }
  };
  const codeView = (isExpanded = false) => <pre ref={isExpanded ? undefined : codeViewport} key={`${sourceFile}-${isExpanded}`}
    className={`degen-source-code${wrap ? " is-wrapped" : ""}`} tabIndex={0} role="region"
    aria-label={`${isExpanded ? "Expanded " : ""}${selected.contract} Solidity source code`}>
    {source ? <SourceCode source={source} /> : <span className="degen-source-message" role="status">{error || "Loading Solidity source…"}</span>}
  </pre>;
  const closeExpanded = () => { setExpanded(false); expandButton.current?.focus(); };

  return <article className="degen-contract-showcase" aria-label="DEGEN contract source">
    <div className="degen-contract-stage" data-paused={motionPaused || expanded}>
      <div className="degen-contract-editor" data-light={lightOn}>
        <header className="degen-editor-title">
          <span className="degen-editor-dots" aria-hidden="true"><i /><i /><i /></span>
          <span>{selected.name}</span><span>{source ? `${source.split("\n").length.toLocaleString()} lines` : "Solidity"}</span>
        </header>
        <label className="degen-source-select"><span className="degen-code-sr-only">Contract source file</span>
          <select value={sourceFile} onChange={event => setSourceFile(event.target.value)}>{CONTRACT_SOURCES.map(item => <option key={item.file} value={item.file}>{item.label}</option>)}</select>
        </label>
        <div className="degen-source-toolbar">
          <button type="button" disabled={!source} onClick={jumpToContract}>Jump to {selected.contract === "DEGEN" ? "DEGEN" : "Governor"}</button>
          <label><input type="checkbox" checked={wrap} onChange={event => setWrap(event.target.checked)} />Wrap lines</label>
          <button type="button" ref={expandButton} disabled={!source} onClick={() => setExpanded(true)}>Expand ↗</button>
        </div>
        {codeView()}
        <footer className="degen-editor-footer">
          <a href={`https://scan.pulsechain.com/address/${selected.address}?tab=contract`} target="_blank" rel="noreferrer">Explorer source · {selected.contract} ↗</a>
          <button type="button" disabled={!source} onClick={() => void copyCode()}>{copyStatus === "Copied!" ? copyStatus : "Copy code"}</button>
        </footer>
        <div className="degen-editor-sheen" aria-hidden="true" />
      </div>
    </div>
    <div className="degen-source-effects">
      <button type="button" aria-pressed={lightOn} onClick={() => setLightOn(value => !value)}>{lightOn ? "Light Off" : "Light On"}</button>
      <button type="button" aria-pressed={motionPaused} onClick={() => setMotionPaused(value => !value)}>{motionPaused ? "Resume motion" : "Pause motion"}</button>
    </div>
    <span className="degen-code-sr-only" role="status">{copyStatus}</span>
    <dialog className="degen-source-dialog" ref={dialog} aria-labelledby={expandedTitle} onCancel={closeExpanded} onClose={closeExpanded}>
      {expanded && <><header><h3 id={expandedTitle}>{selected.contract} · Solidity source</h3><button type="button" onClick={closeExpanded}>Close</button></header>{codeView(true)}</>}
    </dialog>
  </article>;
}
