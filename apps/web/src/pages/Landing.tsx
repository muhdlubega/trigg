import { Activity, ArrowRight, Bot, CheckCircle2, Cloud, Database, Github, GitPullRequest, LockKeyhole, Play, RefreshCw, ShieldCheck, Webhook } from 'lucide-react';

const reviewSteps=[
  {Icon:Webhook,n:'01',title:'Connect',copy:'Install the Trigg GitHub App and choose the repositories you want reviewed.'},
  {Icon:GitPullRequest,n:'02',title:'Trigger',copy:'A new pull request starts a queued review automatically, or run one manually from the dashboard.'},
  {Icon:Bot,n:'03',title:'Review',copy:'Mistral analyzes the diff with Gemini fallback and returns a validated, structured review.'},
  {Icon:CheckCircle2,n:'04',title:'Deliver',copy:'Trigg posts the review and a check run directly on the pull request head commit.'},
];

const architecture=[
  {Icon:Cloud,title:'Cloudflare Worker',copy:'A Hono API validates requests, receives signed GitHub webhooks, and coordinates each run at the edge.'},
  {Icon:RefreshCw,title:'Queue-driven execution',copy:'Cloudflare Queues decouple webhook delivery from AI work, with retries and durable execution status.'},
  {Icon:Database,title:'D1 observability',copy:'Workflow versions, node inputs and outputs, AI usage, errors, and timing are recorded in D1.'},
  {Icon:LockKeyhole,title:'Scoped GitHub access',copy:'Short-lived installation tokens grant access only to selected repositories and accepted permissions.'},
];

export function Landing(){
  return <div className="landing">
    <nav className="landing-nav">
      <a className="brand" href="/"><span className="logo-mark">T</span>Trigg</a>
      <div><a href="#product">How it works</a><a href="#pull-request">PR reviews</a><a href="#architecture">Architecture</a><a href="/docs">Docs</a></div>
      <a className="button small" href="/login">Open app <ArrowRight size={14}/></a>
    </nav>
    <main>
      <section className="hero">
        <div className="hero-copy">
          <span className="hero-badge"><span/>AI CODE REVIEW FOR GITHUB</span>
          <h1>Review every pull request <em>where it happens.</em></h1>
          <p>Trigg reviews pull request diffs, posts structured findings on GitHub, and records the complete execution so your team can inspect every result.</p>
          <div className="hero-actions"><a className="button primary" href="/login">Connect a repository <ArrowRight size={16}/></a><a className="button ghost" href={import.meta.env.VITE_GITHUB_URL??'#'}><Github size={16}/>View source</a></div>
          <div className="hero-proof"><span><i/>GitHub App</span><span><i/>Provider fallback</span><span><i/>Open source</span></div>
        </div>
        <FlowDemo/>
      </section>

      <section id="product" className="how">
        <div className="section-title"><span>HOW IT WORKS</span><h2>From pull request to review in four steps.</h2><p>Set up a repository reviewer once. Trigg handles new pull requests and keeps the review visible in both GitHub and the execution dashboard.</p></div>
        <div className="primitive-grid">{reviewSteps.map(({Icon,n,title,copy})=><article key={title}><Icon size={21}/><b>{n}</b><h3>{title}</h3><p>{copy}</p></article>)}</div>
      </section>

      <section id="pull-request" className="pr-review-section">
        <div className="pr-review-copy">
          <span className="eyebrow">REVIEW IN CONTEXT</span>
          <h2>See the code review directly on your pull request.</h2>
          <p>Developers do not need to leave GitHub to understand the result. Trigg posts the summary, risk score, recommendation, and findings as a pull request review, while a check run reflects progress and completion on the same commit.</p>
          <ul><li><ShieldCheck size={16}/>Validated severity and recommendation</li><li><GitPullRequest size={16}/>Native pull request review</li><li><Activity size={16}/>Live status with a complete execution trace</li></ul>
        </div>
        <figure className="pr-review-shot"><img src="/screenshots/github-pr-review.png" alt="A Trigg AI code review shown directly on a GitHub pull request"/><figcaption>Structured review delivered by the Trigg GitHub App.</figcaption></figure>
      </section>

      <section id="architecture" className="architecture-section">
        <div className="section-title"><span>TECHNICAL ARCHITECTURE</span><h2>Edge-native, queued, and observable.</h2><p>The request path stays fast while AI work runs asynchronously. Every boundary is explicit, authenticated, and inspectable.</p></div>
        <div className="architecture-grid">{architecture.map(({Icon,title,copy})=><article key={title}><span><Icon size={18}/></span><h3>{title}</h3><p>{copy}</p></article>)}</div>
        <div className="architecture-flow" aria-label="Trigg architecture flow"><span>GitHub webhook</span><ArrowRight size={14}/><span>Cloudflare Worker</span><ArrowRight size={14}/><span>Queue</span><ArrowRight size={14}/><span>AI review</span><ArrowRight size={14}/><span>PR review + check</span></div>
      </section>

      <section className="cta"><span className="logo-mark">T</span><h2>Review your next pull request with Trigg.</h2><p>Connect GitHub, choose a repository, and keep the full review lifecycle visible.</p><a className="button primary" href="/login">Open Trigg <ArrowRight size={16}/></a></section>
    </main>
    <footer className="landing-footer"><a className="brand" href="/"><span className="logo-mark">T</span>Trigg</a><span>AI code review, directly on your pull requests.</span><div><a href="/docs">Docs</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></div></footer>
  </div>;
}

function FlowDemo(){
  return <div className="flow-demo">
    <div className="flow-top"><span><i/>LIVE REVIEW</span><b>AI pull request reviewer</b><button><Play size={13}/>RUN</button></div>
    <div className="landing-run">
      <div className="landing-run-head"><GitPullRequest size={18}/><div><b>fix/dashboard-empty-state</b><small>Pull request #18 · main</small></div><span>RUNNING</span></div>
      <ol>
        <li className="done"><CheckCircle2/><span><b>Pull request received</b><small>Signed GitHub webhook</small></span></li>
        <li className="done"><CheckCircle2/><span><b>Diff analyzed</b><small>Mistral with Gemini fallback</small></span></li>
        <li className="active"><Bot/><span><b>Structured review generated</b><small>Risk, findings, recommendation</small></span></li>
        <li><Github/><span><b>Review and check delivered</b><small>Visible on the pull request</small></span></li>
      </ol>
    </div>
    <div className="flow-footer"><span><i/>ACTIVE</span><span>10s LIVE UPDATES</span><span>FULL TRACE</span></div>
  </div>;
}
