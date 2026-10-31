import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CopyAddress } from "../components/CopyAddress";
import { TREASURY } from "./dashboard/config";
import {
  DOC_CONTRACT_GROUPS, DOC_FAQS, DOC_GUIDES, DOC_SECTIONS, DOC_SOURCES, DOC_TOOLS,
  docsMatch, type DocContract, type DocFaq, type DocResource, type DocSection,
} from "./docsContent";
import "./guides.css";

function ResourceCards({ resources }: { resources: readonly DocResource[] }) {
  return <div className="docs-source-grid">{resources.map(resource => {
    const content = <><h3>{resource.title}</h3><p>{resource.description}</p><span>{resource.external ? "Open source ↗" : "Explore →"}</span></>;
    return resource.external
      ? <a className="guide-card" href={resource.href} key={resource.title} target="_blank" rel="noreferrer">{content}</a>
      : <Link className="guide-card" to={resource.href} key={resource.title}>{content}</Link>;
  })}</div>;
}

function FaqList({ questions, expanded = false }: { questions: readonly DocFaq[]; expanded?: boolean }) {
  const groups = [...new Set(questions.map(faq => faq.group))];
  return <>{groups.map(group => <section className="docs-faq-group" key={group} aria-label={group}>
    <h3>{group}</h3>
    {questions.filter(faq => faq.group === group).map(faq => <details className="docs-faq" key={`${expanded ? "search" : "faq"}:${faq.id}`} open={expanded}>
      <summary>{faq.question}</summary><div><p>{faq.answer}</p>{faq.href && <Link to={faq.href}>{faq.linkLabel ?? "Explore →"}</Link>}</div>
    </details>)}
  </section>)}</>;
}

function ContractCards({ contracts }: { contracts: readonly DocContract[] }) {
  return <div className="docs-contract-grid">{contracts.map(contract => <article className="guide-card docs-contract" key={`${contract.label}:${contract.address}`}>
    <h3>{contract.label}</h3>{contract.detail && <p>{contract.detail}</p>}
    <CopyAddress address={contract.address} label={`${contract.label} address`} iconOnly />
    <a className="docs-contract-source" href={`https://scan.pulsechain.com/address/${contract.address}`} target="_blank" rel="noreferrer">View contract ↗</a>
  </article>)}</div>;
}

export function DocsPage() {
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState("");
  const requested = params.get("section");
  const section: DocSection = DOC_SECTIONS.some(item => item.id === requested) ? requested as DocSection : "guides";
  const query = search.trim();
  const faqResults = DOC_FAQS.filter(faq => docsMatch(query, faq.question, faq.answer, faq.group, faq.keywords));
  const contractResults = DOC_CONTRACT_GROUPS.flatMap(group => group.contracts.filter(contract => docsMatch(query, group.label, contract.label, contract.address, contract.detail)));
  const resourceResults = [...DOC_GUIDES, ...DOC_SOURCES, ...DOC_TOOLS].filter((resource, index, all) =>
    all.findIndex(item => item.title === resource.title && item.href === resource.href) === index && docsMatch(query, resource.title, resource.description, resource.keywords));
  const resultCount = faqResults.length + contractResults.length + resourceResults.length;
  function selectSection(id: DocSection) {
    setSearch("");
    setParams(previous => { const next = new URLSearchParams(previous); next.set("section", id); return next; });
  }
  return <main className="guide-main docs-main">
    <header className="guide-hero"><span className="guide-kicker">DEGEN Docs</span><h1>Understand the protocol.</h1><p>Guides, source links and contract listings in one place.</p></header>
    <div className="docs-layout">
      <aside className="docs-sidebar">
        <label className="docs-search" htmlFor="docs-search">Find a topic<input id="docs-search" type="search" value={search} onChange={event => setSearch(event.target.value)} placeholder="Miners, rewards, contracts…" /></label>
        <nav aria-label="Documentation sections">{DOC_SECTIONS.map(item => <Link className={`docs-nav-link${!query && section === item.id ? " active" : ""}`} aria-current={!query && section === item.id ? "page" : undefined}
          to={{ pathname: "/protocol", search: (() => { const next = new URLSearchParams(params); next.set("section", item.id); return `?${next}`; })() }} key={item.id}
          onClick={event => { if (!event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) { event.preventDefault(); selectSection(item.id); } }}>{item.label}</Link>)}</nav>
      </aside>
      <div className="docs-content">
        {query ? <div className="docs-search-results" aria-label="Documentation search results">
          <h2>Search results</h2><p role="status">{resultCount} {resultCount === 1 ? "result" : "results"} for “{query}”</p>
          {faqResults.length > 0 && <section><h2>Frequently asked questions</h2><FaqList questions={faqResults} expanded /></section>}
          {contractResults.length > 0 && <section><h2>Matching contracts</h2><ContractCards contracts={contractResults} /></section>}
          {resourceResults.length > 0 && <section><h2>Guides & tools</h2><ResourceCards resources={resourceResults} /></section>}
          {!resultCount && <div className="docs-empty"><p>No topics match “{query}”.</p><button type="button" onClick={() => setSearch("")}>Clear search</button></div>}
        </div> : <>
          {section === "guides" && <><h2>Start here</h2><p>New to DEGEN? Follow the main routes, then explore the details.</p><ResourceCards resources={DOC_GUIDES} /></>}
          {section === "faq" && <><h2>Frequently asked questions</h2><p>Quick answers about DEGEN and the features in this interface.</p><FaqList questions={DOC_FAQS} /></>}
          {section === "contracts" && <><h2>Contract directory</h2><p>PulseChain addresses, grouped by their role in DEGEN.</p>{DOC_CONTRACT_GROUPS.map(group => <details className="docs-contract-group" key={group.id} open={group.id === "core"}>
            <summary>{group.label} <span>{group.contracts.length}</span></summary><ContractCards contracts={group.contracts} />
          </details>)}</>}
          {section === "sources" && <><h2>Contract sources</h2><p>Open the contract’s explorer record to view its code, transactions and public reads.</p><ResourceCards resources={DOC_SOURCES} /><p><Link to="/protocol?section=contracts">Browse all contract addresses →</Link></p></>}
          {section === "treasury" && <><h2>Treasury & activity</h2><p>Overview shows the listed treasury wallet’s token holdings, their market value and tracked token inflows over 24 hours, 7 days and 30 days.</p>
            <div className="guide-card"><h3>Treasury wallet</h3><CopyAddress address={TREASURY} label="treasury wallet address" iconOnly /><p>Holdings are the tokens held directly by this wallet. Activity lists the tracked ERC-20 transfers received by it; native PLS and unlisted-token receipts are outside the inflow feed.</p><a href={`https://scan.pulsechain.com/address/${TREASURY}`} target="_blank" rel="noreferrer">View treasury on PulseChain ↗</a></div>
            <ResourceCards resources={[
              { title: "Live overview", description: "Explore treasury holdings and the token inflow feed.", href: "/" },
              { title: "Your portfolio", description: "See your own wallet, miners, farm assets and rewards.", href: "/portfolio" },
            ]} />
          </>}
          {section === "tools" && <><h2>More DEGEN tools</h2><p>Jump to the page for the position or action you want to manage.</p><ResourceCards resources={DOC_TOOLS} /></>}
        </>}
      </div>
    </div>
  </main>;
}
