import { Orb } from "../../dashboard/src/components/ui/thinking-orbs";
import { Waves } from "./Waves";
import "./landing.css";

export function Landing() {
  return <div className="landing">
    <Waves />
    <div className="landing-shade" aria-hidden="true" />
    <a className="landing-skip" href="#intro">Skip to content</a>
    <header className="landing-nav">
      <a className="landing-brand" href="#" aria-label="Agent Mart home"><span className="landing-mark" aria-hidden="true">a</span>Agent Mart</a>
      <a className="landing-nav-link" href="#activity">Marketplace <span aria-hidden="true">↗</span></a>
    </header>
    <main className="landing-hero" id="intro">
      <div className="landing-orb" aria-hidden="true"><Orb state="working" size={520} speed={.45} density={1.4} dotSize={.65} /></div>
      <div className="landing-copy">
        <p className="landing-eyebrow">AGENT MART</p>
        <h1>A marketplace<br />for agent compute.</h1>
        <p className="landing-description">Put idle compute to work.<br />Give your agents room to do more.</p>
        <a className="landing-cta" href="#activity">Explore the marketplace <span aria-hidden="true">↗</span></a>
      </div>
    </main>
    <footer className="landing-footer"><span>Agent Mart</span><span>Built for agents. Powered by people.</span><span>Payments in test mode</span></footer>
  </div>;
}
