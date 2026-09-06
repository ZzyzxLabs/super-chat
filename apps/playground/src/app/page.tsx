import Link from "next/link";
import { playgroundPath } from "@/agent/deployment";
import styles from "./page.module.css";

const INTERNALS = [
  ["Agent cards", "/cards", "23 validated visual forms"],
  ["Skills", "/skills", "matched operating knowledge"],
  ["Tools & presets", "/tools", "explicit capability gates"],
  ["Wire requests", "/requests", "provider-correct payloads"],
  ["Run & events", "/run", "scripted turns and event traces"],
];

const Arrow = () => (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="M3 8h9M8.5 4.5 12 8l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export default function ExperienceGallery() {
  return (
    <div className={styles.page}>
      <header className={styles.nav}>
        <Link href="/" className={styles.brand}>
          <span className={styles.mark} aria-hidden="true"><i /><i /><i /></span>
          superchat
        </Link>
        <nav aria-label="Primary navigation">
          <a href="#experiences">Experiences</a>
          <a href="#runtime">The runtime</a>
          <Link href={playgroundPath("/cards")}>Under the hood</Link>
        </nav>
        <Link href={playgroundPath("/run")} className={styles.open}>Open playground <Arrow /></Link>
      </header>

      <main>
        <section className={styles.hero}>
          <div className={styles.heroCopy}>
            <h1>Build domain agents that don’t all look like chat.</h1>
            <p>
              One provider-neutral runtime for multimodal content, scoped tools, agent-chosen UI, and the visual
              personality your product actually needs.
            </p>
            <div className={styles.heroActions}>
              <Link href="/experiences/legal">Explore working demos <Arrow /></Link>
            </div>
          </div>
          <div className={styles.mechanism} aria-label="SuperChat agent pipeline">
            <div><span>01</span><strong>Domain</strong><small>skills + context</small></div>
            <i />
            <div><span>02</span><strong>Authority</strong><small>tools + presets</small></div>
            <i />
            <div><span>03</span><strong>Expression</strong><small>cards + renderers</small></div>
          </div>
        </section>

        <section className={styles.worlds} id="experiences" aria-label="Experience demos">
          <Link className={`${styles.world} ${styles.legal}`} href="/experiences/legal">
            <div className={styles.worldHead}>
              <div><h2>Counsel Workspace</h2><p>Formal document intelligence</p></div>
              <Arrow />
            </div>
            <div className={styles.paper}>
              <span>VERTEX MASTER SERVICES AGREEMENT</span>
              <b>7.2 Limitation of liability</b>
              <p>In no event shall either party’s aggregate liability exceed fees paid in the preceding twelve months.</p>
              <mark>One-way carve-out detected</mark>
            </div>
            <footer><span>PDF</span><span>citations</span><span>edit review</span></footer>
          </Link>

          <Link className={`${styles.world} ${styles.companion}`} href="/experiences/companion">
            <div className={styles.orbit} aria-hidden="true"><i /></div>
            <div className={styles.companionCopy}>
              <h2>Milo</h2>
              <p>You kept the promise you made to yourself this morning.</p>
              <span className={styles.fakeButton}>Celebrate this moment</span>
            </div>
            <footer><span>memory</span><span>generated effects</span></footer>
          </Link>

          <Link className={`${styles.world} ${styles.defi}`} href="/experiences/defi">
            <div className={styles.worldHead}>
              <div><h2>SupWallet</h2><p>Agentic portfolio operations</p></div>
              <Arrow />
            </div>
            <div className={styles.trade}>
              <span>SupWallet agent</span>
              <b>Rebalance volatile exposure</b>
              <p>14.20 ETH → 48,972 USDC</p>
              <em>29.4% → 17.6% · within policy</em>
            </div>
            <footer><span>agent card</span><span>simulate</span><span>execute</span></footer>
          </Link>
        </section>

        <section className={styles.runtime} id="runtime">
          <div>
            <h2>Different products. The same inspectable machinery.</h2>
            <p>
              Switch the domain pack, visual theme, and selected renderers. Keep the provider adapters, event loop,
              content model, tool authority, and metering contract.
            </p>
          </div>
          <pre><code>{`defineExperience({
  domain: legalDomain,
  theme: formalDocument,
  renderers: legalCards,
  provider: bringYourOwnKey()
})`}</code></pre>
        </section>

        <section className={styles.internals}>
          <h2>Inspect every layer</h2>
          <div>
            {INTERNALS.map(([title, href, detail]) => (
              <Link href={playgroundPath(href)} key={href}>
                <span><strong>{title}</strong><small>{detail}</small></span>
                <Arrow />
              </Link>
            ))}
          </div>
        </section>
      </main>

      <footer className={styles.foot}>
        <strong>SuperChat</strong>
        <span>A frontend framework for agent services.</span>
        <code>Apache-2.0 · scripted demo data</code>
      </footer>
    </div>
  );
}
