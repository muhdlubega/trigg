import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';

export function SiteChrome({children,legal=false}:{children:ReactNode;legal?:boolean}){
  return <div className={`landing${legal?' legal':''}`}>
    <nav className="landing-nav">
      <a className="brand" href="/"><span className="logo-mark">T</span>Trigg</a>
      <div>
        <a href="/#product">How it works</a>
        <a href="/#pull-request">PR reviews</a>
        <a href="/#architecture">Architecture</a>
        <a href="/docs">Docs</a>
      </div>
      <a className="button small" href="/login">Open app <ArrowRight size={14}/></a>
    </nav>
    {children}
    <footer className="landing-footer">
      <a className="brand" href="/"><span className="logo-mark">T</span>Trigg</a>
      <span>AI code review, directly on your pull requests.</span>
      <div><a href="/docs">Docs</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></div>
    </footer>
  </div>;
}
